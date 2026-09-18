import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, USER_AGENT } from '../src/shared/version';

/**
 * The version is written down twice, and the two copies have different jobs:
 * `package.json` decides the installer name, `app.getVersion()` and what the
 * updater compares against, while `src/shared/version.ts` is what every provider
 * request announces itself as. A release where only one of them moved either
 * refuses to update or misidentifies the client, and neither shows up locally —
 * so the agreement is asserted here instead.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

describe('application version', () => {
  it('matches the version the installer and updater use', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('is a plain semver triple, because the updater compares it as one', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('identifies the client on provider requests', () => {
    expect(USER_AGENT).toBe(`D4IDE/${APP_VERSION}`);
  });
});
