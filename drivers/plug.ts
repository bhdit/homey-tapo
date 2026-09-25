import GenericDevice from './device';
import { baseModel } from '../lib/tapo/discovery';

// Plugs without an energy meter that share a driver with metered models.
const NO_ENERGY_METER = ['P100', 'P105'];
const ENERGY_CAPABILITIES = ['measure_power', 'meter_power', 'meter_power.today'];
// The monthly history only changes when a month closes; refresh it now and then as a safety net.
const HISTORY_REFRESH_MS = 6 * 60 * 60_000;
// How far back to look for monthly history before giving up.
const MAX_HISTORY_YEARS = 10;
// get_energy_data interval, in minutes, that returns one value per month for a given year.
const MONTHLY_INTERVAL = 43200;

/* eslint-disable camelcase */
type EnergyUsage = {
  current_power?: number, // mW
  today_energy?: number, // Wh
  today_energy_mwh?: number,
  month_energy?: number, // Wh
  month_energy_mwh?: number,
  local_time?: string, // "2026-09-26 00:07:48", the plug's own clock
};
/* eslint-enable camelcase */

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Prefer the milliwatt-hour field (finer), fall back to watt-hours. */
function kwh(mwh: number | undefined, wh: number | undefined): number | undefined {
  if (typeof mwh === 'number') return round(mwh / 1_000_000);
  if (typeof wh === 'number') return round(wh / 1000);
  return undefined;
}

export = class PlugDevice extends GenericDevice {

  private energySupported = true;
  // Wh per closed month, keyed "YYYY-MM", from the plug's own history.
  private monthlyWh = new Map<string, number>();
  private historyMonth = ''; // the plug's current month when the history was fetched
  private historyFetchedAt = 0;

  async register() {
    this.registerOnOff();
  }

  async updateStateFromDevice() {
    const info = await this.deviceApi?.getDeviceInfo();
    if (!info) return;
    await this.setCapabilityValue('onoff', info.device_on);
    await this.updateEnergy(info.model);
  }

  private async updateEnergy(model: string) {
    if (NO_ENERGY_METER.includes(baseModel(model))) {
      // The P110 driver also pairs P100s; don't show readings that can never fill in.
      for (const capability of ENERGY_CAPABILITIES) {
        if (this.hasCapability(capability)) await this.removeCapability(capability).catch(this.error);
      }
      return;
    }
    if (!this.energySupported) return;

    // Devices paired before these capabilities existed.
    for (const capability of ENERGY_CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }

    let usage: EnergyUsage | undefined;
    try {
      usage = await this.deviceApi?.getEnergyUsage() as EnergyUsage | undefined;
    } catch (error) {
      // A session error must reach the poll's reconnect logic; anything else means no meter.
      if (error instanceof Error && /403|Session/i.test(error.message)) throw error;
      this.energySupported = false;
      this.error('Energy readings unavailable for this device, disabling:', error instanceof Error ? error.message : error);
      return;
    }
    if (!usage) return;

    if (typeof usage.current_power === 'number') {
      await this.setCapabilityValue('measure_power', usage.current_power / 1000);
    }

    const todayKwh = kwh(usage.today_energy_mwh, usage.today_energy);
    if (todayKwh !== undefined) await this.setCapabilityValue('meter_power.today', todayKwh);

    const monthKwh = kwh(usage.month_energy_mwh, usage.month_energy);
    const currentMonth = usage.local_time?.slice(0, 7); // "YYYY-MM" on the plug's clock
    if (monthKwh === undefined || !currentMonth) return;

    // Refetch when the month rolls over *before* using the new (reset) month figure,
    // otherwise the total would dip until the closed month shows up in history.
    const stale = currentMonth !== this.historyMonth || Date.now() - this.historyFetchedAt > HISTORY_REFRESH_MS;
    if (stale) {
      try {
        await this.fetchMonthlyHistory(currentMonth);
      } catch (error) {
        if (error instanceof Error && /403|Session/i.test(error.message)) throw error;
        this.error('Could not read energy history:', error instanceof Error ? error.message : error);
        if (currentMonth !== this.historyMonth) return; // no valid base for this month yet
      }
    }

    let closedMonthsWh = 0;
    this.monthlyWh.forEach((wh, month) => {
      if (month < currentMonth) closedMonthsWh += wh;
    });
    const totalKwh = round(closedMonthsWh / 1000 + monthKwh);

    // meter_power is a cumulative meter for Homey Energy: never let it go backwards
    // (e.g. a history read that briefly returns less than before).
    const previous = this.getCapabilityValue('meter_power');
    if (typeof previous !== 'number' || totalKwh >= previous) {
      await this.setCapabilityValue('meter_power', totalKwh);
    }
    if (stale) this.log(`Energy: ${usage.current_power! / 1000} W, today ${todayKwh} kWh, total ${totalKwh} kWh`);
  }

  /** Reads per-month energy for each year back until the plug has no more history. */
  private async fetchMonthlyHistory(currentMonth: string) {
    const currentYear = Number(currentMonth.slice(0, 4));
    const history = new Map<string, number>();

    for (let year = currentYear; year > currentYear - MAX_HISTORY_YEARS; year--) {
      const start = Date.UTC(year, 0, 1) / 1000;
      const end = year === currentYear ? Math.floor(Date.now() / 1000) : Date.UTC(year, 11, 31, 23, 59, 59) / 1000;
      const result = await this.deviceApi?.send({
        method: 'get_energy_data',
        params: { start_timestamp: start, end_timestamp: end, interval: MONTHLY_INTERVAL },
      }) as { data?: number[] } | undefined;
      const months = Array.isArray(result?.data) ? result!.data : [];
      months.forEach((wh, index) => {
        if (typeof wh === 'number' && wh > 0) history.set(`${year}-${String(index + 1).padStart(2, '0')}`, wh);
      });
      // A past year with nothing recorded is where the plug's history ends.
      if (year < currentYear && months.every((wh) => !wh)) break;
    }

    this.monthlyWh = history;
    this.historyMonth = currentMonth;
    this.historyFetchedAt = Date.now();
    this.log(`Energy history loaded: ${history.size} month(s) with usage.`);
  }

}
