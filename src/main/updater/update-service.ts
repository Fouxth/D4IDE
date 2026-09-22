import { app, BrowserWindow } from 'electron';
import { logService } from '../logging/log-service';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import { UpdateStatus } from '../../shared/types';
import { appStore } from '../database/store';
import { decideNextCheck } from './update-schedule';

/**
 * Update system (spec §83).
 *
 * The rule the whole file is built around: D4IDE may *look* for a newer build on
 * its own, and that is all. It never downloads one, never installs one, never
 * restarts itself and never rewrites the user's configuration without a click.
 * That is why `autoDownload` and `autoInstallOnAppQuit` are forced off below and
 * why the timer only ever leads to `checkForUpdates()` — the two functions that
 * change the machine are reachable exclusively from IPC the user triggered.
 *
 * `electron-updater` is loaded lazily and its absence is not an error: a build
 * without a publish target (a plain `pnpm dist`, or a local dev run) reports
 * `unsupported` and parks the schedule instead of breaking the app.
 */

export type Updater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, listener: (...args: any[]) => void) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  /** Present on electron-updater 6; used by the self-hosted feed override. */
  setFeedURL?: (options: { provider: string; url: string }) => void;
};

/**
 * Where a packaged build looks for updates, unless the environment says
 * otherwise. electron-builder bakes a GitHub feed in from `build.publish`;
 * `D4IDE_UPDATE_FEED_URL` repoints the same machinery at any static host that
 * serves a `latest.yml` — which is how an on-prem feed works and how the full
 * check→download→ready flow is proven locally without touching GitHub.
 */
export function resolveFeedOverride(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.D4IDE_UPDATE_FEED_URL || '').trim();
  return raw.length > 0 ? raw : null;
}

/** Release notes can be long; the banner shows one line, Settings shows a block. */
const NOTES_LIMIT = 2000;

/**
 * Whether a feed's answer means "there is nothing to install" rather than "the
 * check failed".
 *
 * A repository that has not published a release answers every check with 404,
 * "No published versions on GitHub", or a missing `latest.yml`. That is the
 * normal state of a project between releases, not a fault, and reporting it as
 * an error put a red line on the Updates screen at every launch — the fastest
 * way to teach someone that update errors can be ignored. The distinction is
 * made here, once, so the screen and the schedule agree about it.
 */
export function isNothingPublished(message: string, code?: string): boolean {
  const text = `${message} ${code ?? ''}`;
  if (/NO_PUBLISHED_VERSIONS/i.test(text)) return true;
  if (/no published versions/i.test(text)) return true;
  // A missing feed file is the same answer from a different provider: the
  // release this build would be compared against simply is not there yet.
  if (/latest\.(yml|yaml)\b/i.test(text) && /(404|not found|cannot find|ENOENT|unable to find)/i.test(text)) return true;
  if (/\b404\b/.test(text) && /(http|github|feed|request|release|update)/i.test(text)) return true;
  return false;
}

export class UpdateService {
  private status: UpdateStatus = { state: 'idle' };
  private updater: Updater | null = null;
  private loaded = false;
  private busy = false;
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  /** Late-bound, because the window is created after the services. */
  private getWindow: () => BrowserWindow | null = () => null;

  setWindowProvider(provider: () => BrowserWindow | null): void {
    this.getWindow = provider;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * True while an agent run is in flight. A run outranks an update twice over:
   * the service will not check during one, and it refuses to install during one.
   */
  private guarded = false;

  setAgentBusy(busy: boolean): void {
    const wasBusy = this.guarded;
    this.guarded = busy;
    // The moment a run ends is exactly when a deferred check should happen.
    if (wasBusy && !busy) this.schedule('agent-idle');
  }

  isAgentBusy(): boolean {
    return this.guarded;
  }

  // ------------------------------------------------------------------ startup

  /**
   * Begin looking, on the schedule the user's settings describe. Called once the
   * window exists; the first check is deliberately late so it cannot compete
   * with the first paint or the first request an agent makes.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    const settings = appStore.getSettings();
    // Show the previous session's result rather than an empty state: "checked 2
    // hours ago" is the answer to "am I up to date?" before any new check runs.
    if (settings.lastUpdateCheckAt) this.publish({ state: this.status.state, checkedAt: settings.lastUpdateCheckAt });
    this.schedule('startup');
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Re-read the switches after the user changed them. */
  reconfigure(): void {
    if (!this.started) return;
    this.schedule('settings');
  }

  private schedule(reason: string): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.started) return;

