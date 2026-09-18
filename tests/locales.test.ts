import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/renderer/locales/en.json';
import th from '../src/renderer/locales/th.json';

/**
 * A missing translation key does not crash anything — it just prints
 * `settings.logs` into the middle of the UI, which is exactly the kind of
 * mistake that survives a release. This walks the renderer, collects every
 * literal `t('key')` and asserts both locale files can answer it.
 */

const walk = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.tsx?$/.test(path)) files.push(path);
  }
  return files;
};

const lookup = (source: unknown, key: string): boolean =>
  key.split('.').every((part, index, parts) => {
    if (index === 0) return typeof source === 'object' && source !== null && part in source;
    let node: any = source;
    for (const step of parts.slice(0, index + 1)) {
      if (node == null || typeof node !== 'object' || !(step in node)) return false;
      node = node[step];
    }
    return true;
  });

const staticKeys = (): string[] => {
  const keys = new Set<string>();
  for (const file of walk(join(process.cwd(), 'src', 'renderer'))) {
    const source = readFileSync(file, 'utf8');
    // Only literal keys: a template literal or a variable cannot be checked.
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(match[1]);
  }
  return [...keys].sort();
};

describe('translations', () => {
  const keys = staticKeys();

  it('finds a plausible number of keys', () => {
    expect(keys.length).toBeGreaterThan(100);
  });

  it('has every static key in English', () => {
    const missing = keys.filter((key) => !lookup(en, key));
    expect(missing).toEqual([]);
  });

  it('has every static key in Thai', () => {
    const missing = keys.filter((key) => !lookup(th, key));
    expect(missing).toEqual([]);
  });

  it('keeps both locales in step', () => {
    const flat = (source: any, prefix = ''): string[] =>
      Object.entries(source).flatMap(([key, value]) =>
        value && typeof value === 'object' ? flat(value, `${prefix}${key}.`) : [`${prefix}${key}`]
      );
    const english = new Set(flat(en));
    const thai = new Set(flat(th));
    expect([...english].filter((key) => !thai.has(key))).toEqual([]);
    expect([...thai].filter((key) => !english.has(key))).toEqual([]);
  });
});

describe('debug bridge gate', () => {
  it('the source gates the bridge on VITE_DEBUG_BRIDGE only', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/renderer/debug-bridge.ts', 'utf8');
    expect(src).toContain('VITE_DEBUG_BRIDGE');
    expect(src).not.toContain('import.meta.env.DEV');
  });
});
