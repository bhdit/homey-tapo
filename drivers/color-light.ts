import { TapoDeviceLightInfo } from 'tp-link-tapo-connect/dist/types';
import LightDevice from './light';

const KELVIN_COOL = 6500;
const KELVIN_WARM = 2500;

// Homey's light_temperature: 0 = coolest, 1 = warmest.
const toKelvin = (value: number) => Math.round(KELVIN_COOL - (KELVIN_COOL - KELVIN_WARM) * value);
const fromKelvin = (kelvin: number) => Math.min(1, Math.max(0, (KELVIN_COOL - kelvin) / (KELVIN_COOL - KELVIN_WARM)));

/** Shared by the dimmable colour lights (L900, L920, L930). Capabilities a driver lacks are skipped. */
export = class ColorLightDevice extends LightDevice {

  async register() {
    this.registerOnOff();
    this.registerDim();

    if (this.hasCapability('light_temperature')) {
      this.registerCapabilityListener('light_temperature', async (value: number) => {
        await this.withDevice((api) => api.setColorTemp(toKelvin(value)));
        await this.setCapabilityValue('light_mode', 'temperature').catch(this.error);
      });
    }

    if (this.hasCapability('tapo_effect')) {
      this.registerCapabilityListener('tapo_effect', async (value: string) => {
        await this.playEffect(value);
      });
    }

    if (this.hasCapability('light_mode')) {
      // Mode is derived from state (colour vs temperature); nothing to send on its own.
      this.registerCapabilityListener('light_mode', async () => undefined);
    }

    this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], async (values) => {
      const hue = values.light_hue ?? this.getCapabilityValue('light_hue') ?? 0;
      const saturation = values.light_saturation ?? this.getCapabilityValue('light_saturation') ?? 1;
      await this.withDevice((api) => api.send({
        method: 'set_device_info',
        params: {
          hue: Math.round(hue * 360),
          saturation: Math.round(saturation * 100),
          color_temp: 0,
        },
      }));
      if (this.hasCapability('light_mode')) await this.setCapabilityValue('light_mode', 'color').catch(this.error);
    }, 500);
  }

  async updateStateFromDevice() {
    const state = await this.deviceApi?.getDeviceInfo() as TapoDeviceLightInfo | undefined;
    if (!state) return;

    await this.setCapabilityValue('onoff', state.device_on);
    if (typeof state.brightness === 'number' && state.brightness > 0) {
      await this.setCapabilityValue('dim', state.brightness / 100);
    }
    if (typeof state.hue === 'number') await this.setCapabilityValue('light_hue', state.hue / 360);
    if (typeof state.saturation === 'number') await this.setCapabilityValue('light_saturation', state.saturation / 100);

    const inTemperatureMode = typeof state.color_temp === 'number' && state.color_temp > 0;
    if (inTemperatureMode && this.hasCapability('light_temperature')) {
      await this.setCapabilityValue('light_temperature', fromKelvin(state.color_temp as number));
    }
    if (this.hasCapability('light_mode')) {
      await this.setCapabilityValue('light_mode', inTemperatureMode ? 'temperature' : 'color');
    }
    await this.updateUsageEnergy(state.device_on);
  }

}
