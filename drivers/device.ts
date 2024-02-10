import Homey from 'homey';
import { loginDeviceByIp, TapoDeviceInfo } from 'tp-link-tapo-connect';

type TapoApi = Awaited<ReturnType<typeof loginDeviceByIp>>

export = class GenericDevice extends Homey.Device {

  deviceApi: TapoApi | undefined;
  deviceInfo: TapoDeviceInfo | void = undefined;
  pollingFailures: number = 0;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');

    await this.loginDevice().catch(this.error);
    this.log({ info: this.deviceInfo });
    await this.setSettings({
      ipaddress: this.deviceInfo?.ip,
    });
    await this.setupPolling().catch(this.error);
    await this.register();
  }

  async register(): Promise<void> { /* Register capabilities */ }

  async loginDevice(): Promise<void> {
    this.deviceApi = await loginDeviceByIp(
      this.homey.settings.get('username'),
      this.homey.settings.get('password'),
      this.getStore().ip,
    );

    this.deviceInfo = await this.deviceApi?.getDeviceInfo().catch(this.error);
  }

  async setupPolling() {
    this.homey.setInterval(async () => {
      if (this.pollingFailures > 5) {
        this.error('Too many polling failures, stopping polling.');
        return;
      }
      if (!this.deviceApi) return;
      try {
        await this.updateStateFromDevice().catch(this.error);
      } catch (error) {
        this.log('GOT ERROR', error);
        this.pollingFailures += 1;
        this.error(error);
      }
    }, 15000);

    this.homey.setInterval(async () => {
      this.log(`Started session refresh. Polling failures: ${this.pollingFailures}`);
      if (this.pollingFailures > 5) {
        this.error('Too many polling failures, stopping polling.');
        return;
      }
      try {
        this.deviceApi = await loginDeviceByIp(
          this.homey.settings.get('username'),
          this.homey.settings.get('password'),
          this.getStore().ip,
        );
      } catch (error) {
        this.pollingFailures += 1;
        this.error(error);
      }
    }, 600000);
  }

  async updateStateFromDevice() {
    throw new Error('You have to implement the method updateStateFromDevice!');
  }

  async onSettings({ newSettings, changedKeys }: { [key: string]: any }): Promise<void> {
    await this.setSettings(newSettings);
    if (changedKeys.includes('ipaddress')) {
      await this.setStoreValue('ip', newSettings.ipaddress);
    }
  }

}
