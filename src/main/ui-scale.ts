import { BrowserWindow } from 'electron';
import { zoomFactorFor } from '../shared/appearance';

/**
 * Applying the type size to a window.
 *
 * The maths lives in `shared/appearance` so the settings UI can label a size
 * without pulling Electron into the renderer bundle; this file is only the part
 * that must run in the main process, which owns the window and its zoom.
 */

export { FONT_SIZE_STEPS, fontSizeLabel, zoomFactorFor } from '../shared/appearance';

/**
 * Applies the type size to a window.
 *
 * Safe to call at any time and on a window that is still loading; a failure here
 * must never take the app down, so it is swallowed and the caller keeps going.
 * Returns the factor it used, which is what the tests assert against.
 */
export function applyUiScale(win: BrowserWindow | null, fontSize: unknown): number {
  const factor = zoomFactorFor(fontSize);
  try {
    if (win && !win.isDestroyed() && win.webContents) win.webContents.setZoomFactor(factor);
  } catch {
    // A window that is gone is not an error worth surfacing.
  }
  return factor;
}
