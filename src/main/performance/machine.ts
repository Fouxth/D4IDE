import os from 'os';

/**
 * What kind of machine this is.
 *
 * The decisions that follow — how much SQLite page cache to hold, whether to
 * give up Chromium's separate GPU process, how much terminal scrollback the
 * renderer keeps — all hang off this one reading, and every one of them is
 * logged with the number that produced it. "The app behaves differently on your
 * machine" should always be explainable.
 *
 * Kept free of `electron` on purpose: the database layer is constructed while
 * modules are still being imported, before `app.whenReady()`, and a store that
 * cannot be built until Electron is ready cannot be tested either.
 */
export interface MachineProfile {
  totalRamGB: number;
  cores: number;
  /** True when the machine is small enough to justify trimming what the app keeps. */
  constrained: boolean;
}

/** At or below this much RAM, the app runs in its trimmed configuration. */
export const CONSTRAINED_RAM_GB = 8;

export function machineProfile(
  totalRamBytes: number = os.totalmem(),
  cores: number = os.cpus().length
): MachineProfile {
  const totalRamGB = Number.isFinite(totalRamBytes) && totalRamBytes > 0 ? +(totalRamBytes / 1024 ** 3).toFixed(1) : 0;
  return { totalRamGB, cores, constrained: totalRamGB > 0 && totalRamGB <= CONSTRAINED_RAM_GB };
}

/**
 * SQLite's page cache, in kilobytes, for this machine.
 *
 * The default (SQLite's -2000, i.e. 2 MB) is chosen for servers with many
 * gigabytes to spare. This database holds session history, usage rows and tool
 * audit entries — reads are small and indexed — so 1 MB on a small machine costs
 * nothing measurable in speed and returns memory the editor can use. A roomy
 * machine keeps the default rather than being handed a bigger number it has no
 * evidence for.
 */
export function sqliteCacheKb(profile: MachineProfile = machineProfile()): number {
  return profile.constrained ? 1024 : 2000;
}

/**
 * How long usage history is kept, in days.
 *
 * Budgets are daily and monthly, and the oldest figure any screen shows is the
 * start of the current month, so a year plus a little is already more than the
 * app can display. Past that, rows are only weight: every summary walks them.
 */
export const USAGE_RETENTION_DAYS = 400;
