import { describe, it, expect } from 'vitest';
import th from '../src/renderer/locales/th.json';
import en from '../src/renderer/locales/en.json';

type Dict = Record<string, any>;

function flatten(dict: Dict, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) keys.push(...flatten(value, path));
    else keys.push(path);
  }
  return keys.sort();
}

function valueAt(dict: Dict, path: string): unknown {
  return path.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), dict);
}

describe('translation files', () => {
  const thKeys = flatten(th as Dict);
  const enKeys = flatten(en as Dict);

  it('define exactly the same keys in Thai and English', () => {
    const missingInThai = enKeys.filter((key) => !thKeys.includes(key));
    const missingInEnglish = thKeys.filter((key) => !enKeys.includes(key));
    expect({ missingInThai, missingInEnglish }).toEqual({ missingInThai: [], missingInEnglish: [] });
  });

  it('has no empty or untranslated placeholder values', () => {
    const empty: string[] = [];
    for (const key of thKeys) {
      const thValue = valueAt(th as Dict, key);
      const enValue = valueAt(en as Dict, key);
      if (typeof thValue !== 'string' || typeof enValue !== 'string') continue;
      if (!thValue.trim() || !enValue.trim()) empty.push(key);
    }
    expect(empty).toEqual([]);
  });

  it('keeps interpolation placeholders consistent between languages', () => {
    const placeholders = (value: string) => (value.match(/\{\{\s*\w+\s*\}\}/g) || []).sort();
    const mismatched: string[] = [];

    for (const key of thKeys) {
      const thValue = valueAt(th as Dict, key);
      const enValue = valueAt(en as Dict, key);
      if (typeof thValue !== 'string' || typeof enValue !== 'string') continue;
      if (placeholders(thValue).join(',') !== placeholders(enValue).join(',')) mismatched.push(key);
    }

    expect(mismatched).toEqual([]);
  });

  it('covers the screens added for providers, usage and approvals', () => {
    for (const prefix of ['providers.', 'usage.', 'approval.', 'sessions.', 'palette.', 'rightSidebar.']) {
      expect(thKeys.some((key) => key.startsWith(prefix))).toBe(true);
      expect(enKeys.some((key) => key.startsWith(prefix))).toBe(true);
    }
  });
});
