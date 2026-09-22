import { describe, expect, it } from 'vitest';
import { updatePromptView } from '../src/shared/update-prompt';
import { UpdateStatus } from '../src/shared/types';

/**
 * The rule the whole updater is built on is "nothing happens without a click",
 * and the card is where the clicks are. So the tests here are about what the
 * user is *offered*, not about what the app does: every action that changes the
 * machine has to appear as a button first, and a card that is not offering
 * anything must not be on screen at all.
 */
const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ state: 'idle', ...patch });

describe('update card — what the user is offered', () => {
  it('offers an update, but never only the destructive version of it', () => {
    const view = updatePromptView(status({ state: 'available', version: '1.0.2' }));
    expect(view.visible).toBe(true);
    expect(view.kind).toBe('available');
    expect(view.actions).toEqual(['update', 'updateAndRestart', 'later']);
    // Restarting is always preceded by a choice that does not restart.
    expect(view.actions.indexOf('update')).toBeLessThan(view.actions.indexOf('updateAndRestart'));
  });

  it('shows the download as a percentage and offers nothing that could break it', () => {
    const view = updatePromptView(status({ state: 'downloading', percent: 42.6 }));
    expect(view.kind).toBe('downloading');
    expect(view.percent).toBe(43);
    expect(view.actions).toEqual([]);
  });

  it('asks before restarting once the download has landed', () => {
    const view = updatePromptView(status({ state: 'ready', version: '1.0.2' }));
    expect(view.kind).toBe('ready');
    expect(view.actions).toEqual(['restart', 'later']);
  });

  it('says why the restart is blocked while an agent run is in flight', () => {
    const view = updatePromptView(status({ state: 'ready', version: '1.0.2' }), { agentBusy: true });
    expect(view.blocked).toBe('agent');
    // The buttons stay on screen: the reason belongs next to them, not instead.
    expect(view.actions).toContain('restart');
  });

  it('goes away when the user closed it, without losing the version', () => {
    const view = updatePromptView(status({ state: 'available', version: '1.0.2' }), {
      dismissedVersion: '1.0.2'
    });
    expect(view.visible).toBe(false);
    // A different version is a new question.
    expect(updatePromptView(status({ state: 'available', version: '1.0.3' }), { dismissedVersion: '1.0.2' }).visible).toBe(true);
  });

  it('does not report a background check failure as a failed update', () => {
    // A check against an unreachable feed is not news the user can act on.
    expect(updatePromptView(status({ state: 'error', error: 'offline' })).visible).toBe(false);
    // The same failure after the user asked for a download is theirs to retry.
    const failed = updatePromptView(status({ state: 'error', error: 'offline' }), { attempted: true });
    expect(failed.kind).toBe('failed');
    expect(failed.actions).toEqual(['retry', 'later']);
  });

  it('stays off screen when there is nothing to offer', () => {
    for (const state of ['idle', 'checking', 'unsupported'] as const) {
      expect(updatePromptView(status({ state })).visible).toBe(false);
    }
    // An "available" with no version cannot be described, so it is not shown.
    expect(updatePromptView(status({ state: 'available' })).visible).toBe(false);
    expect(updatePromptView(status({ state: 'ready' })).visible).toBe(false);
  });

  it('never leaves a percentage unset or out of range', () => {
    expect(updatePromptView(status({ state: 'downloading' })).percent).toBe(0);
    expect(updatePromptView(status({ state: 'downloading', percent: -5 })).percent).toBe(0);
    expect(updatePromptView(status({ state: 'downloading', percent: 900 })).percent).toBe(100);
  });
});
