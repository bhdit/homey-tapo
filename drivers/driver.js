'use strict';

const { Driver } = require('homey');
const tapoApi = require('tp-link-tapo-connect/dist/api');

class BaseDriver extends Driver {

  #IP_ADDRESS;
  #TAPO_USERNAME;
  #TAPO_PASSWORD;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
    this.#TAPO_USERNAME = this.homey.settings.get('username');
    this.#TAPO_PASSWORD = this.homey.settings.get('password');
    this.#IP_ADDRESS = this.homey.settings.get('ipaddress');
  }

  #mapDeviceProperties({
    model,
    nickname,
    device_id: deviceId,
    ip,
    mac,
  }) {
    return {
      name: nickname,
      data: {
        id: model,
        deviceId,
      },
      store: {
        ip,
        deviceId,
        mac,
      },
    };
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    const devices = await this.getTapoDevices();
    this.log('DEVICES:', JSON.stringify(devices));
    return this.filter(devices)
      .map(this.#mapDeviceProperties);
  }

  filter(devices) {
    return devices;
  }

  async getTapoDevices() {
    const devices = [];
    if (!this.#TAPO_PASSWORD || !this.#TAPO_USERNAME) {
      throw Error('Tapo Username, Password must be set in settings. Restart app after save.');
    }
    if (this.#IP_ADDRESS) {
      const tapoDevice = await tapoApi.loginDeviceByIp(this.#TAPO_USERNAME, this.#TAPO_PASSWORD, this.#IP_ADDRESS);
      devices.push(await tapoDevice.getDeviceInfo());
    }
    const discoveredDevices = this.homey.discovery.getStrategy('tapomac')
      .getDiscoveryResults();
    if (Object.values(discoveredDevices).length > 0) {
      devices.push(await Promise.all(
        Object.values(discoveredDevices)
          .map(async (device) => {
            const tapoDevice = await tapoApi.loginDeviceByIp(this.#TAPO_USERNAME, this.#TAPO_PASSWORD, device.address);
            return tapoDevice.getDeviceInfo();
          }),
      ));
    } else if (!this.#IP_ADDRESS) {
      throw Error('MAC discovery failed. Enter device IP in settings.');
    }

    return devices.flat();
  }

}

module.exports = BaseDriver;
