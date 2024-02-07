import sourceMapSupport from 'source-map-support';
import Homey from 'homey';
// eslint-disable-next-line node/no-unsupported-features/node-builtins
import inspector from 'inspector';

sourceMapSupport.install();

export default class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const debug = this.homey.settings.get('debug');
    if (debug === 'enabled') {
      try {
        inspector.open(9229, '0.0.0.0');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        this.log(`Couldn't start inspector: ${err.message}`);
      }
    }
  }

}

module.exports = MyApp;
