import { describe, expect, it } from 'vitest';
import { samePath } from '../src/renderer/lib/paths';

/**
 * One file is one buffer, however its path is spelled.
 *
 * The renderer has no `process`, so the earlier version of this helper threw on
 * every file open — the reason a click on a tree row or a tab looked dead. These
 * cases pin the comparison itself and the fact that it runs without Node globals.
 */
describe('samePath', () => {
  it('treats the two Windows spellings of one path as the same file', () => {
    expect(samePath('F:\\D4IDE\\src\\main\\index.ts', 'F:/D4IDE/src/main/index.ts')).toBe(true);
  });

  it('ignores a trailing separator', () => {
    expect(samePath('F:\\D4IDE\\src\\', 'F:\\D4IDE\\src')).toBe(true);
  });

  it('separates genuinely different files', () => {
    expect(samePath('F:\\D4IDE\\src\\a.ts', 'F:\\D4IDE\\src\\ab.ts')).toBe(false);
    expect(samePath('F:\\D4IDE\\src\\a.ts', 'F:\\D4IDE\\tests\\a.ts')).toBe(false);
  });

  it('never answers true for a missing path', () => {
    expect(samePath(null, 'F:\\D4IDE\\src\\a.ts')).toBe(false);
    expect(samePath('F:\\D4IDE\\src\\a.ts', undefined)).toBe(false);
    expect(samePath('', '')).toBe(false);
  });

  it('runs in a renderer without Node globals', () => {
    // The renderer has `navigator` but no `process`; reaching for it threw.
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    // @ts-expect-error deliberately removing the Node global for this case
    delete (globalThis as { process?: unknown }).process;
    try {
      expect(() => samePath('F:\\a\\b.ts', 'F:/a/b.ts')).not.toThrow();
      expect(samePath('F:\\a\\b.ts', 'F:/a/b.ts')).toBe(true);
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, 'process', processDescriptor);
    }
  });
});
