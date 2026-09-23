/**
 * Application version, in one place.
 *
 * It is sent as a `User-Agent` on every provider request: the OpenCode Go
 * subscription explicitly asks clients to identify themselves rather than
 * arriving as a generic HTTP library, and providers generally treat a named
 * client better than an anonymous one. `tests/version.test.ts` keeps it in step
 * with `package.json` so the two cannot drift.
 */
export const APP_VERSION = '1.1.5';

export const USER_AGENT = `D4IDE/${APP_VERSION}`;

/**
 * Where the update feed lives, in the one place the UI reads it.
 *
 * It is the same repository the installer was published from, so "read what
 * changed" and "download it by hand" are the same page as the one the updater
 * asks for a version list.
 */
export const RELEASES_URL = 'https://github.com/Fouxth/D4IDE/releases';
