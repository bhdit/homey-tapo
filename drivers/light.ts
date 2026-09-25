import GenericDevice from './device';
import { TapoApi } from '../lib/tapo/connection';
import {
  hexToHueSaturation, LightSnapshot, restorePlan, toSnapshot,
} from '../lib/tapo/light-state';
import {
  applyCustomEffect, applyScene, CustomEffect, savedEffects, sceneParams,
} from '../lib/tapo/effects';

const STORE_KEY = 'temporaryRestore';
const RESTORE_RETRY_MS = 10_000;
const RESTORE_ATTEMPTS = 3;
// Effect Studio previews undo themselves if nobody presses "Undo" or "Keep".
const PREVIEW_SECONDS = 10 * 60;

function clampBrightness(value: number) {
  return Math.min(100, Math.max(1, Math.round(value)));
}

type PendingRestore = { snapshot: LightSnapshot, until: number };

/**
 * Base for all Tapo lights: "do something for X seconds, then go back".
 * The pending restore is persisted, so an app restart mid-override still restores.
 */
export = class LightDevice extends GenericDevice {

  private restoreTimer: NodeJS.Timeout | undefined;

  async onInit() {
    await super.onInit();
    const pending = this.getStoreValue(STORE_KEY) as PendingRestore | null;
    if (pending) {
      const remaining = Math.max(0, pending.until - Date.now());
      this.log(`Resuming pending restore in ${Math.round(remaining / 1000)} s after restart.`);
      this.scheduleRestore(remaining);
    }
  }

  async onUninit() {
    this.homey.clearTimeout(this.restoreTimer);
    await super.onUninit();
  }

  async onDeleted() {
    this.homey.clearTimeout(this.restoreTimer);
    await super.onDeleted();
  }

  /**
   * Every capability change made by a person, a flow or a voice assistant goes
   * through here — and cancels a pending restore, since that change is the new intent.
   */
  registerCapabilityListener(capability: string, listener: (...args: any[]) => Promise<any>) {
    return super.registerCapabilityListener(capability, async (...args: any[]) => {
      await this.cancelTemporary('changed while a temporary state was active');
      return listener(...args);
    });
  }

  registerMultipleCapabilityListener(capabilities: string[], listener: (...args: any[]) => Promise<any>, debounce: number) {
    return super.registerMultipleCapabilityListener(capabilities, async (...args: any[]) => {
      await this.cancelTemporary('changed while a temporary state was active');
      return (listener as any)(...args);
    }, debounce);
  }

  // ---- temporary actions (flow cards) --------------------------------------

  async temporaryBrightness(brightness: number, seconds: number) {
    await this.runTemporarily(seconds, async (api) => {
      await api.send({ method: 'set_device_info', params: { device_on: true, brightness: clampBrightness(brightness) } });
    });
  }

  async temporaryOff(seconds: number) {
    await this.runTemporarily(seconds, (api) => api.turnOff());
  }

  async temporaryColor(hex: string, brightness: number, seconds: number) {
    const { hue, saturation } = hexToHueSaturation(hex);
    await this.runTemporarily(seconds, async (api) => {
      await api.send({
        method: 'set_device_info',
        params: {
          device_on: true, hue, saturation, color_temp: 0, brightness: clampBrightness(brightness),
        },
      });
    });
  }

  async temporaryEffect(effect: string, seconds: number) {
    await this.runTemporarily(seconds, (api) => this.playEffectWith(api, effect));
  }

  async temporaryCustomEffect(effectId: string, seconds: number) {
    await this.runTemporarily(seconds, (api) => this.playCustomWith(api, effectId));
  }

  // ---- effects: presets, built-in scenes, saved custom effects ---------------

  /** A preset ("aurora") or a built-in scene ("birthday") — the keys the effect picker offers. */
  async playEffect(key: string) {
    await this.withDevice((api) => this.playEffectWith(api, key));
  }

  async playCustomEffect(effectId: string) {
    await this.withDevice((api) => this.playCustomWith(api, effectId));
  }

  /** Plays a design that isn't saved yet (Effect Studio preview). */
  /**
   * Effect Studio previews are temporary: the first one snapshots the strip, later ones
   * keep that original snapshot, and the strip returns by itself after PREVIEW_SECONDS.
   */
  async previewCustomEffect(effect: CustomEffect) {
    this.assertEffects();
    await this.runTemporarily(PREVIEW_SECONDS, (api) => applyCustomEffect(api, effect));
  }

  async previewEffect(key: string) {
    this.assertEffects();
    await this.runTemporarily(PREVIEW_SECONDS, (api) => this.playEffectWith(api, key));
  }

  /** Is there a snapshot waiting to be restored (a preview or a "for x seconds" card)? */
  hasPendingRestore(): boolean {
    return Boolean(this.getStoreValue(STORE_KEY));
  }

  /** "Keep it": the current look stays, the snapshot is dropped. */
  async keepCurrentState() {
    await this.cancelTemporary('kept by the user');
  }

  private async playEffectWith(api: TapoApi, key: string) {
    this.assertEffects();
    const scene = sceneParams(key);
    if (scene) {
      await applyScene(api, scene);
      return;
    }
    await api.turnOn();
    await api.setLightingEffect(key);
  }

  private async playCustomWith(api: TapoApi, effectIdOrName: string) {
    this.assertEffects();
    const effect = savedEffects(this.homey.settings)
      .find((e) => e.id === effectIdOrName || e.name === effectIdOrName);
    if (!effect) throw new Error('That custom effect no longer exists. Pick another one in the Flow card.');
    await applyCustomEffect(api, effect);
  }

  private assertEffects() {
    if (!this.hasCapability('tapo_effect')) throw new Error('This light does not support effects.');
  }

  async restoreNow() {
    if (!this.getStoreValue(STORE_KEY)) throw new Error('There is no temporary change to undo.');
    this.homey.clearTimeout(this.restoreTimer);
    await this.restore(1);
    // restore() retries quietly in the background; someone pressing "Undo" needs to know.
    if (this.getStoreValue(STORE_KEY)) {
      throw new Error('Could not reach the strip to undo. It will keep trying for a little while.');
    }
  }

  private async runTemporarily(seconds: number, apply: (api: TapoApi) => Promise<void>) {
    if (!(seconds > 0)) throw new Error('Duration must be at least 1 second.');

    // Only the first override takes the snapshot: a second one while active must
    // still return to the *original* state, not to the first override's colour.
    const existing = this.getStoreValue(STORE_KEY) as PendingRestore | null;
    const snapshot = existing?.snapshot ?? toSnapshot(await this.withDevice((api) => api.getDeviceInfo()) as any);

    this.homey.clearTimeout(this.restoreTimer);
    await this.withDevice(apply);

    const pending: PendingRestore = { snapshot, until: Date.now() + seconds * 1000 };
    await this.setStoreValue(STORE_KEY, pending);
    this.scheduleRestore(seconds * 1000);
    this.log(`Temporary state for ${seconds} s; will restore`, JSON.stringify(snapshot));
    this.updateStateFromDevice().catch(this.error);
  }

  private scheduleRestore(delayMs: number, attempt = 1) {
    this.homey.clearTimeout(this.restoreTimer);
    this.restoreTimer = this.homey.setTimeout(() => {
      this.restore(attempt).catch(this.error);
    }, delayMs);
  }

  private async restore(attempt: number) {
    const pending = this.getStoreValue(STORE_KEY) as PendingRestore | null;
    if (!pending) return;
    const plan = restorePlan(pending.snapshot);
    try {
      await this.withDevice(async (api) => {
        await api.send(plan.request);
        if (plan.effect) await api.setLightingEffect(plan.effect);
        if (plan.scene) await api.send(plan.scene);
        // A custom effect can only be replayed if it's still saved (it is known only by name).
        if (plan.customEffect) await this.playCustomWith(api, plan.customEffect).catch(this.error);
      });
      await this.unsetStoreValue(STORE_KEY);
      this.log('Restored previous state.');
      this.updateStateFromDevice().catch(this.error);
    } catch (error) {
      if (attempt < RESTORE_ATTEMPTS) {
        this.error(`Restore attempt ${attempt} failed, retrying:`, error instanceof Error ? error.message : error);
        this.scheduleRestore(RESTORE_RETRY_MS, attempt + 1);
      } else {
        // Keep the snapshot stored: the next app start (or "restore" card) tries again.
        this.error('Could not restore the previous state:', error instanceof Error ? error.message : error);
      }
    }
  }

  private async cancelTemporary(reason: string) {
    if (!this.getStoreValue(STORE_KEY)) return;
    this.homey.clearTimeout(this.restoreTimer);
    await this.unsetStoreValue(STORE_KEY);
    this.log(`Pending restore cancelled: ${reason}.`);
  }

}
