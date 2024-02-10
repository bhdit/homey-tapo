import { TapoDeviceLightInfo } from 'tp-link-tapo-connect/dist/types';
import GenericDevice from '../device';

export = class L900Device extends GenericDevice {

  /**
   * onInit is called when the device is initialized.
   */
  async register() {
    this.registerCapabilityListener('onoff', async (state) => {
      this.log('onCapabilityOnoff state', state);
      if (state) {
        await this.deviceApi?.turnOn();
      } else {
        await this.deviceApi?.turnOff();
      }
    });
    this.registerCapabilityListener('dim', async (value, opts) => {
      this.log('dim', {
        value: Math.trunc(value * 100),
        opts,
      });
      await this.deviceApi?.setBrightness(Math.trunc(value * 100));
      await this.updateStateFromDevice();
    });
    this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], async (valueObj, optsObj) => {
      const {
        light_hue: lightHue,
        light_saturation: lightSaturation,
        // eslint-disable-next-line prefer-object-spread
      } = Object.assign({
        light_hue: 0,
        light_saturation: 0,
      }, valueObj);
      this.log({
        method: 'set_device_info',
        params: {
          hue: Math.trunc(lightHue * 360),
          saturation: Math.trunc(lightSaturation * 100),
          color_temp: 0,
        },
      });
      await this.deviceApi?.send({
        method: 'set_device_info',
        params: {
          hue: Math.trunc(lightHue * 360),
          saturation: Math.trunc(lightSaturation * 100),
          color_temp: 0,
        },
      });
    }, 500);
  }

  async updateStateFromDevice() {
    const deviceState = await this.deviceApi?.getDeviceInfo() as TapoDeviceLightInfo;
    if (!deviceState) return;

    if (deviceState?.brightness) {
      await this.setCapabilityValue('dim', deviceState.brightness <= 0 ? 0 : deviceState.brightness / 100);
    }
    await this.setCapabilityValue('onoff', deviceState.device_on);
  }

}
