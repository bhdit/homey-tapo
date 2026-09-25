import { TapoDeviceLightInfo } from 'tp-link-tapo-connect/dist/types';
import LightDevice from '../light';

export = class L510Device extends LightDevice {

  async register(): Promise<void> {
    this.registerOnOff();
    this.registerDim();
  }

  async updateStateFromDevice(): Promise<void> {
    const state = await this.deviceApi?.getDeviceInfo() as TapoDeviceLightInfo | undefined;
    if (!state) return;

    await this.setCapabilityValue('onoff', state.device_on);
    if (typeof state.brightness === 'number' && state.brightness > 0) {
      await this.setCapabilityValue('dim', state.brightness / 100);
    }
    await this.updateUsageEnergy(state.device_on);
  }

}
