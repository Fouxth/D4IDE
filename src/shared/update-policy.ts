/**
 * Version comparison and "should we say something" rules for updates.
 *
 * These live in shared/ rather than in the updater because both processes need
 * them and they must agree: the main process decides when to look, the renderer
 * decides when to speak. Keeping them pure means the awkward cases — a build
 * number that is not three parts, a version the user asked to stop hearing
 * about, a feed that offers the version already installed — are decided by a
 * function a test can call, not by whatever the event order happened to be.
 */

/**
 * Numeric parts of a dotted version, tolerating a leading `v`.
 *
 * Pre-release and build metadata are dropped before splitting rather than
 * parsed: `1.1.0-beta.2`.split('.') ends in a `.2` that would read as a fourth
 * version part and make a pre-release look newer than the release it precedes.
 */
function segments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .replace(/[-+].*$/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

/**
 * Orders two dotted versions the way an updater has to: `1.10.0` is newer than
 * `1.9.9`, which string comparison gets wrong and a numeric compare of the whole
 * string cannot express at all.
 *
 * A pre-release suffix (`1.1.0-beta.2`) parses as its numeric prefix, so it is
 * *not* treated as newer than `1.1.0`. That matches how the feed labels a release
 * and avoids offering the same build twice under two names.
 */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export interface AnnouncementMemory {
  /** Version the user skipped. Silence until something newer arrives. */
  skippedVersion?: string;
  /** Version already announced, so the same build is not announced twice. */
  lastNotifiedVersion?: string;
}

/**
 * Whether a check result deserves the user's attention.
 *
 * Three ways to stay quiet, all of them deliberate: an older or equal version is
 * not news, a version the user skipped stays skipped *until a newer one appears*
 * (skipping 1.0.2 must not hide 1.0.3), and the same build is announced once.
 */
export function shouldAnnounceUpdate(
  available: string | undefined,
  current: string,
  memory: AnnouncementMemory
): boolean {
  if (!available) return false;
  if (!isNewerVersion(available, current)) return false;
  if (memory.skippedVersion && compareVersions(available, memory.skippedVersion) <= 0) return false;
  if (memory.lastNotifiedVersion === available) return false;
  return true;
}

/** Human-readable summary of a release note block, for a banner one line tall. */
export function releaseSummary(notes: string | undefined, maxLength = 160): string {
  if (!notes) return '';
  const line = notes
    .split('\n')
    .map((entry) => entry.replace(/^[-*#\s]+/, '').trim())
    .find((entry) => entry.length > 0);
  if (!line) return '';
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
