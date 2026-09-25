/**
 * Capturing a light's state and replaying it later — the core of "do something
 * for X seconds, then go back". Pure functions: device info in, requests out.
 */
import { LightEffectPresetEnum } from 'tp-link-tapo-connect/dist/light-effect';

// eslint-disable-next-line camelcase -- device field name
type SceneState = { id: string, name: string, brightness?: number, display_colors?: unknown };

/* eslint-disable camelcase */
type LightInfo = {
  device_on?: boolean,
  brightness?: number,
  hue?: number,
  saturation?: number,
  color_temp?: number,
  lighting_effect?: { enable?: number | boolean, name?: string, custom?: number | boolean },
  segment_effect?: SceneState & { enable?: number | boolean, custom?: number | boolean },
};
/* eslint-enable camelcase */

export type LightSnapshot = {
  on: boolean,
  brightness?: number,
  hue?: number,
  saturation?: number,
  colorTemp?: number,
  effect?: string, // preset key as the library expects it, e.g. "AURORA"
  customEffect?: string, // name of a custom effect (ours); the device alone can't rebuild it
  scene?: SceneState, // built-in scene (segment effect) — the device reports all we need to replay it
};

export type TapoRequest = { method: string, params?: { [key: string]: unknown } };

/** "Bubbling Cauldron" → "BUBBLINGCAULDRON", the library's preset enum key. */
export const effectKey = (name: string) => name.replace(/[^a-z]/gi, '').toUpperCase();

export function toSnapshot(info: LightInfo): LightSnapshot {
  const effect = info.lighting_effect;
  const effectOn = Boolean(effect?.enable && effect.name);
  const presetKey = effectOn ? effectKey(effect!.name!) : '';
  const isPreset = effectOn && presetKey in LightEffectPresetEnum;
  const scene = info.segment_effect?.enable ? info.segment_effect : undefined;
  return {
    on: Boolean(info.device_on),
    brightness: info.brightness,
    hue: info.hue,
    saturation: info.saturation,
    colorTemp: info.color_temp,
    effect: isPreset ? presetKey : undefined,
    // Anything else running under set_lighting_effect is a custom effect, known only by name.
    customEffect: effectOn && !isPreset ? effect!.name : undefined,
    scene: scene ? {
      id: scene.id, name: scene.name, brightness: scene.brightness, display_colors: scene.display_colors,
    } : undefined,
  };
}

/**
 * The requests that put a light back. Effects are replayed by name (the caller
 * maps them to the library preset); everything else is one set_device_info.
 */
export function restorePlan(snapshot: LightSnapshot): {
  effect?: string, customEffect?: string, scene?: TapoRequest, request: TapoRequest,
} {
  const params: { [key: string]: unknown } = {};
  if (typeof snapshot.brightness === 'number' && snapshot.brightness > 0) params.brightness = snapshot.brightness;

  if (typeof snapshot.colorTemp === 'number' && snapshot.colorTemp > 0) {
    params.color_temp = snapshot.colorTemp;
  } else if (typeof snapshot.hue === 'number' && typeof snapshot.saturation === 'number') {
    params.hue = snapshot.hue;
    params.saturation = snapshot.saturation;
    params.color_temp = 0; // colour mode: a leftover temperature would win over hue/saturation
  }

  // on/off last in the same request, so a light that was off stays off.
  params.device_on = snapshot.on;
  const { on } = snapshot;
  return {
    effect: on ? snapshot.effect : undefined,
    customEffect: on ? snapshot.customEffect : undefined,
    scene: on && snapshot.scene ? {
      method: 'apply_segment_effect_rule', params: { ...snapshot.scene, custom: 0, enable: 1 },
    } : undefined,
    request: { method: 'set_device_info', params },
  };
}

/** "#ff8800" → Tapo hue (0–360) and saturation (0–100). Brightness is set separately. */
export function hexToHueSaturation(hex: string): { hue: number, saturation: number } {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  // HSV saturation: pure colours stay fully saturated regardless of their lightness.
  const saturation = max === 0 ? 0 : Math.round((delta / max) * 100);
  return { hue, saturation };
}
