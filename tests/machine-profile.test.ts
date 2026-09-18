import { describe, expect, it } from 'vitest';
import {
  CONSTRAINED_RAM_GB,
  USAGE_RETENTION_DAYS,
  machineProfile,
  sqliteCacheKb
} from '../src/main/performance/machine';

/**
 * The app behaves differently on a small machine, and that difference is a
 * decision someone has to be able to check. These tests pin the boundary, the
 * direction of the default, and the two figures that hang off it — because the
 * failure mode of getting this wrong is silent: a wrong answer here either takes
 * features away from a capable machine or leaves a small one thrashing.
 */
const GB = 1024 ** 3;

describe('machine profile', () => {
  it('treats a machine at or below the threshold as constrained', () => {
    expect(machineProfile(4 * GB, 2).constrained).toBe(true);
    expect(machineProfile(CONSTRAINED_RAM_GB * GB, 4).constrained).toBe(true);
  });

  it('leaves a machine above the threshold alone', () => {
    expect(machineProfile(16 * GB, 8).constrained).toBe(false);
    expect(machineProfile((CONSTRAINED_RAM_GB + 1) * GB, 4).constrained).toBe(false);
  });

  it('reads the machine, and rounds the figure it reports', () => {
    const profile = machineProfile(Math.round(15.6 * GB), 12);
    expect(profile.totalRamGB).toBe(15.6);
    expect(profile.cores).toBe(12);
  });

  it('never trims a machine it could not measure', () => {
    // An unreadable total is not evidence of a small machine: assuming one would
    // quietly take scrollback and the minimap from someone who never asked.
    expect(machineProfile(0, 4).constrained).toBe(false);
    expect(machineProfile(Number.NaN, 4).constrained).toBe(false);
  });

  it('holds a smaller SQLite page cache on a small machine', () => {
    const small = sqliteCacheKb(machineProfile(4 * GB, 2));
    const large = sqliteCacheKb(machineProfile(32 * GB, 16));
    expect(small).toBeLessThan(large);
    // A negative pragma value means kilobytes, and SQLite's own default is 2 MB.
    expect(large).toBe(2000);
  });

  it('keeps enough history that no screen can outrun it', () => {
    // The oldest figure any view shows is the start of the current month.
    expect(USAGE_RETENTION_DAYS).toBeGreaterThan(13 * 30);
  });
});
