import sourceMapSupport from 'source-map-support';
import Homey from 'homey';
// eslint-disable-next-line node/no-unsupported-features/node-builtins
import inspector from 'inspector';
import LightDevice from './drivers/light';
import { savedEffects } from './lib/tapo/effects';

sourceMapSupport.install();

export default class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const debug = this.homey.settings.get('debug');
    if (debug === 'enabled') {
      try {
        inspector.open(9229, '0.0.0.0');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        this.log(`Couldn't start inspector: ${err.message}`);
      }
    }

    this.registerFlowCards();

    // Credentials are read on every login, so a change only needs devices to retry now
    // rather than wait out their reconnect back-off (and no app restart).
    this.homey.settings.on('set', (key: string) => {
      if (key !== 'username' && key !== 'password') return;
      this.log(`Setting "${key}" changed, reconnecting devices.`);
      Object.values(this.homey.drivers.getDrivers()).forEach((driver) => {
        driver.getDevices().forEach((device) => (device as unknown as { resetConnection?: () => void }).resetConnection?.());
      });
    });
  }

  private registerFlowCards() {
    type Args = { device: LightDevice, [key: string]: any };
    const cards: { [id: string]: (args: Args) => Promise<void> } = {
      temporary_brightness: ({ device, brightness, duration }) => device.temporaryBrightness(brightness, duration),
      temporary_off: ({ device, duration }) => device.temporaryOff(duration),
      temporary_color: ({
        device, color, brightness, duration,
      }) => device.temporaryColor(color, brightness, duration),
      temporary_effect: ({ device, effect, duration }) => device.temporaryEffect(effect, duration),
      restore_state: ({ device }) => device.restoreNow(),
      play_effect: ({ device, effect }) => device.playEffect(effect),
      play_custom_effect: ({ device, effect }) => device.playCustomEffect(effect.id),
      temporary_custom_effect: ({ device, effect, duration }) => device.temporaryCustomEffect(effect.id, duration),
    };
    Object.entries(cards).forEach(([id, run]) => {
      this.homey.flow.getActionCard(id).registerRunListener(run);
    });

    // Saved effects are offered by name; the card stores the id, so renaming one keeps flows working.
    const listSaved = async (query: string) => savedEffects(this.homey.settings)
      .filter((e) => e.name.toLowerCase().includes(String(query ?? '').toLowerCase()))
      .map((e) => ({ id: e.id, name: e.name, description: `${e.style}, ${e.colors.length} colour(s)` }));
    ['play_custom_effect', 'temporary_custom_effect'].forEach((id) => {
      this.homey.flow.getActionCard(id).registerArgumentAutocompleteListener('effect', listSaved);
    });
  }

}

module.exports = MyApp;
