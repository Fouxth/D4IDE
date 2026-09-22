import { BrowserWindow, Notification, app } from 'electron';
import { logService } from '../logging/log-service';

/**
 * Desktop notifications (spec §53).
 *
 * Only the things worth interrupting the user for reach the operating system: a
 * finished task, a question the agent is waiting on, a failure, and a session
 * that stopped. Everything else stays in the in-app toast stream. The renderer
 * decides *when* (it knows whether the window has focus); this side decides
 * whether the platform can show it at all, and what it looks and sounds like.
 *
 * Two details are what make a notification feel like it comes from D4IDE rather
 * than from Electron:
 *
 *   · The app user model id. Windows groups toasts by it and takes the name and
 *     icon from the shortcut registered under the same id — the one the
 *     installer writes. Without it the popup is labelled "electron.app.Electron".
 *   · The sound. Windows toasts can play the system sound or nothing at all;
 *     a custom tone is played by the app itself (see the renderer's
 *     `notify-sound`), so `silent` is set whenever D4IDE is making the noise.
 */

export type NotificationKind =
  | 'build'
  | 'tests'
  | 'approval'
  | 'rateLimit'
  | 'task'
  | 'question'
  | 'error'
  | 'session';

export interface NotificationRequest {
  title: string;
  body?: string;
  /** Used for logging, urgency, and the sound decision. */
  kind?: NotificationKind;
  /** The app plays its own tone for this one, so Windows must stay quiet. */
  silent?: boolean;
}

class NotificationService {
  private lastAt = 0;
  /** Hard floor between OS popups, independent of the renderer's own limit. */
  private static readonly MIN_INTERVAL_MS = 2500;

  isSupported(): boolean {
    try {
      return Notification.isSupported();
    } catch {
      return false;
    }
  }

  show(request: NotificationRequest, getWindow: () => BrowserWindow | null): boolean {
    const title = String(request.title || '').slice(0, 120);
    if (!title || !this.isSupported()) return false;

    const now = Date.now();
    if (now - this.lastAt < NotificationService.MIN_INTERVAL_MS) {
      logService.debug('app', 'Notification suppressed by rate limit', { kind: request.kind, title });
      return false;
    }
    this.lastAt = now;

    try {
      // Text-only on purpose: the user asked for a toast with nothing in it
      // but the name and the words. (The small icon beside "D4IDE" in the
      // toast header is Windows' own, drawn from the AppUserModelID shortcut
      // — no app can suppress that part; the body below is fully ours.)
      const notification = new Notification({
        title,
        body: String(request.body || '').slice(0, 400),
        // Rate limits are informational, and a custom tone is played by the
        // renderer — in both cases Windows must not add a sound of its own.
        silent: request.silent === true || request.kind === 'rateLimit',
        urgency: request.kind === 'approval' || request.kind === 'error' ? 'critical' : 'normal'
      });

      // Clicking the notification brings the app forward — the whole point of
      // telling someone who is looking at another window.
      notification.on('click', () => {
        const window = getWindow();
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });

      notification.show();
      logService.info('app', 'Notification shown', { kind: request.kind, title });
      return true;
    } catch (error) {
      logService.warn('app', 'Could not show the notification', { error: (error as Error).message });
      return false;
    }
  }
}

export const notificationService = new NotificationService();