    const settings = appStore.getSettings();
    const decision = decideNextCheck(
      {
        enabled: settings.updateCheckEnabled,
        checkOnLaunch: settings.checkUpdatesOnLaunch,
        intervalHours: settings.updateCheckIntervalHours,
        lastCheckedAt: settings.lastUpdateCheckAt || 0,
        state: this.status.state,
        agentBusy: this.guarded,
        checkInProgress: this.busy
      },
      Date.now()
    );

    if (decision.delayMs === null) {
      logService.info('app', 'Update checks parked', { reason: decision.reason, trigger: reason });
      return;
    }

    // Captured as primitives: the narrowing above does not survive into a
    // closure that outlives this call.
    const delayMs = decision.delayMs;
    const isCheck = decision.action === 'check';
    const why = decision.reason;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (isCheck) void this.check(why === 'launch' ? 'launch' : 'interval');
      // A wait with a delay is a re-evaluation, not a check.
      else this.schedule(why);
    }, delayMs);
    // A timer must never be the reason the process stays alive.
    this.timer.unref?.();
    logService.info('app', 'Next update check scheduled', {
      inMs: delayMs,
      reason: why,
      trigger: reason
    });
  }

  // ------------------------------------------------------------------- events

  private publish(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    // Remembering when we last looked is what makes the interval survive a
    // restart; it is the only thing here that is written to disk.
    if (patch.checkedAt) {
      const settings = appStore.getSettings();
      if (settings.lastUpdateCheckAt !== patch.checkedAt) {
        appStore.saveSettings({ lastUpdateCheckAt: patch.checkedAt });
      }
    }
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.UPDATE_STATUS, this.status);
    }
    if (patch.state) this.schedule('state');
  }

  /**
   * The only place `electron-updater` is constructed. Kept behind a seam so a
   * test can substitute a recorder and assert that nothing but a version check
   * ever happens without the user asking.
   */
  private injected: Updater | null = null;

  setUpdaterForTesting(updater: Updater | null): void {
    this.injected = updater;
    this.loaded = updater !== null;
    if (!updater) return;
    this.attach(updater);
    // Same field the lazy import fills, so a substituted updater is reachable
    // from every path that acts on one — an install that could not find it would
    // report "nothing to install" while the status said otherwise.
    this.updater = updater;
  }

  private attach(updater: Updater): void {
    // The user decides when to download and when to install.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;

    updater.on('checking-for-update', () => this.publish({ state: 'checking' }));
    updater.on('update-available', (info: any) =>
      this.publish({
        state: 'available',
        version: info?.version,
        notes: capNotes(info?.releaseNotes),
        releasedAt: typeof info?.releaseDate === 'string' ? info.releaseDate : undefined,
        checkedAt: Date.now()
      })
    );
    updater.on('update-not-available', () => this.publish({ state: 'idle', checkedAt: Date.now() }));
    updater.on('download-progress', (progress: any) =>
      this.publish({ state: 'downloading', percent: Math.round(progress?.percent ?? 0) })
    );
    updater.on('update-downloaded', (info: any) =>
      this.publish({ state: 'ready', version: info?.version, checkedAt: Date.now() })
    );
    updater.on('error', (error: Error) => {
      const code = (error as Error & { code?: string })?.code;
      if (isNothingPublished(error.message || '', code)) {
        logService.info('app', 'The update feed has no release to offer', {
          error: error.message,
          code
        });
        this.publish({ state: 'idle', checkedAt: Date.now() });
        return;
      }
      logService.warn('app', 'Update check failed', { error: error.message });
      this.publish({ state: 'error', error: error.message, checkedAt: Date.now() });
    });
  }

  private async load(): Promise<Updater | null> {
    if (this.injected) return this.injected;
    if (this.loaded) return this.updater;
    this.loaded = true;

    // Packaged builds only: in development there is no update feed and the
    // library would complain about a missing app-update.yml.
    if (!app.isPackaged && process.env.D4IDE_FORCE_UPDATER !== '1') {
      this.publish({ state: 'unsupported', error: 'Updates are only checked in an installed build.' });
      return null;
    }

    try {
      const module = await import('electron-updater');
      const updater = (module as any).autoUpdater as Updater;
      // An explicit feed wins over the baked-in one. Set before any check so
      // even the first `checking-for-update` event talks to the right host.
      const feedUrl = resolveFeedOverride(process.env);
      if (feedUrl && typeof updater.setFeedURL === 'function') {
        logService.info('app', 'Update feed overridden by environment', { url: feedUrl });
        updater.setFeedURL({ provider: 'generic', url: feedUrl });
      }
      this.attach(updater);
      this.updater = updater;
      return updater;
    } catch (error) {
      logService.info('app', 'electron-updater is not available in this build', {
        error: (error as Error).message
      });
      this.publish({ state: 'unsupported', error: 'This build has no update feed configured.' });
      return null;
    }
  }

  // ------------------------------------------------------------ the three verbs

  /**
   * Look for a newer build. Safe to call from the scheduler: it never downloads.
   *
   * A failed check keeps the interval rhythm rather than retrying immediately —
   * an unreachable feed is normally a network that will come back on its own, and
   * hammering it would burn the battery of a laptop for no new information.
   */
  async check(origin: 'launch' | 'interval' | 'manual' = 'manual'): Promise<UpdateStatus> {
    if (this.busy) return this.status;
    this.busy = true;
    try {
      const updater = await this.load();
      if (!updater) return this.status;
      logService.info('app', 'Checking for updates', { origin });
      this.publish({ state: 'checking' });
      await updater.checkForUpdates();
    } catch (error) {
      // electron-updater reports "the repository has no release" both as an
      // event and as a rejected promise from `checkForUpdates()`. The event is
      // already classified above; classifying the rejection too is what keeps a
      // repository between releases off the red. (Seen in the wild: a fresh
      // 1.1.0 build checking a feed that has not been published yet.)
      const message = (error as Error).message;
      const code = (error as Error & { code?: string })?.code;
      if (isNothingPublished(message, code)) {
        logService.info('app', 'The update feed has no release to offer', { error: message, code });
        this.publish({ state: 'idle', checkedAt: Date.now() });
      } else {
        this.publish({ state: 'error', error: message, checkedAt: Date.now() });
      }
    } finally {
      this.busy = false;
      if (this.status.state === 'checking') {
        // The feed answered nothing at all — no result, no error. Saying so keeps
        // the status honest and gives the schedule a check time, so it cannot
        // re-arm into a tight loop against a feed that never replies.
        this.publish({ state: 'error', error: 'The update feed did not answer.', checkedAt: Date.now() });
      }
      this.schedule('check-finished');
    }
    return this.status;
  }

  /** Step one of the manual flow: the user asked for this, nobody else. */
  async download(): Promise<UpdateStatus> {
    if (this.busy) return this.status;
    this.busy = true;
    try {
      const updater = await this.load();
      if (!updater) return this.status;
      this.publish({ state: 'downloading', percent: 0 });
      await updater.downloadUpdate();
    } catch (error) {
      this.publish({ state: 'error', error: (error as Error).message });
    } finally {
      this.busy = false;
      this.schedule('downloaded');
    }
    return this.status;
  }

  /** Step two: installing restarts the app, so a running agent wins the argument. */
  install(): UpdateStatus {
    if (this.guarded) {
      this.publish({ ...this.status, error: 'An agent task is running — finish or cancel it first.' });
      return this.status;
    }
    if (this.status.state !== 'ready' || !this.updater) {
      this.publish({ ...this.status, error: 'No downloaded update is ready to install.' });
      return this.status;
    }
    logService.info('app', 'Installing update and restarting', { version: this.status.version });
    // Silent, then relaunch. The user already made the decision by pressing the
    // button; with `oneClick: false` the alternative is an installer wizard
    // asking again for things the app was told. electron-builder's NSIS script
    // reuses the existing install directory when it is run with --updated.
    this.updater.quitAndInstall(true, true);
    return this.status;
  }

  /**
   * "Not this one." Recording the version is what makes the banner stay gone,
   * and dropping back to `idle` is what lets the next interval discover a version
   * that is *newer than the one skipped* — otherwise skipping 1.0.2 would hide
   * 1.0.3 for ever.
   */
  skipVersion(version: string): UpdateStatus {
    appStore.saveSettings({ skippedUpdateVersion: version });
    logService.info('app', 'Update skipped by the user', { version });
    this.publish({ state: 'idle', version: undefined, notes: undefined, percent: undefined });
    return this.status;
  }
}

function capNotes(notes: unknown): string | undefined {
  if (typeof notes !== 'string' || notes.trim().length === 0) return undefined;
  return notes.length > NOTES_LIMIT ? `${notes.slice(0, NOTES_LIMIT)}…` : notes;
}

export const updateService = new UpdateService();
