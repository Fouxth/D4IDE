import { app } from 'electron';
import { machineProfile, MachineProfile } from './performance/machine';

/**
 * Chromium settings chosen from what the machine can afford, applied before
 * Chromium starts.
 *
 * Measured on this build, an idle window is four processes holding ~385 MB of
 * working set. Most of that is Chromium's own structure rather than the app's
 * code, and on a machine with RAM to spare it is a fair price for a modern
 * interface. On a machine without, it is the difference between usable and not,
 * so the profile below gives up things a text-based IDE never needed.
 */
const UNUSED_FEATURES = [
  'MediaRouter',
  'OptimizationHints',
  'InterestFeedContentSuggestions',
  'HardwareMediaKeyHandling',
  'BackgroundFetch',
  'PeriodicBackgroundSync',
  'Translate'
];

/**
 * Must run before `app.whenReady()`: several of these switches are read exactly
 * once, while Chromium initialises, so one set later does nothing at all.
 *
 * `D4IDE_LOW_MEMORY=1|0` overrides the decision. That is not a hidden setting —
 * it exists so the trimmed path can be started and *verified* on a machine that
 * would not otherwise take it, which is the only way to know the app still
 * renders and behaves there.
 */
export function applyPerformanceProfile(
  log: (message: string, context?: Record<string, unknown>) => void
): MachineProfile {
  const detected = machineProfile();
  const override = process.env.D4IDE_LOW_MEMORY;
  const constrained = override === '1' ? true : override === '0' ? false : detected.constrained;

  // Brings up code and threads a coding tool never touches.
  app.commandLine.appendSwitch('disable-features', UNUSED_FEATURES.join(','));

  if (constrained) {
    // Cap the renderer's V8 heap. The interface is text and flat colour; a
    // renderer that has grown past half a gigabyte is holding something it
    // leaked, not something it needs, and a hard ceiling turns that into a
    // garbage collection instead of a machine that swaps.
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
    // Bound the on-disk caches Chromium keeps for a browser's browsing, which
    // this is not.
    app.commandLine.appendSwitch('disk-cache-size', String(32 * 1024 * 1024));
    app.commandLine.appendSwitch('media-cache-size', String(8 * 1024 * 1024));
  }

  log('Performance profile chosen', {
    totalRamGB: detected.totalRamGB,
    cores: detected.cores,
    constrained,
    overridden: override !== undefined,
    trimmed: constrained ? ['max-old-space-size=512', 'disk-cache-size', ...UNUSED_FEATURES] : UNUSED_FEATURES
  });

  return { ...detected, constrained };
}
