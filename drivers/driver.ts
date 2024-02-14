import Homey from 'homey';
import { loginDeviceByIp, TapoDeviceInfo } from 'tp-link-tapo-connect';
import uniqBy from 'lodash.uniqby';
import GenericDevice from './device';

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

export = class GenericDriver extends Homey.Driver {

  protected TAPO_USERNAME = ''
  protected TAPO_PASSWORD = ''
  protected filterStrings: string[] = [];
  protected ipAddresses: string[] = [];

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
    this.TAPO_USERNAME = this.homey.settings.get('username');
    this.TAPO_PASSWORD = this.homey.settings.get('password');
  }

  async onPair(session: Homey.Driver.PairSession) {
    // Show a specific view by ID
    await session.showView('ip_lookup');

    // Close the pair session
    await session.done();

    session.setHandler('iplist', async (iplist: string[]) => {
      this.log('IP List', iplist);
      const result = this.validateIpAddresses(iplist);
      this.ipAddresses = iplist;
      return result;
    });

    session.setHandler('list_devices', async () => {
      const devices = await this.getTapoDevices();
      return this.filter(uniqBy(devices, 'device_id'))
        .map((device) => this.mapDeviceProperties(device));
    });
  }

  private validateIpAddresses(ipAddresses: string[]) {
    try {
      if (ipAddresses.length === 0) {
        return { error: 'No IP addresses provided.' };
      }
      ipAddresses.forEach((ipAddress) => {
        if (!ipAddress.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/g)) {
          throw Error(`Invalid IP address: ${ipAddress}`);
        }
      });
    } catch (error: any) {
      return { error: error.message };
    }
    return { success: 'IP addresses validated successfully' };
  }

  protected async getDevicesByIp(): Promise<(TapoDeviceInfo | undefined | void)[]> {
    this.log("Login with IP's", this.ipAddresses);
    const devices = await Promise.all(this.ipAddresses.map(async (ipAddress) => {
      this.log('Login with IP', ipAddress);
      const tapoDevice = await loginDeviceByIp(this.TAPO_USERNAME, this.TAPO_PASSWORD, ipAddress).catch(this.error);
      return tapoDevice?.getDeviceInfo().catch(this.error);
    }));
    this.log('getDevicesByIp', devices);
    return devices.flat();
  }

  async getTapoDevices(): Promise<TapoDeviceInfo[]> {
    const devices: (undefined | void | TapoDeviceInfo | (undefined | void | TapoDeviceInfo)[])[] = [];
    if (!this.TAPO_PASSWORD || !this.TAPO_USERNAME) {
      throw Error('Tapo Username, Password must be set in settings. Restart app after save.');
    }
    devices.push(await this.getDevicesByIp());
    this.log({ devicesByIp: devices });

    const discoveryStrategy = this.homey.discovery.getStrategy('tapomac');
    const discoveredDevices = discoveryStrategy.getDiscoveryResults();
    this.log({ discoveredDevices });
    if (Object.keys(discoveredDevices).length > 0) {
      devices.push(await Promise.all(
        Object.values(discoveredDevices)
          .map(async (device) => {
            const tapoDevice = await loginDeviceByIp(this.TAPO_USERNAME, this.TAPO_PASSWORD, device.address);
            this.log(await tapoDevice.getDeviceInfo());
            return tapoDevice.getDeviceInfo();
          }),
      ));
    }

    return devices.flat().filter(Boolean) as TapoDeviceInfo[];
  }

  private mapDeviceProperties({
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

  filter(devices: TapoDeviceInfo[]) {
    return !this.filterStrings ? devices : devices.filter((device) => this.filterStrings.includes(device.model));
  }

  async onRepair(session: Homey.Driver.PairSession, device: GenericDevice) {
    session.setHandler('repair', async (ip: string) => {
      await device.changeIpAddress(ip);
    });
    session.setHandler('getIp', async () => {
      const ip = await device.getStoreValue('ip');
      return ip;
    });

    session.setHandler('disconnect', async () => {
      // Cleanup
      console.log('cleanup');
    });
  }

}
