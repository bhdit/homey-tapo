'use strict';

const Homey = require('homey');
// eslint-disable-next-line node/no-unsupported-features/node-builtins
const inspector = require('inspector');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const debug = this.homey.settings.get('debug');
    if (debug === 'enabled') {
      try {
        inspector.open(9229, '0.0.0.0');
      } catch (err) {
        this.log(`Couldn't start inspector: ${err.message}`);
      }
    }
  }

}

module.exports = MyApp;
