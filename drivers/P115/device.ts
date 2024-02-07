import GenericDevice from '../device';

export default class P115Device extends GenericDevice {

  /**
   * onInit is called when the device is initialized.
   */
  async register() {
    this.log('MyDevice P115Device has been initialized');
    this.registerCapabilityListener('onoff', async (state) => {
      this.log('onCapabilityOnoff state', state);
      if (state) {
        await this.deviceApi?.turnOn();
      } else {
        await this.deviceApi?.turnOff();
      }
    });
  }

  async updateStateFromDevice() {
    const deviceState = await this.deviceApi?.getDeviceInfo();
    if (!deviceState) return;

    await this.setCapabilityValue('onoff', deviceState.device_on);
  }

}
