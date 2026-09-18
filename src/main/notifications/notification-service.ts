import { BrowserWindow, Notification } from 'electron';
import { logService } from '../logging/log-service';

/**
 * Desktop notifications (spec §53).
 *
 * Only five things are worth interrupting the user for: a finished build, a
 * finished test run, an approval request, a rate limit, and a budget threshold.
 * Everything else stays in the in-app toast stream. The renderer decides *when*
 * (it knows whether the window has focus); this side only decides whether the
 * platform can show it at all.
 */

export interface NotificationRequest {
  title: string;
  body?: string;
  /** Used for logging and for future per-kind preferences. */
  kind?: 'build' | 'tests' | 'approval' | 'rateLimit' | 'budget' | 'task';
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
      const notification = new Notification({
        title,
        body: String(request.body || '').slice(0, 400),
        silent: request.kind === 'rateLimit',
        urgency: request.kind === 'approval' ? 'critical' : 'normal'
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
