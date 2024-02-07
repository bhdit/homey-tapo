import Homey from 'homey';
import { loginDeviceByIp, TapoDeviceInfo } from 'tp-link-tapo-connect';
import uniqBy from 'lodash.uniqby';

type Device = {
  name: string,
  data: {
    id: string,
    mac: string,
  },
  store: {
    ip: string,
    deviceId: string,
    mac: string,
  },
}

export default class GenericDriver extends Homey.Driver {

  #IP_ADDRESS = ''
  #TAPO_USERNAME = ''
  #TAPO_PASSWORD = ''
  filterStrings: string[] = [];

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
  }: TapoDeviceInfo): Device {
    return {
      name: nickname,
      data: {
        id: deviceId,
        mac,
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
    const devices = uniqBy(await this.getTapoDevices(), 'device_id');
    this.log('DEVICES:', JSON.stringify(devices));
    return this.filter(devices)
      .map(this.#mapDeviceProperties);
  }

  async getTapoDevices(): Promise<TapoDeviceInfo[]> {
    const devices: (undefined | void | TapoDeviceInfo | (undefined | void | TapoDeviceInfo)[])[] = [];
    if (!this.#TAPO_PASSWORD || !this.#TAPO_USERNAME) {
      throw Error('Tapo Username, Password must be set in settings. Restart app after save.');
    }
    if (this.#IP_ADDRESS) {
      const tapoDevice = await loginDeviceByIp(this.#TAPO_USERNAME, this.#TAPO_PASSWORD, this.#IP_ADDRESS).catch(this.error);
      this.log(this.#IP_ADDRESS, tapoDevice);
      devices.push(await tapoDevice?.getDeviceInfo().catch(this.error));
    }
    const discoveredDevices = this.homey.discovery.getStrategy('tapomac')
      .getDiscoveryResults();
    this.log({ discoveredDevices });
    if (Object.keys(discoveredDevices).length > 0) {
      devices.push(await Promise.all(
        Object.values(discoveredDevices)
          .map(async (device) => {
            const tapoDevice = await loginDeviceByIp(this.#TAPO_USERNAME, this.#TAPO_PASSWORD, device.address);
            this.log(await tapoDevice.getDeviceInfo());
            return tapoDevice.getDeviceInfo();
          }),
      ));
    } else if (!this.#IP_ADDRESS) {
      throw Error('MAC discovery failed. Enter device IP in settings.');
    }

    return devices.flat().filter(Boolean) as TapoDeviceInfo[];
  }

  filter(devices: TapoDeviceInfo[]) {
    return !this.filterStrings ? devices : devices.filter((device) => this.filterStrings.includes(device.model));
  }

}

module.exports = GenericDriver