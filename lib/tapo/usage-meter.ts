/**
 * Energy for Tapo lights. They have no power meter: the only energy data is
 * `get_device_usage.power_usage`, the light's own estimate of energy used
 * today / past 7 / past 30 days (mWh). From that we derive:
 *   - today:  reported directly
 *   - power:  the rate at which "today" grows, over a window of a few minutes
 *   - total:  a counter we accumulate from "today" deltas and persist, seeded
 *             with the past-30-days figure so it doesn't start at zero.
 */

/* eslint-disable camelcase */
export type DeviceUsage = {
  power_usage?: { today_mwh?: number, past30_mwh?: number, today?: number, past30?: number },
};
/* eslint-enable camelcase */

export type MeterState = { totalMwh: number, lastTodayMwh: number, day: string };

type Sample = { at: number, mwh: number };

// "today" only moves in small steps, so shorter windows give jumpy readings.
const MIN_WINDOW_MS = 2 * 60_000;
const MAX_WINDOW_MS = 10 * 60_000;

const round = (value: number) => Math.round(value * 1000) / 1000;

export class UsageMeter {

  private samples: Sample[] = [];

  state: MeterState | undefined;

  constructor(state: MeterState | undefined) {
    this.state = state;
  }

  /**
   * @param day the date the reading belongs to (YYYY-MM-DD), to detect the midnight reset
   * @returns kWh values and the power estimate in W (undefined until enough history)
   */
  update(usage: DeviceUsage, day: string, isOn: boolean, now = Date.now()) {
    const todayMwh = usage.power_usage?.today_mwh ?? (usage.power_usage?.today ?? 0) * 1000;
    const past30Mwh = usage.power_usage?.past30_mwh ?? (usage.power_usage?.past30 ?? 0) * 1000;

    if (!this.state) {
      this.state = { totalMwh: past30Mwh, lastTodayMwh: todayMwh, day };
    } else if (day !== this.state.day || todayMwh < this.state.lastTodayMwh) {
      // New day: the light reset "today" to 0; everything it counted since is new.
      this.state = { totalMwh: this.state.totalMwh + todayMwh, lastTodayMwh: todayMwh, day };
      this.samples = [];
    } else {
      this.state = { ...this.state, totalMwh: this.state.totalMwh + (todayMwh - this.state.lastTodayMwh), lastTodayMwh: todayMwh };
    }

    this.samples.push({ at: now, mwh: todayMwh });
    this.samples = this.samples.filter((s) => now - s.at <= MAX_WINDOW_MS);

    let watts: number | undefined;
    if (!isOn) {
      watts = 0;
    } else {
      const oldest = this.samples[0];
      if (oldest && now - oldest.at >= MIN_WINDOW_MS) {
        const hours = (now - oldest.at) / 3_600_000;
        watts = Math.round(((todayMwh - oldest.mwh) / 1000 / hours) * 10) / 10;
      }
    }

    return {
      todayKwh: round(todayMwh / 1_000_000),
      totalKwh: round(this.state.totalMwh / 1_000_000),
      watts,
    };
  }

}
