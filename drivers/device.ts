import Homey from 'homey';
import { TapoDeviceInfo } from 'tp-link-tapo-connect';
import {
  getCredentials, login, TapoApi, withTimeout,
} from '../lib/tapo/connection';
import { classifyError, TapoError } from '../lib/tapo/errors';
import { findDeviceByMac, normalizeMac } from '../lib/tapo/discovery';
import { DeviceUsage, UsageMeter } from '../lib/tapo/usage-meter';

const POLL_MS = 15_000;
const COMMAND_TIMEOUT_MS = 10_000;
// While unreachable, how often to retry login + rediscovery (polls in between are skipped).
const RECONNECT_BACKOFF_MS = 60_000;
// One missed poll is common on Wi-Fi; only flag the device after this many in a row.
const FAILURES_BEFORE_UNAVAILABLE = 2;

// Homey passes its base DiscoveryResult type; for the "mac" strategy it also carries address + mac.
type DiscoveryResult = { id: string, address?: string, mac?: string };

function isIpv4(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export = class GenericDevice extends Homey.Device {

  deviceApi: TapoApi | undefined;
  deviceInfo: TapoDeviceInfo | undefined;

  private pollTimer: NodeJS.Timeout | undefined;
  private connecting: Promise<TapoApi> | undefined;
  private polling = false;
  private consecutiveFailures = 0;
  private lastConnectAttempt = 0;
  private lastErrorMessage = '';

  async onInit() {
    // Listeners first: they must exist even if the device is unreachable at boot,
    // otherwise commands are dropped until the next app restart.
    await this.register();
    this.pollTimer = this.homey.setInterval(() => this.poll(), POLL_MS);
    // Not awaited — a login can take seconds and onInit should not block the driver.
    this.poll().catch(this.error);
  }

  async onUninit() {
    this.homey.clearInterval(this.pollTimer);
  }

  async onDeleted() {
    this.homey.clearInterval(this.pollTimer);
  }

  async register(): Promise<void> { /* Register capabilities */ }

  async updateStateFromDevice(): Promise<void> {
    throw new Error('You have to implement the method updateStateFromDevice!');
  }

  private get expectedMac(): string {
    return normalizeMac(this.getData().mac ?? this.getStoreValue('mac'));
  }

  private get ip(): string | undefined {
    return this.getStoreValue('ip') || undefined;
  }

  // ---- connection ----------------------------------------------------------

  /** Logs in, following the device to a new IP if it moved. Concurrent callers share one attempt. */
  async connect(): Promise<TapoApi> {
    if (!this.connecting) {
      this.connecting = this.doConnect().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async doConnect(): Promise<TapoApi> {
    this.lastConnectAttempt = Date.now();
    const credentials = getCredentials(this.homey.settings);
    const storedIp = this.ip;

    let firstError: TapoError | undefined;
    if (storedIp) {
      try {
        return await this.loginAt(credentials, storedIp);
      } catch (error) {
        firstError = classifyError(error, storedIp);
        // Wrong credentials won't be fixed by a new address.
        if (firstError.kind === 'credentials') throw firstError;
      }
    }

    const found = await findDeviceByMac(this.expectedMac, { maxAgeMs: 0 })
      .catch((error) => {
        this.error('Network discovery failed:', error);
        return undefined;
      });
    if (!found) {
      throw firstError ?? new TapoError('unreachable', 'Device not found on the network.');
    }
    if (found.ip === storedIp && firstError) throw firstError;

    this.log(`Device found at new address ${storedIp ?? '(none)'} → ${found.ip}`);
    const api = await this.loginAt(credentials, found.ip);
    await this.saveIp(found.ip);
    return api;
  }

  private async loginAt(credentials: { username: string, password: string }, ip: string): Promise<TapoApi> {
    const api = await login(credentials, ip);
    const info = await withTimeout(api.getDeviceInfo(), COMMAND_TIMEOUT_MS, 'get_device_info');
    // After a DHCP reshuffle the old IP may belong to *another* Tapo device on
    // the same account — the login succeeds, so check we reached the right one.
    const expected = this.expectedMac;
    if (expected && normalizeMac(info.mac) && normalizeMac(info.mac) !== expected) {
      throw new TapoError('unreachable', `A different Tapo device (${info.nickname || info.model}) is now at ${ip}.`);
    }
    this.deviceApi = api;
    this.deviceInfo = info;
    return api;
  }

  private async saveIp(ip: string) {
    await this.setStoreValue('ip', ip);
    await this.setSettings({ ipaddress: ip }).catch(this.error);
  }

  /** Drop the session and reconnect on the next poll without waiting for the back-off. */
  resetConnection() {
    this.deviceApi = undefined;
    this.lastConnectAttempt = 0;
  }

  // ---- polling & availability ---------------------------------------------

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (!this.deviceApi) {
        const backingOff = this.consecutiveFailures > 0
          && Date.now() - this.lastConnectAttempt < RECONNECT_BACKOFF_MS;
        if (backingOff) return;
        await this.connect();
      }
      try {
        await withTimeout(this.updateStateFromDevice(), COMMAND_TIMEOUT_MS, 'poll');
      } catch (error) {
        // Tapo devices hold one local session at a time: the Tapo phone app or another
        // integration logging in ends ours with a 403. Log in again and retry right away
        // rather than losing this poll.
        if (classifyError(error, this.ip).kind !== 'session') throw error;
        this.noteSessionTakeover();
        this.deviceApi = undefined;
        await this.connect();
        await withTimeout(this.updateStateFromDevice(), COMMAND_TIMEOUT_MS, 'poll');
      }
      await this.markSuccess();
    } catch (error) {
      await this.markFailure(error);
    } finally {
      this.polling = false;
    }
  }

  private sessionTakeovers = 0;
  private lastTakeoverLog = 0;

  private noteSessionTakeover() {
    this.sessionTakeovers += 1;
    // Expected when something else also talks to the device; summarise instead of logging each one.
    if (Date.now() - this.lastTakeoverLog > 10 * 60_000) {
      this.log(`Session was taken over and renewed (${this.sessionTakeovers} time(s) so far). `
        + 'Another client — e.g. the Tapo app or Home Assistant — is probably connected to this device.');
      this.lastTakeoverLog = Date.now();
    }
  }

  private async markSuccess() {
    if (this.consecutiveFailures > 0) this.log(`Connection restored after ${this.consecutiveFailures} failed attempt(s).`);
    this.consecutiveFailures = 0;
    this.lastErrorMessage = '';
    if (!this.getAvailable()) await this.setAvailable().catch(this.error);
  }

  private async markFailure(error: unknown) {
    const tapoError = classifyError(error, this.ip);
    this.consecutiveFailures += 1;
    // Any failure invalidates the session; the next poll decides whether to retry now or back off.
    this.deviceApi = undefined;
    if (tapoError.kind === 'session') this.lastConnectAttempt = 0;

    // Log state changes, not every identical failure every 15 s.
    if (tapoError.message !== this.lastErrorMessage) {
      this.error(`[${tapoError.kind}] ${tapoError.message}`, tapoError.cause instanceof Error ? tapoError.cause.message : '');
      this.lastErrorMessage = tapoError.message;
    }

    const shouldFlag = tapoError.kind === 'credentials' || this.consecutiveFailures >= FAILURES_BEFORE_UNAVAILABLE;
    if (shouldFlag && this.getAvailable()) {
      await this.setUnavailable(tapoError.message).catch(this.error);
    }
  }

  // ---- commands ------------------------------------------------------------

  /**
   * Runs a command against the device. Reconnects (including rediscovery) and
   * retries once on a dead session, and throws a message Homey can show the user.
   * Commands are `set_device_info` calls, so a retry is idempotent.
   */
  async withDevice<T>(command: (api: TapoApi) => Promise<T>): Promise<T> {
    try {
      const api = this.deviceApi ?? await this.connect();
      const result = await withTimeout(command(api), COMMAND_TIMEOUT_MS, 'command');
      await this.markSuccess();
      return result;
    } catch (error) {
      const first = classifyError(error, this.ip);
      if (first.kind === 'credentials' || first.kind === 'not_tapo') {
        await this.markFailure(first);
        throw first;
      }
      this.deviceApi = undefined;
      try {
        const api = await this.connect();
        const result = await withTimeout(command(api), COMMAND_TIMEOUT_MS, 'command');
        await this.markSuccess();
        return result;
      } catch (retryError) {
        const final = classifyError(retryError, this.ip);
        await this.markFailure(final);
        throw final;
      }
    }
  }

  protected registerOnOff() {
    this.registerCapabilityListener('onoff', async (state: boolean) => {
      await this.withDevice((api) => (state ? api.turnOn() : api.turnOff()));
    });
  }

  protected registerDim() {
    this.registerCapabilityListener('dim', async (value: number) => {
      // Tapo brightness is 1–100; 0 is rejected by the device, so treat it as "off".
      if (value <= 0) {
        await this.withDevice((api) => api.turnOff());
        await this.setCapabilityValue('onoff', false).catch(this.error);
        return;
      }
      await this.withDevice((api) => api.setBrightness(Math.max(1, Math.round(value * 100))));
    });
  }

  // ---- estimated energy (lights) -------------------------------------------

  private usageMeter: UsageMeter | undefined;
  private usageSupported = true;
  private lastUsageSave = 0;

  /**
   * Energy for devices without a power meter, from the device's own usage estimate.
   * Adds the capabilities on first use so devices paired earlier get them too.
   */
  protected async updateUsageEnergy(isOn: boolean) {
    if (!this.usageSupported) return;
    for (const capability of ['measure_power', 'meter_power', 'meter_power.today']) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }

    let usage: DeviceUsage | undefined;
    try {
      usage = await this.deviceApi?.send({ method: 'get_device_usage' }) as DeviceUsage | undefined;
    } catch (error) {
      if (classifyError(error).kind === 'session') throw error;
      this.usageSupported = false;
      this.error('Energy usage not reported by this device, disabling:', error instanceof Error ? error.message : error);
      return;
    }
    if (!usage?.power_usage) return;

    this.usageMeter ??= new UsageMeter(this.getStoreValue('usageMeter') || undefined);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: this.homey.clock.getTimezone() });
    const { todayKwh, totalKwh, watts } = this.usageMeter.update(usage, day, isOn);

    await this.setCapabilityValue('meter_power.today', todayKwh);
    const previous = this.getCapabilityValue('meter_power');
    if (typeof previous !== 'number' || totalKwh >= previous) await this.setCapabilityValue('meter_power', totalKwh);
    if (watts !== undefined) await this.setCapabilityValue('measure_power', watts);

    // Persist the running total, but not on every 15 s poll.
    if (Date.now() - this.lastUsageSave > 60_000) {
      this.lastUsageSave = Date.now();
      await this.setStoreValue('usageMeter', this.usageMeter.state).catch(this.error);
    }
  }

  // ---- Homey discovery (strategy "tapomac") -------------------------------

  onDiscoveryResult(result: DiscoveryResult) {
    const mac = normalizeMac(result.mac ?? result.id);
    return !!mac && mac === this.expectedMac;
  }

  onDiscoveryAvailable(result: DiscoveryResult) {
    // Throwing here would mark the device unavailable, so never throw.
    this.followAddress(result.address);
  }

  onDiscoveryAddressChanged(result: DiscoveryResult) {
    this.followAddress(result.address);
  }

  onDiscoveryLastSeenChanged() {
    if (!this.getAvailable()) {
      this.resetConnection();
      this.poll().catch(this.error);
    }
  }

  private followAddress(address: string | undefined) {
    if (!address || address === this.ip) return;
    this.log(`Homey discovery reports a new address: ${this.ip} → ${address}`);
    this.saveIp(address)
      .then(() => {
        this.resetConnection();
        return this.poll();
      })
      .catch(this.error);
  }

  // ---- settings & repair ---------------------------------------------------

  async changeIpAddress(ip: string) {
    const trimmed = String(ip ?? '').trim();
    if (!isIpv4(trimmed)) throw new Error(`"${trimmed}" is not a valid IPv4 address.`);
    await this.setStoreValue('ip', trimmed);
    this.resetConnection();
    await this.withDevice((api) => api.getDeviceInfo());
    await this.setSettings({ ipaddress: trimmed }).catch(this.error);
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: { [key: string]: any }, changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('ipaddress')) {
      const ip = String(newSettings.ipaddress ?? '').trim();
      if (!isIpv4(ip)) throw new Error(`"${ip}" is not a valid IPv4 address.`);
      await this.setStoreValue('ip', ip);
      this.resetConnection();
      this.poll().catch(this.error);
    }
  }

}
