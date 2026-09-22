import { toast } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import { osSilent, playNotificationSound } from './notify-sound';

/**
 * Compact notifications (spec §53).
 *
 * Deliberately conservative. Four things are worth an OS popup — a finished
 * task, a question the agent is waiting on, a failure, and a session that
 * stopped — and each one also lands in the in-app toast stream so the record is
 * not lost. Everything else stays inside the app.
 *
 * The OS popup itself is only sent when the window is not in focus: showing a
 * Windows notification for something the user is already watching is noise, and
 * it is the fastest way to make someone turn notifications off for good.
 */

/** Timestamp of the last OS notification, for the rate limit below. */
let lastNativeAt = 0;
const MIN_NATIVE_INTERVAL_MS = 4000;

/**
 * Kinds the spec lists, plus the three that are worth a popup on their own: a
 * question waiting to be answered, a run that failed, and a session that
 * stopped. The label also decides urgency on the Windows side.
 */
export type NotifyKind =
  | 'build'
  | 'tests'
  | 'approval'
  | 'rateLimit'
  | 'task'
  | 'question'
  | 'error'
  | 'session';

export function notify(title: string, body?: string, kind: NotifyKind = 'task'): boolean {
  toast.info(title, body);

  if (typeof window === 'undefined' || !window.electronAPI?.notify) return false;
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;

  // Never let a burst of events turn into a burst of OS popups.
  const now = Date.now();
  if (now - lastNativeAt < MIN_NATIVE_INTERVAL_MS) return false;
  lastNativeAt = now;

  // The sound is the app's choice, made here rather than by the notification
  // service: `system` lets Windows use its own tone, any other choice plays a
  // synthesised one and tells Windows to stay quiet.
  const sound = useSettingsStore.getState().settings?.notificationSound ?? 'chime';
  playNotificationSound(sound);

  void Promise.resolve(
    window.electronAPI.notify({ title, body: body || '', kind, silent: osSilent(sound) })
  ).catch(() => undefined);
  return true;
}

/**
 * Plays the tone without showing anything.
 *
 * The appearance tab needs this: a sound is chosen by ear, and "ชิม" tells
 * nobody anything until they hear it.
 */
export function previewSound(): void {
  const sound = useSettingsStore.getState().settings?.notificationSound ?? 'chime';
  playNotificationSound(sound);
}
