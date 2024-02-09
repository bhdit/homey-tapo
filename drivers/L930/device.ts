import { TapoDeviceLightInfo } from 'tp-link-tapo-connect/dist/types';
import GenericDevice from '../device';

export = class L930Device extends GenericDevice {

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

    this.registerCapabilityListener('light_temperature', async (value) => {
      this.log('light_temperature', 6500 - (4000 * value));
      const kelvin = 6500 - (4000 * value);
      await this.deviceApi?.setColour(`${kelvin}k`);
      await this.updateStateFromDevice();
    });

    this.registerCapabilityListener('tapo_effect', async (value) => {
      this.log('light_effect', value);
      await this.deviceApi?.setLightingEffect(value);
      await this.updateStateFromDevice();
    });

    this.registerCapabilityListener('light_mode', async (...value) => {
      this.log('light_mode', value);
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
    await this.updateStateFromDevice();
  }

  async updateStateFromDevice() {
    const deviceState = await this.deviceApi?.getDeviceInfo() as TapoDeviceLightInfo;
    if (!deviceState) return;

    await this.setCapabilityValue('onoff', deviceState.device_on);

    if (deviceState?.brightness) {
      await this.setCapabilityValue('dim', deviceState.brightness <= 0 ? 0 : deviceState.brightness / 100);
    }
    if (deviceState?.color_temp) {
      await this.setCapabilityValue('light_temperature', (deviceState.color_temp - 2500) / 4000 || 0);
    }
    if (deviceState?.hue) {
      await this.setCapabilityValue('light_hue', Math.trunc(360 / deviceState.hue));
    }
    if (deviceState?.saturation) {
      await this.setCapabilityValue('light_saturation', Math.trunc(deviceState.saturation / 100));
    }
  }

}
