/**
 * What this machine can afford.
 *
 * The app runs on anything from a workstation to a four-year-old office laptop,
 * and two editor costs are worth paying only on the second kind: terminal
 * scrollback (every line is a row of cells in the renderer heap) and the Monaco
 * minimap (a second rendering of the whole file, redrawn as you type and scroll).
 *
 * `navigator.deviceMemory` is Chromium's own estimate of the machine's RAM in
 * GB, capped at 8 — it is the only figure a sandboxed renderer can read, and it
 * is deliberately coarse. When it is missing the app assumes the machine is
 * capable and keeps full behaviour, because guessing "low" would quietly take
 * features away from someone who never asked for that.
 */
export function deviceMemoryGB(): number | undefined {
  const value = typeof navigator === 'undefined' ? undefined : (navigator as any).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** True when the renderer reports little enough RAM to justify trimming history. */
export function isLowMemory(): boolean {
  const memory = deviceMemoryGB();
  return memory !== undefined && memory <= 4;
}

/**
 * How much terminal history to keep. Bounds history only: a terminal on a small
 * machine scrolls back less far, it does not behave differently.
 */
export function scrollbackFor(deviceMemory?: number): number {
  const memory = deviceMemory ?? deviceMemoryGB();
  if (typeof memory !== 'number' || !Number.isFinite(memory)) return 5000;
  if (memory <= 2) return 500;
  if (memory <= 4) return 1500;
  if (memory <= 8) return 3000;
  return 5000;
}

/**
 * Whether to draw Monaco's minimap. It is a full second render of the file at
 * every scroll and edit, so it is the first thing to go on a small machine —
 * the user loses an overview strip, not the ability to edit.
 */
export function minimapEnabled(): boolean {
  return !isLowMemory();
}
