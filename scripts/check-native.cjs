/**
 * Verifies that the optional native modules load and work inside the real
 * Electron runtime — not merely under Node, whose ABI differs from Electron's.
 *
 *   npm run native:check
 *
 * Exits non-zero if anything is broken, so it can gate a release build.
 *
 * Notes for whoever edits this:
 *  - node-pty applies a resize asynchronously on Windows. Resizing a pty that
 *    has already exited throws from inside node-pty's own socket handler, which
 *    surfaces as an *uncaught* exception — in a script without a handler for it
 *    Electron pops a blocking error dialog. Hence both the guard below and the
 *    long-lived shell: nothing here may exit before the resize has been applied.
 *  - `require('node-pty')` must be measured against the shell the app actually
 *    spawns, and resizing is exactly what the pipe fallback cannot do.
 *  - Keystrokes written in the first ~100 ms are swallowed by conpty while the
 *    shell is still starting, so the probe command is sent on a short delay
 *    after the prompt appears rather than on the first chunk.
 */
const results = {
  electron: process.versions.electron,
  node: process.versions.node,
  abi: process.versions.modules
};

let failures = 0;
let finished = false;
let completed = false;

/** Terminal output is wrapped in cursor moves and colour codes; strip them. */
function stripAnsi(text) {
  return text
    .replace(/\u001b\][^\u0007]*\u0007/g, '') // OSC sequences (window title…)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

// Never let an async native error become a blocking dialog.
process.on('uncaughtException', (error) => {
  results.uncaught = error.message;
  failures += 1;
  finish();
});

try {
  const Database = require('better-sqlite3');
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
  const pty = require('node-pty');
  const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || 'bash';

  terminal = pty.spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24 });
  results.nodePty = 'spawned';
  results.shell = shell;

  let output = '';
  let resized = false;
  let closing = false;

  // The shell is asked to exit rather than killed: node-pty's kill path on
  // Windows forks a helper that cannot run in a console-less Electron process,
  // and its failure would be mistaken for a failure of the terminal itself.
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
      // The prompt is up, so the pty is alive and safe to resize.
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
          terminal.write('echo PTYOKMARKER\r');
        } catch (error) {
          results.nodePtyWrite = `FAILED: ${error.message}`;
          failures += 1;
          finish();
        }
      }, 1200);
    }
    // Match the command's *output*, not the shell's echo of the command itself.
    if (!closing && /^PTYOKMARKER/m.test(stripAnsi(output))) {
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

setTimeout(() => {
  if (finished) return;
  results.note = results.nodePty === 'OK' ? 'watchdog' : 'the shell did not answer in time';
  if (results.nodePty !== 'OK') failures += 1;
  finish();
}, 20000);

function finish() {
  if (finished) return;
  finished = true;
  if (terminal && !completed) {
    try {
      terminal.kill();
    } catch {
      /* the process may already be gone */
    }
  }
  console.log(`NATIVE_CHECK ${JSON.stringify(results, null, 2)}`);
  console.log(
    failures === 0
      ? 'NATIVE_CHECK_RESULT all native modules work in Electron'
      : `NATIVE_CHECK_RESULT ${failures} failure(s)`
  );
  process.exit(failures === 0 ? 0 : 1);
}
