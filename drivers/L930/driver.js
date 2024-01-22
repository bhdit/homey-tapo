'use strict';

const { Driver } = require('homey');
const tapoApi = require('tp-link-tapo-connect/dist/api');

class MyDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
    this.TAPO_USERNAME = this.homey.settings.get('username');
    this.TAPO_PASSWORD = this.homey.settings.get('password');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    const devices = await this.getTapoDevices();
    return devices.map(({
      model,
      nickname,
      device_id: deviceId,
      ip,
      mac,
    }) => ({
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
    }));
  }

  async getTapoDevices() {
    let devices = [];

    const discoveredDevices = this.homey.discovery.getStrategy('tapomac')
      .getDiscoveryResults();
    if (Object.values(discoveredDevices).length > 0) {
      devices = await Promise.all(
        Object.values(discoveredDevices)
          .map(async (device) => {
            const tapoDevice = await tapoApi.loginDeviceByIp(this.TAPO_USERNAME, this.TAPO_PASSWORD, device.address);
            return tapoDevice.getDeviceInfo();
          }),
      );
    }
    this.log(devices);
    return devices;
  }

}

module.exports = MyDriver;
