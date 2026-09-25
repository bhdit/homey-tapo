/**
 * App API for the Effect Studio (settings page). The page never writes saved
 * effects itself: every save goes through validateEffect here, so the rules
 * (name, 1–16 colours, 2+ for animations) live in one place.
 */
import {
  CustomEffect, SCENES, SETTINGS_KEY, savedEffects, validateEffect,
} from './lib/tapo/effects';

type Context = { homey: any, body?: any, params?: { [key: string]: string } };

const EFFECT_DRIVERS = ['L920', 'L930'];

function strips(homey: any) {
  return EFFECT_DRIVERS.flatMap((driverId) => {
    try {
      return homey.drivers.getDriver(driverId).getDevices();
    } catch {
      return []; // driver not loaded
    }
  });
}

function findStrip(homey: any, deviceId: string) {
  const device = strips(homey).find((d: any) => d.getData().id === deviceId);
  if (!device) throw new Error('That light strip was not found. It may have been removed.');
  return device;
}

module.exports = {
  async listStrips({ homey }: Context) {
    return {
      strips: strips(homey).map((d: any) => ({
        id: d.getData().id,
        name: d.getName(),
        model: d.driver.id,
        available: d.getAvailable(),
        previewing: d.hasPendingRestore(),
      })),
      scenes: SCENES.map(({ key, title, display_colors: colors }) => ({ key, title, colors })),
    };
  },

  async listEffects({ homey }: Context) {
    return savedEffects(homey.settings);
  },

  async saveEffect({ homey, body }: Context) {
    const effect = validateEffect(body as CustomEffect);
    const others = savedEffects(homey.settings).filter((e) => e.id !== effect.id);
    if (others.some((e) => e.name.toLowerCase() === effect.name.toLowerCase())) {
      throw new Error(`There is already an effect called "${effect.name}".`);
    }
    homey.settings.set(SETTINGS_KEY, [...others, effect]);
    return effect;
  },

  async deleteEffect({ homey, params }: Context) {
    homey.settings.set(SETTINGS_KEY, savedEffects(homey.settings).filter((e) => e.id !== params?.id));
    return { ok: true };
  },

  /** Plays an unsaved design (or a scene) on a strip. Throws if the strip didn't take it. */
  async preview({ homey, body }: Context) {
    const device = findStrip(homey, body?.deviceId);
    if (body?.scene) {
      await device.previewEffect(String(body.scene));
    } else {
      await device.previewCustomEffect(validateEffect({ ...body.effect, name: body.effect?.name || 'Preview' }));
    }
    return { ok: true };
  },

  /** Undo: put the strip back to how it was before the first preview. */
  async previewUndo({ homey, body }: Context) {
    await findStrip(homey, body?.deviceId).restoreNow();
    return { ok: true };
  },

  /** Keep: the previewed look stays and the pending undo is dropped. */
  async previewKeep({ homey, body }: Context) {
    await findStrip(homey, body?.deviceId).keepCurrentState();
    return { ok: true };
  },
};
