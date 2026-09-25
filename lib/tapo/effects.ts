/**
 * Custom effects and built-in scenes for Tapo light strips (L920/L930).
 *
 * Firmware rules, established by testing an L930-5 on firmware 1.4.3:
 *  - set_lighting_effect IGNORES an id it doesn't already know — silently, no
 *    error. So custom content has to be sent under a built-in effect's id.
 *  - Up to 16 sections; 17+ is silently ignored.
 *  - type "static" holds still (one colour per section, stretched over the strip);
 *    "sequence" animates over time.
 * Because rejections are silent, every apply is verified by reading the device back.
 */
import scenes from './scenes';

export const MAX_SECTIONS = 16;
// Candy Cane's id — known to every firmware we've seen; the carrier for custom content.
const CARRIER_ID = 'TapoStrip_6Dy0Nc45vlhFPEzG021Pe9';

export type EffectStyle = 'paint' | 'flow' | 'chase';

/** What the editor produces and what gets saved. Colours are "#rrggbb". */
export type CustomEffect = {
  id: string, // our own id, for storage and flow cards (never sent to the device)
  name: string,
  style: EffectStyle,
  colors: string[],
  brightness: number, // 1–100
  speed?: number, // 1 (slow) – 10 (fast), for animated styles
};

type Hsb = [number, number, number];

export function hexToHsb(hex: string): Hsb {
  const value = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`"${hex}" is not a colour.`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return [hue, max ? Math.round((delta / max) * 100) : 0, Math.round(max * 100)];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export function validateEffect(effect: CustomEffect): CustomEffect {
  const name = String(effect.name ?? '').trim().slice(0, 32);
  if (!name) throw new Error('Give the effect a name.');
  if (!['paint', 'flow', 'chase'].includes(effect.style)) throw new Error(`Unknown style "${effect.style}".`);
  const colors = (effect.colors ?? []).slice(0, MAX_SECTIONS);
  if (colors.length === 0) throw new Error('Pick at least one colour.');
  if (effect.style !== 'paint' && colors.length < 2) throw new Error('An animation needs at least two colours.');
  colors.forEach(hexToHsb); // throws on a malformed colour
  return {
    id: String(effect.id || `fx_${Date.now().toString(36)}`),
    name,
    style: effect.style,
    colors,
    brightness: clamp(effect.brightness ?? 100, 1, 100),
    speed: clamp(effect.speed ?? 5, 1, 10),
  };
}

/** The set_lighting_effect params for a custom effect. */
export function toLightingEffect(input: CustomEffect): { [key: string]: unknown } {
  const effect = validateEffect(input);
  const hsb = effect.colors.map(hexToHsb);
  const common = {
    id: CARRIER_ID,
    // The device reports this name back — which is how we verify it was applied.
    name: effect.name,
    custom: 1,
    enable: 1,
    brightness: effect.brightness,
    display_colors: hsb.slice(0, 6),
    expansion_strategy: 1,
    repeat_times: 0,
  };
  const speed = effect.speed ?? 5;

  if (effect.style === 'paint') {
    // One colour per section, held still (verified on hardware).
    return {
      ...common,
      type: 'static',
      segments: hsb.map((_, i) => i),
      sequence: hsb,
      spread: 1,
      direction: 1,
      duration: 0,
      transition: 0,
    };
  }
  if (effect.style === 'chase') {
    // Candy Cane's shape: coloured blocks stepping along the strip.
    const steps = Array.from({ length: MAX_SECTIONS }, (_, i) => hsb[i % hsb.length]);
    const duration = Math.round(2000 / speed); // ms per step
    return {
      ...common,
      type: 'sequence',
      segments: steps.map((_, i) => i),
      sequence: steps,
      spread: 1,
      direction: 1,
      duration,
      transition: Math.round(duration * 0.7),
    };
  }
  // flow — the Ocean/Aurora/Rainbow shape: a smooth gradient travelling along.
  return {
    ...common,
    type: 'sequence',
    segments: [0],
    sequence: hsb,
    spread: Math.max(2, Math.round(16 / hsb.length)),
    direction: 1,
    duration: 0,
    transition: Math.round(4000 / speed),
  };
}

// ---- built-in scenes (firmware "segment effects") ---------------------------

// eslint-disable-next-line camelcase -- device field name
export type Scene = { key: string, id: string, title: string, brightness: number, display_colors: number[][] };

export const SCENES: Scene[] = scenes as Scene[];

export function sceneParams(key: string) {
  const scene = SCENES.find((s) => s.key === key);
  if (!scene) return undefined;
  return {
    id: scene.id, name: scene.key, custom: 0, enable: 1, brightness: scene.brightness, display_colors: scene.display_colors,
  };
}

// ---- applying (with verification) ------------------------------------------

type Sender = { send: (request: unknown) => Promise<any> };

/** Saved effects live in app settings under this key (the Effect Studio page writes them). */
export const SETTINGS_KEY = 'customEffects';

export function savedEffects(settings: { get(key: string): unknown }): CustomEffect[] {
  const value = settings.get(SETTINGS_KEY);
  return Array.isArray(value) ? value as CustomEffect[] : [];
}

/**
 * The strip ignores effects it doesn't accept without any error, so read it back:
 * reporting "applied" for an effect that never ran is worse than an error.
 */
export async function applyCustomEffect(api: Sender, effect: CustomEffect) {
  const params = toLightingEffect(effect);
  await api.send({ method: 'set_device_info', params: { device_on: true } });
  await api.send({ method: 'set_lighting_effect', params });
  const info = await api.send({ method: 'get_device_info' });
  if (!(info?.lighting_effect?.enable && info.lighting_effect.name === params.name)) {
    throw new Error(`The strip did not accept "${effect.name}". It may not support this kind of effect.`);
  }
}

export async function applyScene(api: Sender, params: { [key: string]: unknown }) {
  await api.send({ method: 'set_device_info', params: { device_on: true } });
  await api.send({ method: 'apply_segment_effect_rule', params });
  const info = await api.send({ method: 'get_device_info' });
  if (!(info?.segment_effect?.enable && info.segment_effect.name === params.name)) {
    throw new Error(`The strip did not accept the "${params.name}" scene. Its firmware may not have it.`);
  }
}
