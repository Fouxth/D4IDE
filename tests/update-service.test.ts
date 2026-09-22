import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The promise this file exists to keep: D4IDE looks for a newer build by itself
 * and does nothing else by itself. Not downloading and not installing are
 * therefore asserted the same way they would be noticed in the wild — by driving
 * the real scheduler through hours of clock time and counting what the updater
 * was asked to do.
 */
const state = vi.hoisted(() => ({ settings: {} as Record<string, any> }));

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  BrowserWindow: class {}
}));

vi.mock('../src/main/database/store', () => ({
  appStore: {
    getSettings: () => ({ ...state.settings }),
    saveSettings: (patch: Record<string, any>) => Object.assign(state.settings, patch)
  }
}));

vi.mock('../src/main/logging/log-service', () => ({
  logService: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

import { UpdateService, Updater } from '../src/main/updater/update-service';
import { LAUNCH_CHECK_DELAY_MS } from '../src/main/updater/update-schedule';

const HOUR = 60 * 60 * 1000;

type Recorder = Updater & { emit: (event: string, ...args: any[]) => void };

function makeUpdater(): Recorder {
  const listeners = new Map<string, (...args: any[]) => void>();
  const updater: Recorder = {
    // Deliberately the opposite of what the service demands, so a service that
    // forgot to force them off would be caught here.
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    checkForUpdates: vi.fn(async () => {
      updater.emit('update-not-available');
      return {};
    }),
    downloadUpdate: vi.fn(async () => {
      updater.emit('update-downloaded', { version: '1.0.1' });
      return {};
    }),
    quitAndInstall: vi.fn(),
    emit: (event, ...args) => listeners.get(event)?.(...args)
  };
  return updater;
}

function startWith(updater: Recorder): UpdateService {
  const service = new UpdateService();
  service.setUpdaterForTesting(updater);
  service.start();
  return service;
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/**
 * Timers fire at their due instant, and the schedule re-evaluates into a
 * zero-delay check on the next hop. Landing exactly on the boundary therefore
 * depends on sub-millisecond ordering, so the tests step just past it — which is
 * also what a real clock does.
 */
const advancePast = (ms: number) => vi.advanceTimersByTimeAsync(ms + 30_000);

beforeEach(() => {
  vi.useFakeTimers();
  state.settings = {
    updateCheckEnabled: true,
    checkUpdatesOnLaunch: true,
    updateCheckIntervalHours: 6,
    lastUpdateCheckAt: 0,
    lastNotifiedVersion: '',
    skippedUpdateVersion: ''
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('update detection', () => {
  it('turns off the library\'s own download and install behaviour', () => {
    const updater = makeUpdater();
    startWith(updater).stop();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('looks by itself, and only looks — for hours', async () => {
    const updater = makeUpdater();
    const service = startWith(updater);

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await advance(LAUNCH_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Three intervals' worth of clock: each one may look, none may act.
    await advancePast(6 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    await advancePast(12 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(4);

    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(service.getStatus().state).toBe('idle');
  });

  it('does not look at all when checking is switched off', async () => {
    state.settings.updateCheckEnabled = false;
    const updater = makeUpdater();
    startWith(updater);
    await advance(48 * HOUR);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('holds every check while an agent is running, then resumes', async () => {
    const updater = makeUpdater();
    const service = new UpdateService();
    service.setUpdaterForTesting(updater);
    service.setAgentBusy(true);
    service.start();

    await advance(30 * 60 * 1000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    service.setAgentBusy(false);
    await advance(LAUNCH_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('remembers when it last looked, so a restart keeps the interval', async () => {
    const updater = makeUpdater();
    const service = startWith(updater);
    await advance(LAUNCH_CHECK_DELAY_MS);

    expect(state.settings.lastUpdateCheckAt).toBeGreaterThan(0);
    const lookedAt = state.settings.lastUpdateCheckAt;

    // A new process: the same settings must not trigger an immediate re-check.
    const restarted = new UpdateService();
    restarted.setUpdaterForTesting(updater);
    restarted.start();
    expect(restarted.getStatus().checkedAt).toBe(lookedAt);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('says when it is not packaged instead of pretending there is a feed', async () => {
    const electron = await import('electron');
    (electron.app as any).isPackaged = false;
    const service = new UpdateService();
    const status = await service.check();
    expect(status.state).toBe('unsupported');
    (electron.app as any).isPackaged = true;
  });
});

describe('the manual flow', () => {
  async function withAvailableUpdate() {
    const updater = makeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit('update-available', {
        version: '1.0.1',
        releaseNotes: '## Fixes\n\n- quiet update checks',
        releaseDate: '2026-09-18T00:00:00.000Z'
      });
      return {};
    });
    const service = startWith(updater);
    await advance(LAUNCH_CHECK_DELAY_MS);
    return { updater, service };
  }

  it('stops looking once a build is found, instead of replacing it mid-download', async () => {
    const { updater, service } = await withAvailableUpdate();
    expect(service.getStatus()).toMatchObject({ state: 'available', version: '1.0.1' });

    await advancePast(48 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('downloads only when the user asks, then installs only when asked again', async () => {
    const { updater, service } = await withAvailableUpdate();

    await service.download();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(service.getStatus().state).toBe('ready');
    // Downloading is not installing, even when the download has finished.
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('refuses to install while an agent task is running', async () => {
    const { updater, service } = await withAvailableUpdate();
    await service.download();

    service.setAgentBusy(true);
    const status = service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(status.error).toContain('agent');
  });

  it('refuses to install something that was never downloaded', () => {
    const updater = makeUpdater();
    const service = startWith(updater);
    const status = service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(status.error).toContain('No downloaded update');
  });

  it('reports "no release yet" as up to date, not as a failure', () => {
    // A repository between releases answers every check with 404 or a missing
    // latest.yml. Calling that an error put a red line on the Updates screen at
    // every launch — which teaches the user to ignore update errors.
    const updater = makeUpdater();
    const service = startWith(updater);

    updater.emit('error', Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }));
    expect(service.getStatus().state).toBe('idle');
    expect(service.getStatus().checkedAt).toBeGreaterThan(0);

    updater.emit('error', new Error('HttpError: 404 Not Found for https://example.test/latest.yml'));
    expect(service.getStatus().state).toBe('idle');
  });

  it('still reports a real failure as a failure', () => {
    const updater = makeUpdater();
    const service = startWith(updater);

    updater.emit('error', new Error('getaddrinfo ENOTFOUND api.github.com'));
    expect(service.getStatus().state).toBe('error');
    expect(service.getStatus().error).toContain('ENOTFOUND');
  });

  it('treats a rejected check against an unpublished feed as up to date, not broken', async () => {
    // electron-updater does not only emit an error event for a repository with
    // no release — `checkForUpdates()` also rejects with the same message. Seen
    // in the wild on a fresh 1.1.0 build against a feed that has not been
    // published yet: the event was classified, the rejection was not, and the
    // Updates screen showed red for a perfectly healthy "nothing to install".
    const updater = makeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      throw Object.assign(new Error('No published versions on GitHub'), {
        code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'
      });
    });
    const service = startWith(updater);

    const status = await service.check('manual');
    expect(status.state).toBe('idle');
    expect(status.checkedAt).toBeGreaterThan(0);
  });

  it('treats a 404 latest.yml rejection the same way', async () => {
    const updater = makeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('HttpError: 404 Not Found for https://example.test/latest.yml');
    });
    const service = startWith(updater);

    const status = await service.check('manual');
    expect(status.state).toBe('idle');
  });

  it('skipping a version records it and starts looking again', async () => {
    const { updater, service } = await withAvailableUpdate();

    const status = service.skipVersion('1.0.1');
    expect(state.settings.skippedUpdateVersion).toBe('1.0.1');
    expect(status.state).toBe('idle');
    expect(status.version).toBeUndefined();

    // The point of returning to idle: a version newer than the skipped one has
    // to be discoverable.
    await advancePast(6 * HOUR);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
