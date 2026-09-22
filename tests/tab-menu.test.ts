import { describe, expect, it } from 'vitest';
import { bindTabMenu, isPlaceholderTab, otherOpenCount, tabMenuEntries } from '../src/renderer/lib/tab-menu';

/**
 * The space menu hangs off two surfaces — the tab strip and the rail — and it
 * must answer the same way on both. These tests state the rules once: opening a
 * folder is always possible, a tab with no stored session behind it has nothing
 * to rename or close, and "close the others" is only useful when there are
 * others.
 */
describe('space menu — the same four entries everywhere', () => {
  it('offers the four actions in a stable order', () => {
    const entries = tabMenuEntries({ tabId: 's_1', otherOpenCount: 2 });
    expect(entries.map((entry) => entry.id)).toEqual(['new-space', 'rename', 'close', 'close-others']);
  });

  it('always lets the user open a new space, whatever was clicked', () => {
    for (const tabId of ['s_1', '__local__']) {
      const entries = tabMenuEntries({ tabId, otherOpenCount: 0 });
      expect(entries.find((entry) => entry.id === 'new-space')!.disabled).toBe(false);
    }
  });

  it('has nothing to rename or close on the tab with no stored session behind it', () => {
    const local = tabMenuEntries({ tabId: '__local__', otherOpenCount: 1 });
    expect(local.find((entry) => entry.id === 'rename')!.disabled).toBe(true);
    expect(local.find((entry) => entry.id === 'close')!.disabled).toBe(true);

    const real = tabMenuEntries({ tabId: 's_1', otherOpenCount: 1 });
    expect(real.find((entry) => entry.id === 'rename')!.disabled).toBe(false);
    expect(real.find((entry) => entry.id === 'close')!.disabled).toBe(false);
  });

  it('does not offer to close others when there are none', () => {
    expect(tabMenuEntries({ tabId: 's_1', otherOpenCount: 0 }).find((e) => e.id === 'close-others')!.disabled).toBe(true);
    expect(tabMenuEntries({ tabId: 's_1', otherOpenCount: 1 }).find((e) => e.id === 'close-others')!.disabled).toBe(false);
  });

  it('counts only real sessions as "the others"', () => {
    expect(otherOpenCount(['s_1', 's_2', '__local__'], 's_1')).toBe(1);
    expect(otherOpenCount(['s_1', '__local__'], 's_1')).toBe(0);
    expect(isPlaceholderTab('__local__')).toBe(true);
    expect(isPlaceholderTab('s_1789')).toBe(false);
  });

  it('binds each entry to a handler and a word in the user’s language', () => {
    const called: string[] = [];
    const items = bindTabMenu(
      tabMenuEntries({ tabId: 's_1', otherOpenCount: 0 }),
      {
        'new-space': () => called.push('new-space'),
        rename: () => called.push('rename'),
        close: () => called.push('close'),
        'close-others': () => called.push('close-others')
      },
      (key) => `t:${key}`,
      {}
    );

    expect(items[0].label).toBe('t:nav.spaceNewFolder');
    expect(items.map((item) => item.disabled)).toEqual([false, false, false, true]);

    items[0].onSelect();
    items[2].onSelect();
    expect(called).toEqual(['new-space', 'close']);
  });
});
