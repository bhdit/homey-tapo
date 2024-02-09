'use strict';

const BaseDriver = require('../driver');

class Driver extends BaseDriver {

  filter(devices) {
    return devices.filter((device) => device.model.includes('L920'));
  }

}

module.exports = Driver;
