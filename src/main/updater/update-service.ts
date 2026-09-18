import { app, BrowserWindow } from 'electron';
import { logService } from '../logging/log-service';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import { UpdateStatus } from '../../shared/types';

/**
 * Update system (spec §83).
 *
 * The rules from the spec that shape this file:
 *   - never update silently while an agent is modifying files;
 *   - the user chooses when to install (install on restart, not mid-task).
 *
 * `electron-updater` is loaded lazily and its absence is not an error: a build
 * without a publish target (a plain `pnpm dist`, or a local dev run) simply
 * reports `unsupported` instead of breaking the app.
 */

type Updater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, listener: (...args: any[]) => void) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
};

class UpdateService {
  private status: UpdateStatus = { state: 'idle' };
  private updater: Updater | null = null;
  private loaded = false;
  private busy = false;
  /** Late-bound, because the window is created after the services. */
  private getWindow: () => BrowserWindow | null = () => null;

  setWindowProvider(provider: () => BrowserWindow | null): void {
    this.getWindow = provider;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * True while an agent run is in flight. The renderer asks this before
   * installing, and the service refuses to install during a run either way.
   */
  private guarded = false;

  setAgentBusy(busy: boolean): void {
    this.guarded = busy;
  }

  isAgentBusy(): boolean {
    return this.guarded;
  }

  private publish(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.UPDATE_STATUS, this.status);
    }
  }

  private async load(): Promise<Updater | null> {
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
      // The user decides when to download and when to install.
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;

      updater.on('checking-for-update', () => this.publish({ state: 'checking' }));
      updater.on('update-available', (info: any) =>
        this.publish({ state: 'available', version: info?.version, notes: firstLine(info?.releaseNotes) })
      );
      updater.on('update-not-available', () => this.publish({ state: 'idle', checkedAt: Date.now() }));
      updater.on('download-progress', (progress: any) =>
        this.publish({ state: 'downloading', percent: Math.round(progress?.percent ?? 0) })
      );
      updater.on('update-downloaded', (info: any) =>
        this.publish({ state: 'ready', version: info?.version, checkedAt: Date.now() })
      );
      updater.on('error', (error: Error) => {
        logService.warn('app', 'Update check failed', { error: error.message });
        this.publish({ state: 'error', error: error.message, checkedAt: Date.now() });
      });

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

  async check(): Promise<UpdateStatus> {
    if (this.busy) return this.status;
    this.busy = true;
    try {
      const updater = await this.load();
      if (!updater) return this.status;
      this.publish({ state: 'checking' });
      await updater.checkForUpdates();
    } catch (error) {
      this.publish({ state: 'error', error: (error as Error).message, checkedAt: Date.now() });
    } finally {
      this.busy = false;
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    const updater = await this.load();
    if (!updater) return this.status;
    try {
      this.publish({ state: 'downloading', percent: 0 });
      await updater.downloadUpdate();
    } catch (error) {
      this.publish({ state: 'error', error: (error as Error).message });
    }
    return this.status;
  }

  /** Installing restarts the app, so a running agent always wins the argument. */
  install(): UpdateStatus {
    if (this.guarded) {
      this.publish({ ...this.status, error: 'An agent task is running — finish or cancel it first.' });
      return this.status;
    }
    if (this.status.state !== 'ready' || !this.updater) {
      this.publish({ ...this.status, error: 'No downloaded update is ready to install.' });
      return this.status;
    }
    logService.info('app', 'Installing update and restarting');
    this.updater.quitAndInstall();
    return this.status;
  }
}

function firstLine(notes: unknown): string | undefined {
  if (typeof notes !== 'string') return undefined;
  const line = notes.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0);
  return line?.slice(0, 300);
}

export const updateService = new UpdateService();
