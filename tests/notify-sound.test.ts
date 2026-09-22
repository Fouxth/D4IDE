import { describe, expect, it } from 'vitest';
import { osSilent, usesSystemSound } from '../src/renderer/lib/notify-sound';

/**
 * Who makes the noise.
 *
 * A Windows toast can either play the system sound or be silent; a custom tone
 * has to be played by the app. Getting this mapping backwards gives either two
 * sounds for one event or none at all, and neither shows up as an error — so it
 * is pinned here rather than discovered by ear.
 */
describe('notification sound policy', () => {
  it('leaves the sound to the OS only for the system choice', () => {
    expect(usesSystemSound('system')).toBe(true);
    for (const choice of ['chime', 'ping', 'pop', 'none']) {
      expect(usesSystemSound(choice)).toBe(false);
    }
  });

  it('silences the OS popup for every choice the app plays itself', () => {
    for (const choice of ['chime', 'ping', 'pop', 'none']) {
      expect(osSilent(choice)).toBe(true);
    }
    expect(osSilent('system')).toBe(false);
  });

  it('treats a missing setting as "the app plays it", never as silence', () => {
    // The settings file of an older build has no sound field at all; the
    // default has to be audible rather than mute.
    expect(osSilent(undefined)).toBe(true);
    expect(usesSystemSound(null)).toBe(false);
  });
});
