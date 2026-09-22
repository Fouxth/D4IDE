import { describe, expect, it } from 'vitest';
import { buildStrip, moveInOrder, MAX_TABS, StripTab } from '../src/renderer/lib/session-order';

const tab = (id: string, createdAt: number): StripTab => ({ id, title: id, createdAt });

describe('buildStrip', () => {
  it('orders by creation time, oldest first, and never hoists the active session', () => {
    const stored = [tab('c', 300), tab('a', 100), tab('b', 200)];
    const strip = buildStrip(stored, [], tab('b', 200));
    expect(strip.map((t) => t.id)).toEqual(['a', 'b', 'c']);

    // Selecting something else leaves every position alone.
    const afterSelectingA = buildStrip(stored, [], tab('a', 100));
    expect(afterSelectingA.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('appends a session that is not in the strip rather than putting it first', () => {
    const stored = [tab('a', 100), tab('b', 200)];
    const strip = buildStrip(stored, [], tab('fresh', 300));
    expect(strip.map((t) => t.id)).toEqual(['a', 'b', 'fresh']);

    const resumed = buildStrip(stored, [], tab('old', 1));
    expect(resumed.map((t) => t.id)).toEqual(['a', 'b', 'old']);
  });

  it('adds no placeholder when nothing is live', () => {
    const stored = [tab('a', 100), tab('b', 200)];
    // No conversation is open, so the strip is exactly what is stored — a
    // session that has not started does not get a tab of its own.
    expect(buildStrip(stored, [], null).map((t) => t.id)).toEqual(['a', 'b']);
    expect(buildStrip([], [], null)).toEqual([]);
  });

  it('honours a dragged order while keeping unnamed sessions in creation order', () => {
    const stored = [tab('a', 100), tab('b', 200), tab('c', 300)];
    const strip = buildStrip(stored, ['c', 'a'], tab('b', 200));
    expect(strip.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the newest sessions when there are more than the cap, without losing the live one', () => {
    const stored = Array.from({ length: 12 }, (_, i) => tab(`s${i}`, i + 1));
    const strip = buildStrip(stored, [], tab('s11', 12));
    expect(strip).toHaveLength(MAX_TABS);
    expect(strip.map((t) => t.id)).toEqual(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's11']);

    // A session that fell off the end is still shown, at the end.
    const withOld = buildStrip(stored, [], tab('s0', 1));
    expect(withOld.map((t) => t.id)).toEqual(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's0']);
  });

  it('ignores order ids that are no longer on the strip', () => {
    const stored = [tab('a', 100), tab('b', 200)];
    const strip = buildStrip(stored, ['gone', 'b'], tab('a', 100));
    expect(strip.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('moveInOrder', () => {
  it('moves the dragged session to the target position and keeps the rest in order', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does nothing when the drag goes nowhere or the target is unknown', () => {
    expect(moveInOrder(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], 'a', 'missing')).toEqual(['a', 'b']);
  });
});
