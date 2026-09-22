import { describe, expect, it } from 'vitest';
import { forgetSpace, rememberSpace, sameSpace } from '../src/shared/spaces';

describe('rememberSpace', () => {
  it('puts the newest folder first', () => {
    expect(rememberSpace(['F:\\a'], 'F:\\b')).toEqual(['F:\\b', 'F:\\a']);
  });

  it('leaves the rail alone when a folder is opened again', () => {
    // Switching project must not move it: the row under the cursor would slide
    // away and the next click would land on a different folder.
    expect(rememberSpace(['F:\\a', 'F:\\b'], 'F:\\b')).toEqual(['F:\\a', 'F:\\b']);
    expect(rememberSpace(['F:\\a', 'F:\\b'], 'F:\\a')).toEqual(['F:\\a', 'F:\\b']);
  });

  it('keeps the order the folders were added in', () => {
    // Added first sits at the bottom, however often it is visited afterwards.
    let rail: string[] = [];
    rail = rememberSpace(rail, 'F:\\first');
    rail = rememberSpace(rail, 'F:\\second');
    rail = rememberSpace(rail, 'F:\\first');
    expect(rail).toEqual(['F:\\second', 'F:\\first']);
  });

  it('does not rewrite the spelling of a folder already on the rail', () => {
    expect(rememberSpace(['F:\\work\\a', 'F:\\b'], 'F:/work/a')).toEqual(['F:\\work\\a', 'F:\\b']);
  });

  it('treats the two slash styles as one folder', () => {
    expect(rememberSpace(['F:\\work\\a'], 'F:/work/a')).toEqual(['F:\\work\\a']);
  });

  it('ignores a folder with no name, so a cancelled dialog adds nothing', () => {
    expect(rememberSpace(['F:\\a'], '   ')).toEqual(['F:\\a']);
    expect(rememberSpace([], null)).toEqual([]);
  });

  it('adds rather than replaces when the list is empty', () => {
    expect(rememberSpace([], 'F:\\a')).toEqual(['F:\\a']);
  });
});

describe('forgetSpace', () => {
  it('removes only the folder named, whatever its spelling', () => {
    expect(forgetSpace(['F:\\a', 'F:\\b'], 'f:/a/')).toEqual(['F:\\b']);
  });

  it('is a no-op for a folder that is not on the rail', () => {
    expect(forgetSpace(['F:\\a'], 'F:\\zzz')).toEqual(['F:\\a']);
    expect(forgetSpace(['F:\\a'], '')).toEqual(['F:\\a']);
  });
});

describe('sameSpace', () => {
  it('compares paths without their trailing separator', () => {
    expect(sameSpace('F:\\work\\a\\', 'F:/work/a')).toBe(true);
  });

  it('does not confuse two different folders', () => {
    expect(sameSpace('F:\\app', 'F:\\app-old')).toBe(false);
    expect(sameSpace('F:\\app', null)).toBe(false);
  });
});
