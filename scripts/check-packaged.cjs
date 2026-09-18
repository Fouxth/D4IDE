/**
 * Loads the native modules straight out of a packaged build, exactly the way the
 * shipped app does: JavaScript from `app.asar`, native binaries redirected to
 * `app.asar.unpacked` by Electron.
 *
 *   pnpm build && pnpm native:check:packaged
 *
 * `native:check` proves the modules work in an Electron process; this proves
 * they survived packaging — asar layout, `asarUnpack` globs, dependency
 * collection. Run it after `pnpm dist`, or against any unpacked build by passing
 * the directory that contains `resources/app.asar` (default:
 * `release/win-unpacked`).
 *
 * The browser probe launches the machine's own Edge/Chrome through the packaged
 * copy of playwright-core: the browser tools are useless if the library loads
 * from asar but cannot start a browser in the installed app.
 */
const fs = require('fs');
const path = require('path');

const appDir = process.argv[2] || path.join(__dirname, '..', 'release', 'win-unpacked');
const resources = path.join(appDir, 'resources');
const asarModules = path.join(resources, 'app.asar', 'node_modules');

const results = {
  app: appDir,
  electron: process.versions.electron,
  abi: process.versions.modules
};
let failures = 0;
let finished = false;
let emitted = false;
let completed = false;
/** Async probes started alongside the terminal check; finish() waits for them. */
const probes = [];

process.on('uncaughtException', (error) => {
  results.uncaught = error.message;
  failures += 1;
  finish();
});

if (!fs.existsSync(path.join(resources, 'app.asar'))) {
  console.error(`PACKAGED_CHECK no packaged app at ${resources} — run "pnpm dist" first.`);
  process.exit(1);
}

try {
  const Database = require(path.join(asarModules, 'better-sqlite3'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE probe (value INTEGER)');
  db.prepare('INSERT INTO probe (value) VALUES (?)').run(42);
  const row = db.prepare('SELECT value FROM probe').get();
  db.close();
  results.betterSqlite3 = row && row.value === 42 ? 'OK' : `WRONG RESULT ${JSON.stringify(row)}`;
  if (results.betterSqlite3 !== 'OK') failures += 1;
} catch (error) {
  results.betterSqlite3 = `FAILED: ${error.message}`;
  failures += 1;
}

let terminal;
try {
  const pty = require(path.join(asarModules, 'node-pty'));
  const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || 'bash';
  terminal = pty.spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24 });
  results.nodePty = 'spawned';

  let output = '';
  let resized = false;
  let closing = false;

  terminal.onExit(({ exitCode }) => {
    if (!closing) {
      results.nodePty = 'shell exited before the probe command ran';
      failures += 1;
      finish();
      return;
    }
    results.nodePtyExit = exitCode === 0 ? 'OK' : `exit code ${exitCode}`;
    if (exitCode !== 0) failures += 1;
    completed = true;
    finish();
  });

  terminal.onData((chunk) => {
    output += chunk;
    if (!resized) {
      resized = true;
      try {
        terminal.resize(120, 30);
        results.nodePtyResize = 'OK';
      } catch (error) {
        results.nodePtyResize = `FAILED: ${error.message}`;
        failures += 1;
      }
      setTimeout(() => {
        try {
          terminal.write('echo PKGMARKER\r');
        } catch (error) {
          results.nodePtyWrite = `FAILED: ${error.message}`;
          failures += 1;
          finish();
        }
      }, 1200);
    }
    const plain = output
      .replace(/\u001b\][^\u0007]*\u0007/g, '')
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
    if (!closing && /^PKGMARKER/m.test(plain)) {
      closing = true;
      results.nodePty = 'OK';
      terminal.write('exit\r');
    }
  });
} catch (error) {
  results.nodePty = `FAILED: ${error.message}`;
  failures += 1;
  finish();
}

/**
 * Starts a real browser through the *packaged* playwright-core. This is the one
 * thing unit tests cannot cover: whether the library survives asar packing and
 * whether the agent's browser tools can actually run in the shipped app.
 */
async function checkBrowser() {
  let browser = null;
  try {
    const { chromium } = require(path.join(asarModules, 'playwright-core'));
    let lastError = null;
    for (const channel of ['msedge', 'chrome', undefined]) {
      try {
        browser = await chromium.launch({ channel, headless: true });
        results.browserChannel = channel || 'bundled-chromium';
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!browser) throw lastError || new Error('no browser could be launched');

    const page = await browser.newPage();
    await page.setContent('<h1 id="probe">packaged sandbox</h1>');
    const text = await page.locator('#probe').innerText();
    const title = await page.title();
    results.playwrightCore = text === 'packaged sandbox' ? 'OK' : `WRONG TEXT ${JSON.stringify(text)}`;
    results.playwrightTitle = title;
    if (results.playwrightCore !== 'OK') failures += 1;
  } catch (error) {
    results.playwrightCore = `FAILED: ${String(error.message).split('\n')[0]}`;
    failures += 1;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

probes.push(
  Promise.race([
    checkBrowser(),
    new Promise((resolve) =>
      setTimeout(() => {
        if (results.playwrightCore) return resolve();
        results.playwrightCore = 'FAILED: the browser did not answer within 25s';
        failures += 1;
        resolve();
      }, 25000)
    )
  ])
);

setTimeout(() => {
  if (finished) return;
  results.note = results.nodePty === 'OK' ? 'watchdog' : 'the shell did not answer in time';
  if (results.nodePty !== 'OK') failures += 1;
  finish();
}, 25000);

function finish() {
  if (finished) return;
  finished = true;
  // Every async probe reports before the verdict is printed.
  Promise.all(probes).then(emit, emit);
}

function emit() {
  if (emitted) return;
  emitted = true;
  if (terminal && !completed) {
    try {
      terminal.kill();
    } catch {
      /* the process may already be gone */
    }
  }
  console.log(`PACKAGED_CHECK ${JSON.stringify(results, null, 2)}`);
  console.log(
    failures === 0
      ? 'PACKAGED_CHECK_RESULT the packaged app ships working native modules and a working browser tool'
      : `PACKAGED_CHECK_RESULT ${failures} failure(s)`
  );
  process.exit(failures === 0 ? 0 : 1);
}
