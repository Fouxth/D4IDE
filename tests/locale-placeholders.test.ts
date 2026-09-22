import { describe, expect, it } from 'vitest';
import en from '../src/renderer/locales/en.json';
import th from '../src/renderer/locales/th.json';

/**
 * i18next interpolates `{{name}}`, not `{name}` — and a string written the wrong
 * way does not throw or log: it prints the raw braces straight into the UI, where
 * a customer sees "D4IDE {version} is available". That happened in this
 * repository, which is why the convention is asserted rather than remembered: a
 * placeholder that renders as itself has no other failure mode to notice.
 */

type Dictionary = Record<string, unknown>;

function entries(dictionary: Dictionary, prefix = ''): [string, string][] {
  const found: [string, string][] = [];
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') found.push([path, value]);
    else if (value && typeof value === 'object') found.push(...entries(value as Dictionary, path));
  }
  return found;
}

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Every `{...}` left over once the correct `{{...}}` forms are removed. */
function strayBraces(value: string): string[] {
  return value.replace(new RegExp(PLACEHOLDER, 'g'), '').match(/\{[^}]*\}/g) ?? [];
}

function names(value: string): string[] {
  return [...value.matchAll(new RegExp(PLACEHOLDER, 'g'))].map((match) => match[1]).sort();
}

describe('locale placeholders', () => {
  it('uses the braces i18next actually interpolates', () => {
    const offenders = [...entries(th), ...entries(en)]
      .map(([path, value]) => ({ path, stray: strayBraces(value) }))
      .filter((entry) => entry.stray.length > 0);

    expect(
      offenders.map((entry) => `${entry.path}: ${entry.stray.join(' ')}`)
    ).toEqual([]);
  });

  it('interpolates the same names in both languages', () => {
    const english = new Map(entries(en));
    const mismatched = entries(th)
      .filter(([path, value]) => english.has(path) && names(value).join(',') !== names(english.get(path)!).join(','))
      .map(([path]) => path);

    expect(mismatched).toEqual([]);
  });

  it('has at least the labels the update screens depend on', () => {
    // A guard for the keys whose placeholders carry the version number: without
    // them the screen cannot say which build it found.
    for (const path of ['update.available', 'update.bannerTitle', 'update.badgeAvailable', 'update.hours']) {
      const thValue = path.split('.').reduce<any>((node, part) => node?.[part], th);
      const enValue = path.split('.').reduce<any>((node, part) => node?.[part], en);
      expect(typeof thValue, `${path} (th)`).toBe('string');
      expect(names(thValue as string).length, `${path} takes a placeholder`).toBeGreaterThan(0);
      expect(names(enValue as string)).toEqual(names(thValue as string));
    }
  });
});
