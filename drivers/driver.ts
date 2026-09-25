import Homey from 'homey';
import { TapoDeviceInfo } from 'tp-link-tapo-connect';
import GenericDevice from './device';
import { getCredentials, login, withTimeout } from '../lib/tapo/connection';
import { classifyError, TapoError } from '../lib/tapo/errors';
import {
  baseModel, discoverTapoDevices, isSupportedType, normalizeMac,
} from '../lib/tapo/discovery';

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

/** An address worth trying a login on, and what (if anything) we already know about it. */
type Candidate = { ip: string, mac?: string, model?: string, source: 'network' | 'homey' };

export = class GenericDriver extends Homey.Driver {

  protected filterStrings: string[] = [];

  async onInit() {
    this.log('Driver initialized');
  }

  async onPair(session: Homey.Driver.PairSession) {
    session.setHandler('list_devices', async () => {
      const devices = await this.findPairableDevices();
      return devices.map((device) => this.mapDeviceProperties(device));
    });
  }

  private matchesDriver(model: string | undefined) {
    return this.filterStrings.length === 0 || this.filterStrings.includes(baseModel(model));
  }

  private async collectCandidates(): Promise<Candidate[]> {
    const candidates = new Map<string, Candidate>(); // keyed by IP

    // 1. Tapo discovery broadcast — knows the model before login, so non-matching
    //    devices (other drivers, cameras) are skipped without a login attempt.
    try {
      const found = await discoverTapoDevices({ maxAgeMs: 0 });
      this.log(`Network discovery: ${found.length} TP-Link device(s):`, found.map((d) => `${d.model}@${d.ip}`).join(', '));
      found
        .filter((d) => isSupportedType(d) && this.matchesDriver(d.model))
        .forEach((d) => candidates.set(d.ip, {
          ip: d.ip, mac: d.mac, model: d.model, source: 'network',
        }));
    } catch (error) {
      this.error('Network discovery failed, falling back to Homey discovery:', error);
    }

    // 2. Homey's own MAC-prefix discovery — model unknown until login.
    try {
      const results = this.homey.discovery.getStrategy('tapomac').getDiscoveryResults();
      Object.values(results).forEach((result: any) => {
        if (result?.address && !candidates.has(result.address)) {
          candidates.set(result.address, { ip: result.address, mac: normalizeMac(result.mac ?? result.id), source: 'homey' });
        }
      });
    } catch (error) {
      this.error('Homey discovery strategy unavailable:', error);
    }

    // The same device can surface through two sources at different IPs (stale ARP) —
    // prefer the network-discovery entry for a MAC we've already seen.
    const seenMacs = new Set<string>();
    return [...candidates.values()]
      .sort((a, b) => (a.source === 'network' ? -1 : 0) - (b.source === 'network' ? -1 : 0))
      .filter((c) => {
        if (!c.mac) return true;
        if (seenMacs.has(c.mac)) return false;
        seenMacs.add(c.mac);
        return true;
      });
  }

  async findPairableDevices(): Promise<TapoDeviceInfo[]> {
    const credentials = getCredentials(this.homey.settings);
    const candidates = await this.collectCandidates();
    this.log('Pairing candidates:', candidates.map((c) => `${c.ip} (${c.source}${c.model ? `, ${c.model}` : ''})`).join(', ') || 'none');

    // allSettled: one camera, router or offline plug must not fail the whole list.
    const outcomes = await Promise.allSettled(candidates.map(async (candidate) => {
      const api = await login(credentials, candidate.ip);
      return withTimeout(api.getDeviceInfo(), 10_000, `get_device_info ${candidate.ip}`);
    }));

    const devices: TapoDeviceInfo[] = [];
    const failures: TapoError[] = [];
    outcomes.forEach((outcome, index) => {
      const candidate = candidates[index];
      if (outcome.status === 'fulfilled') {
        devices.push(outcome.value);
        return;
      }
      const error = classifyError(outcome.reason, candidate.ip);
      // An unknown box from Homey's MAC match not being Tapo is expected; a
      // device the network scan identified as this model failing is not.
      if (candidate.source !== 'homey' || error.kind === 'credentials') failures.push(error);
      this.log(`Pairing: ${candidate.ip} (${candidate.source}) skipped — [${error.kind}] ${error.message}`);
    });

    const unique = new Map<string, TapoDeviceInfo>();
    devices
      .filter((device) => this.matchesDriver(device.model))
      .forEach((device) => unique.set(device.device_id, device));

    if (unique.size === 0 && failures.length > 0) {
      // Surface *why* the list is empty instead of an empty list with no explanation.
      const credentialFailure = failures.find((f) => f.kind === 'credentials');
      throw new Error(credentialFailure
        ? credentialFailure.message
        : `Found ${failures.length} device(s) but could not connect: ${failures.map((f) => f.message).join(' ')}`);
    }
    return [...unique.values()];
  }

  private mapDeviceProperties({
    nickname,
    model,
    device_id: deviceId,
    ip,
    mac,
  }: TapoDeviceInfo): Device {
    return {
      name: nickname || model,
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

  async onRepair(session: Homey.Driver.PairSession, device: GenericDevice) {
    session.setHandler('repair', async (ip: string) => {
      // Throws a readable error; the repair view shows it instead of closing.
      await device.changeIpAddress(ip);
    });

    session.setHandler('getIp', async () => device.getStoreValue('ip'));

    session.setHandler('discover', async () => {
      const mac = normalizeMac(device.getData().mac ?? device.getStoreValue('mac'));
      const found = (await discoverTapoDevices({ maxAgeMs: 0 })).find((d) => d.mac === mac);
      if (!found) throw new Error('Device not found on the network. Check it is powered and on the same network as Homey.');
      return found.ip;
    });
  }

}
