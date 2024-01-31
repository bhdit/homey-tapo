'use strict';

const BaseDriver = require('../driver');

class L930Driver extends BaseDriver {

  filter(devices) {
    return devices.filter((device) => device.model.includes('L930'));
  }

}

module.exports = L930Driver;
