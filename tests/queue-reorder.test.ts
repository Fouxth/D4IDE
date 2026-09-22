import { describe, expect, it } from 'vitest';
import { reorderTargets, stepTarget } from '../src/renderer/lib/queue-reorder';

/**
 * The queue on screen can be a filtered view — a task that is already running
 * does not appear in it — so these helpers exist to translate between the row a
 * user grabbed and the index the store expects. The tests below are mostly about
 * the cases where that translation must refuse to move anything.
 */
describe('queue reorder targets', () => {
  const ids = ['a', 'b', 'c'];

  it('maps a drag onto the two indices the store needs', () => {
    expect(reorderTargets(ids, 'a', 'c')).toEqual({ from: 0, to: 2 });
    expect(reorderTargets(ids, 'c', 'a')).toEqual({ from: 2, to: 0 });
  });

  it('refuses to move a row onto itself', () => {
    expect(reorderTargets(ids, 'b', 'b')).toBeNull();
  });

  it('refuses an id that is no longer in the queue', () => {
    // A drag that outlived its row: the message was deleted mid-drag.
    expect(reorderTargets(ids, 'gone', 'c')).toBeNull();
    expect(reorderTargets(ids, 'a', 'gone')).toBeNull();
  });

  it('uses queue positions, not on-screen positions', () => {
    // 'running' is the task in flight: absent from the visible list, still first
    // in the queue. Dragging the last visible row onto the middle one has to
    // land one place later than the visible numbering suggests.
    const queue = ['running', 'a', 'b', 'c'];
    expect(reorderTargets(queue, 'c', 'a')).toEqual({ from: 3, to: 1 });
  });
});

describe('queue keyboard step', () => {
  const ids = ['a', 'b', 'c'];

  it('names the neighbour in each direction', () => {
    expect(stepTarget(ids, 'b', -1)).toBe('a');
    expect(stepTarget(ids, 'b', 1)).toBe('c');
  });

  it('stops at both ends instead of wrapping', () => {
    expect(stepTarget(ids, 'a', -1)).toBeNull();
    expect(stepTarget(ids, 'c', 1)).toBeNull();
  });

  it('does nothing for an id that is gone', () => {
    expect(stepTarget(ids, 'gone', 1)).toBeNull();
  });
});
