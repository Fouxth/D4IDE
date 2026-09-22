import { NotificationSound } from '../../shared/types';

/**
 * The sound a notification makes.
 *
 * The tones are synthesised rather than loaded from files, for three reasons: a
 * custom sound is not something Windows toasts support (so the choice has to be
 * the app's job, on every platform), an asset would have to survive the build,
 * and a few hundred milliseconds of oscillator is smaller and more predictable
 * than any wav that ships well. `system` means "leave it to Windows", and `none`
 * means silence — including silence from the system, which is why the OS
 * notification is told so on the main side.
 */

/** True when Windows (or the OS) should play its own sound for this choice. */
export function usesSystemSound(sound: NotificationSound | string | null | undefined): boolean {
  return sound === 'system';
}

/** Silences the OS popup for every choice D4IDE makes its own noise for. */
export function osSilent(sound: NotificationSound | string | null | undefined): boolean {
  return sound !== 'system';
}

interface Tone {
  /** Start frequency, Hz. */
  from: number;
  /** End frequency, Hz (a glide; equal to `from` for a flat tone). */
  to: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
}

const TONES: Record<Exclude<NotificationSound, 'system' | 'none'>, Tone[]> = {
  // Two notes, the second an octave and a fifth above: a doorbell that is
  // pleasant enough to hear fifty times a day.
  chime: [
    { from: 880, to: 880, durationMs: 160, type: 'sine', gain: 0.05 },
    { from: 1318, to: 1318, durationMs: 420, type: 'sine', gain: 0.045 }
  ],
  // One short, bright note.
  ping: [{ from: 1180, to: 1180, durationMs: 220, type: 'sine', gain: 0.05 }],
  // A soft rising blip.
  pop: [{ from: 380, to: 900, durationMs: 150, type: 'triangle', gain: 0.06 }]
};

/** Only one tone at a time, however fast the events arrive. */
let context: AudioContext | null = null;
let lastPlayedAt = 0;
const MIN_GAP_MS = 600;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/**
 * Plays the chosen tone. Never throws and never blocks: a notification that
 * cannot make a sound must still be a notification.
 */
export function playNotificationSound(sound: NotificationSound | string | null | undefined): void {
  if (!sound || sound === 'none' || usesSystemSound(sound)) return;
  const tones = TONES[sound as keyof typeof TONES];
  if (!tones) return;

  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return;
  const ctx = audioContext();
  if (!ctx) return;
  lastPlayedAt = now;

  let at = ctx.currentTime;
  for (const tone of tones) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.from, at);
      if (tone.to !== tone.from) osc.frequency.linearRampToValueAtTime(tone.to, at + tone.durationMs / 1000);
      // A short attack and a long decay: without the ramp the note clicks.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(tone.gain, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.durationMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + tone.durationMs / 1000 + 0.02);
    } catch {
      // An oscillator that refuses to start is not worth failing a run over.
    }
    at += (tone.durationMs + 40) / 1000;
  }
}
