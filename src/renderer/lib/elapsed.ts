/**
 * Formats a duration the way a "Responding 0:24" pill shows it: mm:ss, and
 * h:mm:ss once an hour is involved. Clamped at zero so a clock jump backwards
 * can never produce a negative readout.
 */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
};
