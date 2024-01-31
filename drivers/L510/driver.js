'use strict';

const BaseDriver = require('../driver');

class L510Driver extends BaseDriver {

  filter(devices) {
    return devices.filter((device) => device.model.includes('L510'));
  }

}

module.exports = L510Driver;
