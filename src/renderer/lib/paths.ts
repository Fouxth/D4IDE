/**
 * Comparing two paths that name the same file.
 *
 * Windows paths reach the renderer in more than one spelling: the file tree and
 * the backend hand back `C:\proj\src\a.ts`, while the command palette, the
 * agent's own file references and pasted text usually carry forward slashes. A
 * literal `===` therefore treats one file as two — the editor opened a second
 * tab for a file that was already open, and a click that passed a forward-slash
 * path could not find the buffer it meant to focus.
 *
 * Only separators and (on Windows) case are normalised; the caller still keeps
 * the original string, so nothing that is displayed or written to disk changes.
 */

/**
 * Whether paths here should be compared case-insensitively.
 *
 * `process` does not exist in the renderer (Vite does not polyfill it, and
 * reaching for it threw on every file open), so the browser's own platform string
 * decides there and `process.platform` only covers the Node test run.
 */
function caseInsensitive(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return /win/i.test(navigator.userAgent);
  }
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32' || process.platform === 'darwin';
  }
  return false;
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normalise = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
  const left = normalise(a);
  const right = normalise(b);
  return caseInsensitive() ? left.toLowerCase() === right.toLowerCase() : left === right;
}
