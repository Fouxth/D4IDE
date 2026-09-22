import { describe, expect, it } from 'vitest';
import { projectInitials, projectName } from '../src/renderer/lib/session-badge';

/**
 * The badge on a tab and on a rail entry names the project behind it.
 *
 * It used to be the literal `D4` in the markup, so a strip of another project's
 * sessions all claimed to be the app's own. These pin the rule the user can
 * check by hand: the first two letters of the folder name.
 */
describe('projectName', () => {
  it('takes the last segment of a path, whichever separator is used', () => {
    expect(projectName('F:\\work\\HuayD')).toBe('HuayD');
    expect(projectName('F:/work/HuayD')).toBe('HuayD');
  });

  it('ignores a trailing separator and a bare name is its own name', () => {
    expect(projectName('F:\\work\\HuayD\\')).toBe('HuayD');
    expect(projectName('HuayD')).toBe('HuayD');
  });

  it('has no name for nothing at all', () => {
    expect(projectName(null)).toBe('');
    expect(projectName(undefined)).toBe('');
    expect(projectName('   ')).toBe('');
  });
});

describe('projectInitials', () => {
  it('reads the leading characters of the folder', () => {
    expect(projectInitials('F:\\D4IDE')).toBe('D4');
    expect(projectInitials('F:\\work\\HuayD')).toBe('HU');
    expect(projectInitials('C:/work/acme')).toBe('AC');
  });

  it('skips punctuation and spaces, so a slug still reads as letters', () => {
    expect(projectInitials('F:\\work\\my-real-estate')).toBe('MY');
    expect(projectInitials('F:\\work\\2 shops')).toBe('2S');
  });

  it('keeps a Thai project name readable', () => {
    expect(projectInitials('F:\\งาน\\ขายบ้าน')).toBe('ขา');
  });

  it('answers with nothing when there is no project to name', () => {
    // The callers draw a neutral glyph for this rather than the app's initials,
    // which is what made every session look like it belonged to D4IDE.
    expect(projectInitials(null)).toBe('');
    expect(projectInitials('')).toBe('');
    expect(projectInitials('   ')).toBe('');
    expect(projectInitials('F:\\work\\***')).toBe('');
  });
});
