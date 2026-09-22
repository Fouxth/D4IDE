/**
 * The themes the app ships with.
 *
 * A theme is a class on the root element plus the token block that class selects:
 * `d4-dark` is the default near-black IDE, `d4-light` inverts the surfaces, and
 * `freebuff` is the second dark palette — the neutral greys and soft lime of the
 * editor this app was modelled on, so someone who prefers that look can have it
 * without losing the first one.
 *
 * Pure and shared on purpose: the renderer applies the classes, the settings UI
 * lists the choices, and a test can pin the mapping without a browser.
 */

export const THEME_IDS = ['d4-dark', 'd4-light', 'freebuff'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * Every class a theme may put on the root element.
 *
 * Written out so the applier can clear all of them before adding the current
 * one — a leftover class from the previous theme is a palette mixed from two
 * themes, which is exactly the bug this list exists to prevent.
 */
export const THEME_CLASSES = ['dark', 'd4-light', 'd4-freebuff'] as const;

/** An unknown or missing value is the default theme, never a broken one. */
export function normalizeTheme(theme: unknown): ThemeId {
  return (THEME_IDS as readonly unknown[]).includes(theme) ? (theme as ThemeId) : 'd4-dark';
}

/** The root classes for a theme, `dark` first because the base tokens hang off it. */
export function themeClasses(theme: unknown): string[] {
  const id = normalizeTheme(theme);
  if (id === 'd4-light') return ['d4-light'];
  if (id === 'freebuff') return ['dark', 'd4-freebuff'];
  return ['dark'];
}

/** True when a theme draws on a light canvas. */
export function themeIsLight(theme: unknown): boolean {
  return normalizeTheme(theme) === 'd4-light';
}
