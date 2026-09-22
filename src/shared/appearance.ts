/**
 * How big the interface is drawn.
 *
 * The UI is dense on purpose — an IDE shows a lot at once — but "dense" and "too
 * small to read" are the same thing on a 15" laptop, and every text size in the
 * renderer is a pixel value, so raising one CSS variable would not move a single
 * character. The one lever that scales everything, layout included, is the
 * window's zoom factor — applied by the main process, because the renderer cannot
 * reach it through the sandboxed bridge.
 *
 * The scale rides on the `fontSize` setting the settings file has always carried,
 * so no new preference and no migration: the number of pixels a line of text
 * should measure. `BASE_SIZE` is the size the interface was laid out at, and the
 * factor is a ratio against it — which means the medium default is a little
 * larger than the old fixed layout rather than identical to it.
 *
 * Pure and shared: the settings UI needs the steps and the label of the current
 * one, the main process needs the factor.
 */

/** Sizes the appearance tab offers, small → extra large. */
export const FONT_SIZE_STEPS = [12, 14, 16, 18];

/** The pixel size the interface is laid out at, 1:1. */
export const BASE_FONT_SIZE = 13;

/** Never so small that controls vanish, never so large that a panel is unusable. */
const MIN_FACTOR = 0.85;
const MAX_FACTOR = 1.5;

export function zoomFactorFor(fontSize: unknown): number {
  const size = Number(fontSize);
  if (!Number.isFinite(size) || size <= 0) return 1;
  const factor = size / BASE_FONT_SIZE;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.round(factor * 1000) / 1000));
}

/** The human word for a size, so the UI never shows a bare number. */
export function fontSizeLabel(fontSize: unknown): 'small' | 'medium' | 'large' | 'huge' {
  const size = Number(fontSize);
  if (!Number.isFinite(size)) return 'medium';
  if (size <= FONT_SIZE_STEPS[0]) return 'small';
  if (size >= FONT_SIZE_STEPS[3]) return 'huge';
  if (size <= FONT_SIZE_STEPS[1]) return 'medium';
  return 'large';
}
