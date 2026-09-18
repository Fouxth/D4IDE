import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../src/renderer/lib/elapsed';
import { presenceFor, presenceDotClass } from '../src/renderer/lib/session-presence';
import { AgentStatus } from '../src/shared/types';

describe('formatElapsed', () => {
  it('shows mm:ss under an hour, like the Freebuff pill', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(5_000)).toBe('00:05');
    expect(formatElapsed(24_000)).toBe('00:24');
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });

  it('shows h:mm:ss once an hour is involved', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('clamps negative durations to zero (clock jumps must not lie)', () => {
    expect(formatElapsed(-4000)).toBe('00:00');
  });
});

describe('presenceFor', () => {
  const cases: Array<[AgentStatus, string | null]> = [
    ['running', 'working'],
    ['planning', 'working'],
    ['waiting_approval', 'waiting'],
    ['paused', 'waiting'],
    ['failed', 'failed'],
    ['completed', 'done'],
    ['idle', null],
    ['cancelled', null]
  ];
  for (const [status, expected] of cases) {
    it(`maps ${status} to ${expected ?? 'no dot'}`, () => {
      expect(presenceFor(status)).toBe(expected);
    });
  }

  it('gives every presence a dot class', () => {
    for (const p of ['working', 'waiting', 'failed', 'done'] as const) {
      expect(presenceDotClass[p]).toBeTruthy();
    }
  });
});
