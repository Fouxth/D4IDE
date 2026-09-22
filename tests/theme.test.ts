import { describe, expect, it } from 'vitest';
import { THEME_CLASSES, THEME_IDS, normalizeTheme, themeClasses, themeIsLight } from '../src/shared/theme';

/**
 * Theme selection.
 *
 * The classes are what the CSS hangs off, so the two things worth pinning are
 * that every theme resolves to a class the stylesheet actually defines, and that
 * a stored value the app no longer knows about lands on the default rather than
 * on a palette nobody wrote.
 */
describe('themes', () => {
  it('offers exactly the shipped themes', () => {
    expect([...THEME_IDS]).toEqual(['d4-dark', 'd4-light', 'freebuff']);
  });

  it('maps each theme to classes the stylesheet defines', () => {
    const declared = new Set<string>(THEME_CLASSES);
    for (const id of THEME_IDS) {
      const classes = themeClasses(id);
      expect(classes.length).toBeGreaterThan(0);
      for (const name of classes) expect(declared.has(name)).toBe(true);
    }
  });

  it('keeps the base dark tokens under every dark theme', () => {
    // Both dark palettes build on `dark`; dropping it would leave the panels
    // without any token at all.
    expect(themeClasses('d4-dark')).toContain('dark');
    expect(themeClasses('freebuff')).toEqual(['dark', 'd4-freebuff']);
  });

  it('gives the light theme the light class and nothing else', () => {
    expect(themeClasses('d4-light')).toEqual(['d4-light']);
    expect(themeIsLight('d4-light')).toBe(true);
    expect(themeIsLight('freebuff')).toBe(false);
    expect(themeIsLight('d4-dark')).toBe(false);
  });

  it('falls back to the default for a missing or unknown value', () => {
    for (const value of [undefined, null, '', 'freebuff-light', 'D4-DARK', 7]) {
      expect(normalizeTheme(value)).toBe('d4-dark');
      expect(themeClasses(value)).toEqual(['dark']);
    }
  });

  it('never returns two themes at once', () => {
    for (const id of THEME_IDS) {
      const classes = themeClasses(id);
      const palette = classes.filter((name) => name !== 'dark');
      expect(palette.length).toBeLessThanOrEqual(1);
    }
  });
});
