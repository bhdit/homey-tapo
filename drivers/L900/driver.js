'use strict';

const BaseDriver = require('../driver');

class L900Driver extends BaseDriver {

  filter(devices) {
    return devices.filter((device) => device.model.includes('L900'));
  }

}

module.exports = L900Driver;
