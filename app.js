'use strict';

const Homey = require('homey');
// eslint-disable-next-line node/no-unsupported-features/node-builtins
const inspector = require('inspector');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');
    const debug = this.homey.settings.get('debug');
    this.log('debug', this.homey.settings.get('debug'));
    if (debug === 'enabled') {
      inspector.open(9229, '0.0.0.0');
    }
  }

}

module.exports = MyApp;
