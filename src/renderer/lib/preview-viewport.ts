/**
 * Width presets for the preview frame.
 *
 * Checking a responsive layout used to mean resizing the whole window, which is
 * the slowest possible way to answer "does this break at 390px?". These are the
 * four widths worth having, in the order a browser offers them.
 */
export const PREVIEW_VIEWPORTS = ['responsive', 'desktop', 'tablet', 'mobile'] as const;

export type PreviewViewport = (typeof PREVIEW_VIEWPORTS)[number];

/**
 * The real CSS width each fixed preset lays the app out at.
 *
 * This used to be a `max-w-*` class, which was a no-op in practice: the side
 * panel is ~380px wide, every preset caps *above* that, and `max-width` clamps
 * to whatever is narrower — so desktop, tablet and mobile all rendered at
 * exactly the panel's width and the chips looked broken. A preset has to mean
 * the width it names: the frame is laid out at that width and then scaled to
 * fit the panel, the way a device emulator does it.
 */
export const VIEWPORT_PRESET_WIDTHS: Record<Exclude<PreviewViewport, 'responsive'>, number> = {
  desktop: 1440,
  tablet: 834,
  mobile: 390
};

/** The preset's real width, or null when the frame just fills the panel. */
export function presetWidth(viewport: PreviewViewport): number | null {
  return viewport === 'responsive' ? null : VIEWPORT_PRESET_WIDTHS[viewport];
}

/**
 * The scale that fits a fixed preset's width into the available panel width,
 * capped at 1 — a narrow panel shrinks the frame, never stretches it.
 */
export function fitScale(presetWidthPx: number, availableWidthPx: number): number {
  if (!presetWidthPx || availableWidthPx <= 0) return 1;
  return Math.min(1, availableWidthPx / presetWidthPx);
}
