import { toast } from '../stores/toastStore';

/**
 * Compact notifications (spec §53).
 *
 * Deliberately conservative: a toast always, and an OS-level notification only
 * when the window is not focused — so a finished task still reaches the user who
 * switched to another app, without spraying the Action Center with popups while
 * they are watching the timeline.
 */

/** Timestamp of the last OS notification, for the rate limit below. */
let lastNativeAt = 0;
const MIN_NATIVE_INTERVAL_MS = 4000;

/** Kinds the spec lists; keeps copy consistent and translatable. */
export type NotifyKind = 'build' | 'tests' | 'approval' | 'rateLimit' | 'budget' | 'task';

export function notify(title: string, body?: string, kind: NotifyKind = 'task'): void {
  toast.info(title, body);

  if (typeof window === 'undefined' || !window.electronAPI?.notify) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;

  // Never let a burst of events turn into a burst of OS popups.
  const now = Date.now();
  if (now - lastNativeAt < MIN_NATIVE_INTERVAL_MS) return;
  lastNativeAt = now;

  void Promise.resolve(window.electronAPI.notify({ title, body: body || '', kind })).catch(() => undefined);
}
