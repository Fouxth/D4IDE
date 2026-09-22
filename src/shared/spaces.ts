/**
 * The spaces on the rail — the folders the user works in.
 *
 * A space is furniture, not history: once a folder has been opened it stays on
 * the rail, at the same place, until the user takes it off by hand — switching
 * to a project is not a reason for it to jump to the top. That is the whole
 * reason this list exists next to `recentProjects`, which is a shortcut list
 * that reorders itself by recency, ages out on its own ("the last ten folders
 * you opened") and would quietly lose a workspace the user still thinks of as
 * theirs.
 *
 * The rules live here because two processes apply them: the main process writes
 * the list when a folder is opened (the one choke point every entry point goes
 * through), and the renderer reads and edits it. Both must agree on what "the
 * same folder" means, so it is stated once — and it is stated *without* the
 * renderer's `samePath`: that one asks `navigator` first, which in the main
 * process answers for Node and would call every path case-sensitive on Windows.
 */

/** Whether paths on this machine may differ only by case. */
function caseInsensitive(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32' || process.platform === 'darwin';
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return /win|mac/i.test(navigator.userAgent);
  }
  return false;
}

/** Separators are normalised on both platforms: `F:\app` and `F:/app` are one folder. */
function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function sameSpace(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = normalise(a);
  const right = normalise(b);
  return caseInsensitive() ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Adds a folder to the rail, newest first, and leaves the others alone.
 *
 * The order is the order the folders arrived in — the most recent addition on
 * top, the first one added at the bottom — and **opening a folder never moves
 * it**. A rail that reshuffles itself is a rail whose muscle memory has to be
 * rebuilt every time you switch projects: the row you learned to aim at slides
 * under the cursor and the next click lands somewhere else. Which folder you are
 * in is already said by the highlight, and by the window title.
 *
 * One folder is one place however many times it is opened, so a folder already
 * on the rail is not added twice. Blank entries are dropped so a cancelled
 * dialog cannot leave a nameless badge behind.
 */
export function rememberSpace(spaces: string[], path: string | null | undefined): string[] {
  const clean = (path ?? '').trim();
  if (!clean) return spaces;
  // Already there: keep both the entry and its position. The spelling already on
  // the rail also wins, so a caller handing back `F:/work/a` cannot rewrite the
  // `F:\work\a` the user has been looking at.
  if (spaces.some((space) => sameSpace(space, clean))) return spaces;
  return [clean, ...spaces];
}

/**
 * Takes a folder off the rail. Nothing on disk is touched — this forgets the
 * place, not the project, and the database keeps every session that ran there.
 */
export function forgetSpace(spaces: string[], path: string | null | undefined): string[] {
  if (!path) return spaces;
  return spaces.filter((space) => !sameSpace(space, path));
}
