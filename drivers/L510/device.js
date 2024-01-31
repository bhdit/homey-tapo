'use strict';

const { Device } = require('homey');
const tapoApi = require('tp-link-tapo-connect/dist/api');

class L510Device extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.deviceApi = await tapoApi.loginDeviceByIp(
      this.homey.settings.get('username'),
      this.homey.settings.get('password'),
      this.getStore().ip,
    );
    await this.updateStateFromDevice();

    // VARIABLES GENERIC
    this.pollingFailures = 0;

    this.registerCapabilityListener('onoff', this.#onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', async (value, opts) => {
      this.log('dim', {
        value: Math.trunc(value * 100),
        opts,
      });
      await this.deviceApi.setBrightness(Math.trunc(value * 100));
      await this.updateStateFromDevice();
    });
  }

  async #onCapabilityOnoff(state) {
    this.log('onCapabilityOnoff state', state);
    if (state) {
      await this.deviceApi.turnOn();
    } else {
      await this.deviceApi.turnOff();
    }
  }

  async updateStateFromDevice() {
    const deviceState = await this.deviceApi.getDeviceInfo();
    await this.setCapabilityValue('dim', deviceState.brightness <= 0 ? 0 : deviceState.brightness / 100);
    await this.setCapabilityValue('onoff', deviceState.device_on);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
    this.homey.setTimeout(async () => {
      try {
        await this.updateStateFromDevice();
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

}

module.exports = L510Device;
