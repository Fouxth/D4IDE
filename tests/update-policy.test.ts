import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isNewerVersion,
  releaseSummary,
  shouldAnnounceUpdate
} from '../src/shared/update-policy';

/**
 * These rules decide whether the app is quiet or talks to the user, so the cases
 * that matter are the uncomfortable ones: a version two digits into its minor,
 * a build the user asked to stop hearing about, and a feed that offers the same
 * version twice.
 */
describe('version comparison', () => {
  it('compares each part numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.9.9', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('accepts a leading v and differing lengths', () => {
    expect(compareVersions('v1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
  });

  it('does not treat a pre-release of the current version as newer', () => {
    expect(isNewerVersion('1.1.0-beta.2', '1.1.0')).toBe(false);
    expect(isNewerVersion('1.1.1', '1.1.0')).toBe(true);
  });
});

describe('announcement policy', () => {
  const current = '1.0.0';

  it('speaks when there is a genuinely newer build', () => {
    expect(shouldAnnounceUpdate('1.0.1', current, {})).toBe(true);
  });

  it('stays quiet for the same or an older build', () => {
    expect(shouldAnnounceUpdate('1.0.0', current, {})).toBe(false);
    expect(shouldAnnounceUpdate('0.9.9', current, {})).toBe(false);
    expect(shouldAnnounceUpdate(undefined, current, {})).toBe(false);
  });

  it('says a version once', () => {
    expect(shouldAnnounceUpdate('1.0.1', current, { lastNotifiedVersion: '1.0.1' })).toBe(false);
  });

  it('respects a skipped version, but not for ever', () => {
    const skipped = { skippedVersion: '1.0.1' };
    expect(shouldAnnounceUpdate('1.0.1', current, skipped)).toBe(false);
    // Something newer than what was skipped is news again — otherwise skipping
    // one release would hide every release after it.
    expect(shouldAnnounceUpdate('1.0.2', current, skipped)).toBe(true);
    // An older offer that arrives late stays skipped.
    expect(shouldAnnounceUpdate('1.0.1', current, { skippedVersion: '1.0.2' })).toBe(false);
  });
});

describe('release summary', () => {
  it('takes the first line that carries text, dropping markdown noise', () => {
    expect(releaseSummary('\n## Fixes\n\n- Update checks are quiet now')).toBe('Fixes');
    expect(releaseSummary('Update checks are quiet now')).toBe('Update checks are quiet now');
  });

  it('returns nothing rather than an empty string with an ellipsis', () => {
    expect(releaseSummary(undefined)).toBe('');
    expect(releaseSummary('   \n\n  ')).toBe('');
  });

  it('truncates a long line instead of letting a banner grow', () => {
    const summary = releaseSummary('x'.repeat(400), 40);
    expect(summary).toHaveLength(40);
    expect(summary.endsWith('…')).toBe(true);
  });
});
