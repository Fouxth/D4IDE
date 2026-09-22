import { describe, expect, it } from 'vitest';
import { PREVIEW_VIEWPORTS, fitScale, presetWidth } from '../src/renderer/lib/preview-viewport';

describe('preview viewports', () => {
  it('offers the four widths worth having, widest choice first', () => {
    expect(PREVIEW_VIEWPORTS).toEqual(['responsive', 'desktop', 'tablet', 'mobile']);
  });

  it('lays each fixed preset out at the width its name promises', () => {
    expect(presetWidth('responsive')).toBeNull();
    expect(presetWidth('desktop')).toBe(1440);
    expect(presetWidth('tablet')).toBe(834);
    expect(presetWidth('mobile')).toBe(390);
  });

  it('scales a fixed preset down into a narrower panel, and never upscales', () => {
    expect(fitScale(834, 380)).toBeCloseTo(380 / 834);
    expect(fitScale(390, 800)).toBe(1);
  });

  it('falls back to a plain fill when either measurement is missing', () => {
    expect(fitScale(0, 380)).toBe(1);
    expect(fitScale(834, 0)).toBe(1);
    expect(fitScale(834, -1)).toBe(1);
  });
});
