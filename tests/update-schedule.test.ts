import { describe, expect, it } from 'vitest';
import {
  BLOCKED_RETRY_MS,
  LAUNCH_CHECK_DELAY_MS,
  clampIntervalHours,
  decideNextCheck,
  UpdateScheduleInput
} from '../src/main/updater/update-schedule';

/**
 * The updater is allowed to *look* on its own and nothing more, so the decision
 * this module returns is the whole safety story: everything that is not clearly
 * due has to come back as "wait", and the cases where a check must not happen —
 * a running agent, a download already in flight, a build with no feed — have to
 * be indistinguishable from "not yet".
 */
const NOW = 1_800_000_000_000;

function input(overrides: Partial<UpdateScheduleInput> = {}): UpdateScheduleInput {
  return {
    enabled: true,
    checkOnLaunch: true,
    intervalHours: 6,
    lastCheckedAt: 0,
    state: 'idle',
    agentBusy: false,
    checkInProgress: false,
    ...overrides
  };
}

describe('update scheduling', () => {
  it('checks shortly after launch when the app has never checked', () => {
    const decision = decideNextCheck(input(), NOW);
    expect(decision).toEqual({ action: 'check', delayMs: LAUNCH_CHECK_DELAY_MS, reason: 'launch' });
  });

  it('waits one interval before the first check when launch checking is off', () => {
    const decision = decideNextCheck(input({ checkOnLaunch: false }), NOW);
    expect(decision.action).toBe('check');
    expect(decision).toMatchObject({ delayMs: 6 * 60 * 60 * 1000 });
  });

  it('checks as soon as the interval has elapsed, and not before', () => {
    const fiveHoursAgo = NOW - 5 * 60 * 60 * 1000;
    const due = decideNextCheck(input({ lastCheckedAt: NOW - 7 * 60 * 60 * 1000 }), NOW);
    expect(due).toEqual({ action: 'check', delayMs: 0, reason: 'due' });

    const early = decideNextCheck(input({ lastCheckedAt: fiveHoursAgo }), NOW);
    expect(early.action).toBe('wait');
    expect(early).toMatchObject({ delayMs: 60 * 60 * 1000, reason: 'not-due' });
  });

  it('schedules nothing at all when checking is switched off or there is no feed', () => {
    expect(decideNextCheck(input({ enabled: false }), NOW)).toEqual({
      action: 'wait',
      delayMs: null,
      reason: 'disabled'
    });
    expect(decideNextCheck(input({ state: 'unsupported' }), NOW)).toEqual({
      action: 'wait',
      delayMs: null,
      reason: 'unsupported'
    });
  });

  it('never interrupts a running agent, and retries shortly', () => {
    const decision = decideNextCheck(input({ agentBusy: true }), NOW);
    expect(decision).toEqual({ action: 'wait', delayMs: BLOCKED_RETRY_MS, reason: 'blocked' });
  });

  it('does not re-check while it is already checking', () => {
    const decision = decideNextCheck(input({ checkInProgress: true }), NOW);
    expect(decision).toEqual({ action: 'wait', delayMs: BLOCKED_RETRY_MS, reason: 'in-progress' });
  });

  it('stops looking once a build has been found, until the user acts on it', () => {
    for (const state of ['available', 'downloading', 'ready'] as const) {
      expect(decideNextCheck(input({ state }), NOW)).toEqual({
        action: 'wait',
        delayMs: null,
        reason: 'pending'
      });
    }
  });

  it('keeps an interval a person could have chosen', () => {
    expect(clampIntervalHours(0)).toBe(1);
    expect(clampIntervalHours(-4)).toBe(1);
    expect(clampIntervalHours(6)).toBe(6);
    expect(clampIntervalHours(24 * 30)).toBe(24 * 7);
    expect(clampIntervalHours(Number.NaN)).toBe(1);
  });
});
