import { TapoDeviceLightInfo } from 'tp-link-tapo-connect/dist/types';

import GenericDevice from '../device';

export = class L510Device extends GenericDevice {

  /**
   * onInit is called when the device is initialized.
   */
  async register(): Promise<void> {
    this.registerCapabilityListener('onoff', async (state: boolean) => {
      this.log('onCapabilityOnoff state', state);
      if (state) {
        await this.deviceApi?.turnOn();
      } else {
        await this.deviceApi?.turnOff();
      }
    });
    this.registerCapabilityListener('dim', async (value: number, opts: { [key: string]: any }) => {
      this.log('dim', {
        value: Math.trunc(value * 100),
        opts,
      });
      await this.deviceApi?.setBrightness(Math.trunc(value * 100));
      await this.updateStateFromDevice();
    });
  }

  async updateStateFromDevice(): Promise<void> {
    const deviceState = await this.deviceApi?.getDeviceInfo() as TapoDeviceLightInfo;
    if (!deviceState) return;

    if (deviceState?.brightness) {
      await this.setCapabilityValue('dim', deviceState?.brightness <= 0 ? 0 : deviceState?.brightness / 100);
    }
    await this.setCapabilityValue('onoff', deviceState.device_on);
  }

}
