/**
 * When the updater is allowed to look again.
 *
 * The whole point of this module is that looking is the *only* thing the app
 * does on its own. A decision of `check` here leads to one HTTP request for a
 * version list — never a download, never an install — and everything that
 * changes the machine stays behind a button the user pressed.
 *
 * Split out from the service so the timing rules can be tested without Electron:
 * a blocked check during an agent run, a check that is not due yet, and a build
 * with no feed all have to resolve to "wait", not to a timer that fires anyway.
 */
import { UpdateState } from '../../shared/types';

/** Long enough that the first paint and the first agent request win the race. */
export const LAUNCH_CHECK_DELAY_MS = 45_000;
/** How soon to look again after being blocked by an agent run or by ourselves. */
export const BLOCKED_RETRY_MS = 60_000;
export const MIN_INTERVAL_HOURS = 1;
export const MAX_INTERVAL_HOURS = 24 * 7;

export interface UpdateScheduleInput {
  /** The master switch for looking at all. */
  enabled: boolean;
  /** Look shortly after launch as well as on the interval. */
  checkOnLaunch: boolean;
  intervalHours: number;
  /** Epoch ms of the last completed check; 0 means never. */
  lastCheckedAt: number;
  state: UpdateState;
  /** An agent run is in flight — its work outranks an update check. */
  agentBusy: boolean;
  /** This service is already checking or downloading. */
  checkInProgress: boolean;
}

export type UpdateScheduleDecision =
  | { action: 'check'; delayMs: number; reason: 'launch' | 'due' }
  | {
      action: 'wait';
      /** null means "do not schedule anything"; the state has to change first. */
      delayMs: number | null;
      reason: 'disabled' | 'unsupported' | 'in-progress' | 'pending' | 'blocked' | 'not-due';
    };

export function clampIntervalHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return MIN_INTERVAL_HOURS;
  return Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Math.round(hours)));
}

/**
 * Rules, in the order that matters:
 *   1. switched off, or a build with no feed, means no timer at all;
 *   2. never interrupt ourselves or a running agent — retry shortly;
 *   3. an update already found is not searched for again, so a pending build
 *      cannot be replaced under the user's feet mid-download;
 *   4. otherwise the launch delay or the interval decides.
 */
export function decideNextCheck(input: UpdateScheduleInput, now: number): UpdateScheduleDecision {
  if (!input.enabled) return { action: 'wait', delayMs: null, reason: 'disabled' };
  if (input.state === 'unsupported') return { action: 'wait', delayMs: null, reason: 'unsupported' };
  if (input.checkInProgress) return { action: 'wait', delayMs: BLOCKED_RETRY_MS, reason: 'in-progress' };
  if (input.state === 'available' || input.state === 'downloading' || input.state === 'ready') {
    return { action: 'wait', delayMs: null, reason: 'pending' };
  }
  if (input.agentBusy) return { action: 'wait', delayMs: BLOCKED_RETRY_MS, reason: 'blocked' };

  const intervalMs = clampIntervalHours(input.intervalHours) * 60 * 60 * 1000;

  if (!input.lastCheckedAt) {
    return input.checkOnLaunch
      ? { action: 'check', delayMs: LAUNCH_CHECK_DELAY_MS, reason: 'launch' }
      : { action: 'check', delayMs: intervalMs, reason: 'due' };
  }

  const elapsed = now - input.lastCheckedAt;
  if (elapsed >= intervalMs) return { action: 'check', delayMs: 0, reason: 'due' };

  return { action: 'wait', delayMs: intervalMs - elapsed, reason: 'not-due' };
}
