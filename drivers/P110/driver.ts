import { type Driver } from 'homey';
import Homey from 'homey/lib/Homey';
import { TapoDeviceInfo, loginDeviceByIp } from 'tp-link-tapo-connect';
import GenericDriver from '../driver';

export = class extends GenericDriver {

  filterStrings = ['P110'];

}
