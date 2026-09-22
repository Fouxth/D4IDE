import { UpdateStatus } from './types';

/**
 * What the update card should say, decided in one pure function.
 *
 * The card is the only place an update is offered, and it has four faces — asked,
 * downloading, downloaded, failed. Keeping the decision out of the component
 * means the rule "an update asks before it does anything" is testable: nothing
 * here can download or install, it only describes buttons for the user to press.
 *
 * (The inline banner this replaced had the same rule, but the two-step flow was
 * spread across renders, so "was the user ever asked?" had no single answer.)
 */
export type UpdatePromptAction =
  /** Start the download and stop there. */
  | 'update'
  /** Download, then install and restart the moment it is downloaded. */
  | 'updateAndRestart'
  /** Hide the card; the version stays pending and the status bar keeps it. */
  | 'later'
  /** The download is done — install and restart now. */
  | 'restart'
  /** The download failed; try it again. */
  | 'retry';

export interface UpdatePromptView {
  visible: boolean;
  kind: 'available' | 'downloading' | 'ready' | 'failed';
  version?: string;
  /** 0–100, clamped; only meaningful while downloading. */
  percent: number;
  actions: UpdatePromptAction[];
  /** Set when an install action is on screen but cannot run yet. */
  blocked: 'agent' | 'busy' | null;
}

export interface UpdatePromptInput {
  /** Version the user closed the card for — not the same as skipping. */
  dismissedVersion?: string;
  /** A user-triggered action is in flight. */
  busy?: boolean;
  /** An agent run is in flight; installing would kill it. */
  agentBusy?: boolean;
  /**
   * Whether the last action was the user's own download attempt. A background
   * check that fails on a train is not worth a card; a download *the user asked
   * for* that fails is.
   */
  attempted?: boolean;
}

const clampPercent = (value: number | undefined): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const HIDDEN: UpdatePromptView = { visible: false, kind: 'available', percent: 0, actions: [], blocked: null };

export function updatePromptView(status: UpdateStatus, input: UpdatePromptInput = {}): UpdatePromptView {
  const blocked: UpdatePromptView['blocked'] = input.agentBusy ? 'agent' : input.busy ? 'busy' : null;

  switch (status.state) {
    case 'available':
      if (!status.version) return HIDDEN;
      // Closing is "not now": the version stays available (status bar, Settings),
      // so hiding the card must not lose the offer.
      if (input.dismissedVersion === status.version) return HIDDEN;
      return {
        visible: true,
        kind: 'available',
        version: status.version,
        percent: 0,
        actions: ['update', 'updateAndRestart', 'later'],
        blocked
      };

    case 'downloading':
      // No actions: cancelling a half-downloaded installer is not something the
      // updater supports, and a button that does nothing is worse than none.
      return { visible: true, kind: 'downloading', percent: clampPercent(status.percent), actions: [], blocked };

    case 'ready':
      if (!status.version) return HIDDEN;
      if (input.dismissedVersion === status.version) return HIDDEN;
      return {
        visible: true,
        kind: 'ready',
        version: status.version,
        percent: 100,
        actions: ['restart', 'later'],
        blocked
      };

    case 'error':
      if (!input.attempted) return HIDDEN;
      return { visible: true, kind: 'failed', percent: 0, actions: ['retry', 'later'], blocked };

    default:
      return HIDDEN;
  }
}
