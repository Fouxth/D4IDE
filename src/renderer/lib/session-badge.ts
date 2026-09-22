/**
 * The leading characters a session's badge shows.
 *
 * Every tab and every entry on the rail used to be stamped `D4` — the app's own
 * initials, written into the markup — while the folder that was actually open
 * was called something else. A badge is only worth its pixels if it answers
 * *which project*: it now comes from the folder the session belongs to, so a
 * strip of conversations all carry the name they really belong to.
 *
 * The rule is the first couple of letters of the folder name — `D4IDE` → `D4`,
 * `HuayD` → `HU` — because that is short enough to read at 7px and still
 * reproducible by hand: the user can look at their own folder and see where the
 * badge came from.
 */
const MAX_BADGE = 2;
const SEPARATOR = /[/\\]/;
/** Anything that is not a letter or a number in any script (Thai included). */
const NOT_A_CHARACTER = /[^\p{L}\p{N}]/gu;

/**
 * The folder name of a project path — `F:\work\HuayD` and `HuayD` agree, and a
 * trailing separator is not a name of its own.
 */
export function projectName(pathOrName?: string | null): string {
  const raw = (pathOrName ?? '').trim().replace(/[/\\]+$/, '');
  if (!raw) return '';
  const parts = raw.split(SEPARATOR).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * The badge text, or `''` when there is no project to name — the callers draw a
 * neutral glyph for that case rather than reusing the app's own initials, which
 * is what claimed every session belonged to D4IDE.
 */
export function projectInitials(pathOrName?: string | null, max: number = MAX_BADGE): string {
  const name = projectName(pathOrName);
  if (!name) return '';
  // Punctuation and spaces are not letters: `my-app` badges `MY`, not `M-`.
  const characters = name.replace(NOT_A_CHARACTER, '');
  if (!characters) return '';
  return characters.slice(0, Math.max(1, max)).toUpperCase();
}
