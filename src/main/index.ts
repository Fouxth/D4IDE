import { app, BrowserWindow, session, shell } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc/register-handlers';
import { terminalService } from './terminal/terminal-service';
import { mcpClient } from './mcp/mcp-client';
import { browserService } from './browser/browser-service';
import { logService } from './logging/log-service';
import { updateService } from './updater/update-service';
import { catalogRefreshService } from './ai/providers/catalog-refresh';
import { appStore } from './database/store';
import { providerManager } from './ai/providers/provider-manager';
import { applyPerformanceProfile } from './performance-profile';

let mainWindow: BrowserWindow | null = null;

/**
 * Decide how heavy this app is allowed to be, before Chromium has started.
 *
 * Several switches are read exactly once, while Chromium initialises, so they
 * have to be set here — at the top of the main process, before anything opens a
 * window. The console fallback matters because this runs before the log service
 * exists: whatever is decided must be visible somewhere.
 */
/**
 * Kept so the decision can be recorded properly once logging exists: a packaged
 * Windows build has no console for the `console.log` above to reach, and "why
 * does this machine behave differently" should be answerable from Settings →
 * Logs rather than only by reading the source.
 */
const performanceProfile = applyPerformanceProfile((message, context) =>
  console.log(`[D4IDE] ${message}`, context ?? '')
);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 650,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    // A packaged build takes its icon from the executable; a dev run needs the
    // file named explicitly or the taskbar shows the default Electron icon.
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer only talks through the typed preload bridge, so it can run
      // sandboxed (spec §65).
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Deny unexpected permission requests (camera, mic, geolocation…) — the IDE
  // never needs them (spec §65).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // External links open in the user's browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Renderer crashes are recoverable: reload the window and leave the agent's
  // transcript on disk so the session can be resumed (spec §84).
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logService.error('app', 'Renderer process gone', { reason: details.reason, exitCode: details.exitCode });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (details.reason !== 'clean-exit') mainWindow.reload();
  });

  registerIpcHandlers(mainWindow);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

process.on('uncaughtException', (error) => {
  logService.error('app', 'Uncaught exception in the main process', {
    error: error?.message,
    stack: error?.stack?.split('\n').slice(0, 6).join('\n')
  });
  console.error('[D4IDE] Uncaught exception in main process:', error);
});

process.on('unhandledRejection', (reason) => {
  logService.error('app', 'Unhandled rejection in the main process', { reason: String(reason) });
  console.error('[D4IDE] Unhandled rejection in main process:', reason);
});

app.whenReady().then(() => {
  // Logging first: everything after this point is recorded.
  try {
    logService.init(appStore.getDataDir(), appStore.getSettings().logLevel);
  } catch (error) {
    console.error('[D4IDE] Log service could not start:', error);
  }

  // Provider instances built during module import predate `app.whenReady()`, and
  // `safeStorage` cannot decrypt a stored API key before then — so rebuild them
  // now that keys are readable. `getProvider` self-heals either way; this just
  // avoids one wasteful rebuild on the first request of the session.
  providerManager.reloadProviders();

  logService.info('app', 'Performance profile', {
    totalRamGB: performanceProfile.totalRamGB,
    cores: performanceProfile.cores,
    constrained: performanceProfile.constrained
  });

  // Escape hatch, deliberately explicit: if a client id is wrong or the network
  // is unavailable, launching once with `--no-login` turns the gate off so the
  // app can still be opened and the settings fixed. It is a decision the user
  // makes at launch, not a hidden bypass.
  if (process.argv.includes('--no-login')) {
    appStore.saveSettings({ requireLogin: false });
    logService.warn('app', 'Sign-in gate disabled for this profile via --no-login');
  }

  // A damaged database is quarantined at startup rather than deleted. Say so
  // loudly once: the user's history is missing from the UI and silence would
  // look like data loss with no explanation.
  const database = appStore.getDatabaseInfo();
  if (database?.quarantinedFile) {
    logService.warn('app', 'Database was damaged and has been quarantined', {
      quarantined: database.quarantinedFile,
      active: database.file
    });
  }

  // Usage history is the one table that grows without a natural bound: a record
  // per request, for ever. Every summary walks all of it, so the log is trimmed
  // once at startup — past the retention window the rows are no longer part of
  // any figure the app can show. The cut-off is stated rather than silent: the
  // log records how many rows went.
  try {
    const pruned = appStore.pruneUsageHistory();
    if (pruned > 0) logService.info('app', 'Pruned aged usage records', { removed: pruned });
  } catch (error) {
    logService.warn('app', 'Usage history could not be pruned', { error: String(error) });
  }

  createWindow();
  updateService.setWindowProvider(() => mainWindow);
  // Detection only, and deliberately late: D4IDE looks for a newer build on its
  // own so it can say so, but downloading, installing and restarting are always
  // the user's click (see src/main/updater/update-service.ts).
  updateService.start();
  // Same rule for the model catalogue: ask the providers what they serve, stage
  // the difference, and wait (see src/main/ai/providers/catalog-refresh.ts).
  catalogRefreshService.setWindowProvider(() => mainWindow);
  catalogRefreshService.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Never leave orphaned shells, MCP servers or automation browsers behind.
app.on('before-quit', async () => {
  logService.info('app', 'Shutting down');
  updateService.stop();
  catalogRefreshService.stop();
  terminalService.killAll();
  await mcpClient.stopAll().catch(() => undefined);
  await browserService.close().catch(() => undefined);
  // Fold the write-ahead log back into the database file so a fresh install
  // never inherits a half-written WAL.
  appStore.checkpointDatabase();
});

app.on('window-all-closed', () => {
  terminalService.killAll();
  void browserService.close();
  if (process.platform !== 'darwin') app.quit();
});
