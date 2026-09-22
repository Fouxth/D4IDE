import { describe, expect, it } from 'vitest';
import { decideNextHealthCheck } from '../src/main/ai/providers/health-check-service';

/**
 * The health watch's schedule is the whole contract: it must cost nothing when
 * it has nothing to watch, it must never spend a request a live run needs, and
 * a provider that just failed must be re-asked sooner than a contented one —
 * "is it back yet?" should not cost a full interval of waiting.
 */
describe('decideNextHealthCheck', () => {
  it('parks when the watch is disabled', () => {
    const decision = decideNextHealthCheck({
      enabled: false,
      hasActiveProvider: true,
      agentBusy: false,
      lastResult: null,
      intervalMinutes: 10
    });
    expect(decision.delayMs).toBeNull();
    expect(decision.reason).toBe('disabled');
  });

  it('parks when nothing concrete is being talked to (auto routing or none)', () => {
    for (const hasActiveProvider of [false]) {
      const decision = decideNextHealthCheck({
        enabled: true,
        hasActiveProvider,
        agentBusy: false,
        lastResult: null,
        intervalMinutes: 10
      });
      expect(decision.delayMs).toBeNull();
      expect(decision.reason).toBe('no-active-provider');
    }
  });

  it('parks while an agent run is in flight — the probe would spend the run quota', () => {
    const decision = decideNextHealthCheck({
      enabled: true,
      hasActiveProvider: true,
      agentBusy: true,
      lastResult: null,
      intervalMinutes: 10
    });
    expect(decision.delayMs).toBeNull();
    expect(decision.reason).toBe('agent-busy');
  });

  it('schedules the full interval after a healthy probe', () => {
    const decision = decideNextHealthCheck({
      enabled: true,
      hasActiveProvider: true,
      agentBusy: false,
      lastResult: 'ok',
      intervalMinutes: 10
    });
    expect(decision.delayMs).toBe(10 * 60_000);
    expect(decision.reason).toBe('interval');
  });

  it('re-probes a failed provider after half the interval', () => {
    const decision = decideNextHealthCheck({
      enabled: true,
      hasActiveProvider: true,
      agentBusy: false,
      lastResult: 'fail',
      intervalMinutes: 10
    });
    expect(decision.delayMs).toBe(5 * 60_000);
    expect(decision.reason).toBe('retry-after-failure');
  });

  it('never schedules a zero-or-negative delay even after a long wait', () => {
    const now = 1_000_000;
    const decision = decideNextHealthCheck({
      enabled: true,
      hasActiveProvider: true,
      agentBusy: false,
      lastResult: 'ok',
      intervalMinutes: 10,
      now,
      lastCheckAt: now - 60 * 60_000
    });
    expect(decision.delayMs).toBe(0);
  });

  it('subtracts elapsed time so a reconfigure does not reset the wait', () => {
    const now = 5_000_000;
    const decision = decideNextHealthCheck({
      enabled: true,
      hasActiveProvider: true,
      agentBusy: false,
      lastResult: 'ok',
      intervalMinutes: 10,
      now,
      lastCheckAt: now - 4 * 60_000
    });
    expect(decision.delayMs).toBe(6 * 60_000);
  });
});
