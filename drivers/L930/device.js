'use strict';

const { Device } = require('homey');
const tapoApi = require('tp-link-tapo-connect/dist/api');

class L930Device extends Device {

  #deviceApi;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');

    this.deviceApi = await tapoApi.loginDeviceByIp(
      this.homey.settings.get('username'),
      this.homey.settings.get('password'),
      this.getStore().ip,
    );
    await this.#updateStateFromDevice();

    // VARIABLES GENERIC
    this.pollingFailures = 0;

    // ADDING CAPABILITY LISTENERS
    // this.registerCapabilityListener('onoff', this.#onCapabilityOnoff.bind(this));

    this.registerCapabilityListener('onoff', this.#onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', async (value, opts) => {
      this.log('dim', {
        value: value * 100,
        opts,
      });
      await this.deviceApi.setBrightness(value * 100);
      await this.#updateStateFromDevice();
    });

    this.registerCapabilityListener('light_temperature', async (value) => {
      this.log('light_temperature', 6500 - (4000 * value));
      const kelvin = 6500 - (4000 * value);
      await this.deviceApi.setColour(`${kelvin}k`);
      await this.#updateStateFromDevice();
    });

    this.registerCapabilityListener('tapo_effect', async (value) => {
      this.log('light_effect', value);
      await this.deviceApi.setLightingEffect(value);
      await this.#updateStateFromDevice();
    });

    this.registerCapabilityListener('light_mode', async (...value) => {
      this.log('light_mode', value);
      await this.#updateStateFromDevice();
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
      await this.deviceApi.send({
        method: 'set_device_info',
        params: {
          hue: Math.trunc(lightHue * 360),
          saturation: Math.trunc(lightSaturation * 100),
          color_temp: 0,
        },
      });
    }, 500);
    await this.#updateStateFromDevice();
  }

  async #onCapabilityOnoff(state) {
    this.log('onCapabilityOnoff state', state);
    if (state) {
      await this.deviceApi.turnOn();
    } else {
      await this.deviceApi.turnOff();
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
    this.homey.setTimeout(async () => {
      try {
        await this.#updateStateFromDevice();
      } catch (error) {
        this.error(error);
      }
    }, 5000);
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }) {
    this.log('MyDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
  }

  async #updateStateFromDevice() {
    const deviceState = await this.deviceApi.getDeviceInfo();
    await this.setCapabilityValue('dim', deviceState.brightness <= 0 ? 0 : deviceState.brightness / 100);
    await this.setCapabilityValue('light_temperature', (deviceState.color_temp - 2500) / 4000 || 0);
    await this.setCapabilityValue('light_hue', Math.trunc(360 / deviceState.hue));
    await this.setCapabilityValue('light_saturation', Math.trunc(deviceState.saturation / 100));
    await this.setCapabilityValue('onoff', deviceState.device_on);
  }

}

module.exports = L930Device;
