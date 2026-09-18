/**
 * Application version, in one place.
 *
 * It is sent as a `User-Agent` on every provider request: the OpenCode Go
 * subscription explicitly asks clients to identify themselves rather than
 * arriving as a generic HTTP library, and providers generally treat a named
 * client better than an anonymous one. `tests/version.test.ts` keeps it in step
 * with `package.json` so the two cannot drift.
 */
export const APP_VERSION = '1.0.0';

export const USER_AGENT = `D4IDE/${APP_VERSION}`;
