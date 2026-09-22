import { describe, expect, it } from 'vitest';
import { BASE_FONT_SIZE, FONT_SIZE_STEPS, fontSizeLabel, zoomFactorFor } from '../src/shared/appearance';

/**
 * Type size.
 *
 * The setting is expressed in pixels and turns into a window zoom factor, so the
 * two things worth pinning are that the offered sizes land in a readable range
 * and that the default is genuinely larger than the old fixed layout — the
 * complaint that started this was "it is too small", and a factor of exactly 1
 * would have kept it that way.
 */
describe('zoom factor', () => {
  it('is larger than the old fixed layout at the default size', () => {
    expect(zoomFactorFor(FONT_SIZE_STEPS[1])).toBeGreaterThan(1);
  });

  it('grows monotonically across the steps the UI offers', () => {
    const factors = FONT_SIZE_STEPS.map((size) => zoomFactorFor(size));
    expect(factors).toEqual([...factors].sort((a, b) => a - b));
    expect(new Set(factors).size).toBe(FONT_SIZE_STEPS.length);
  });

  it('stays inside a range a dense IDE can still use', () => {
    for (const size of [...FONT_SIZE_STEPS, 8, 40]) {
      const factor = zoomFactorFor(size);
      expect(factor).toBeGreaterThanOrEqual(0.85);
      expect(factor).toBeLessThanOrEqual(1.5);
    }
  });

  it('falls back to 1:1 for a missing or nonsensical value', () => {
    for (const value of [undefined, null, '', 0, -4, 'abc', NaN]) {
      expect(zoomFactorFor(value)).toBe(1);
    }
  });

  it('treats the base size as no scaling', () => {
    expect(zoomFactorFor(BASE_FONT_SIZE)).toBe(1);
  });
});

describe('size labels', () => {
  it('names each offered size and nothing else', () => {
    expect(fontSizeLabel(FONT_SIZE_STEPS[0])).toBe('small');
    expect(fontSizeLabel(FONT_SIZE_STEPS[1])).toBe('medium');
    expect(fontSizeLabel(FONT_SIZE_STEPS[2])).toBe('large');
    expect(fontSizeLabel(FONT_SIZE_STEPS[3])).toBe('huge');
  });

  it('keeps an unknown value readable rather than blank', () => {
    expect(fontSizeLabel(undefined)).toBe('medium');
  });
});
