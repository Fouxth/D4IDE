import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { logService } from '../logging/log-service';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import { OutputCoalescer } from './output-coalescer';

interface PtyProcess {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (payload: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  pid: number;
}

interface TerminalInstance {
  id: string;
  cwd: string;
  shell: string;
  pty?: PtyProcess;
  child?: ChildProcessWithoutNullStreams;
  /**
   * Set as soon as the process exits. On Windows node-pty applies a queued
   * resize asynchronously, and resizing a pty that has already exited throws
   * from inside its own socket handler — outside any try/catch of ours. That
   * async throw reaches the main process as an uncaught exception, so the only
   * reliable guard is to stop touching the pty the moment it is gone.
   */
  exited?: boolean;
}

/**
 * node-pty is an optional native dependency: when it is present terminals get a
 * real PTY (interactive programs, resize, correct colours). When it is not —
 * or fails to load on a given machine — we fall back to plain pipes so the
 * terminal still works (spec §23).
 */
function loadNodePty(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node-pty');
  } catch {
    return null;
  }
}

export class TerminalService {
  private terminals = new Map<string, TerminalInstance>();
  private pty: any | null | undefined;
  /**
   * Called with every chunk of output from every terminal. The preview
   * registry listens here: the address a dev server actually bound to is
   * printed by the server, never guessed correctly by probing a fixed list.
   */
  private outputListeners = new Set<(text: string, terminalId: string) => void>();
  private backgroundCounter = 0;
  /**
   * The window background terminals report into. Registered once at startup so
   * the agent's tools can start a server without being handed a window, which
   * is not part of a tool's signature.
   */
  private mainWindow: BrowserWindow | null = null;

  /**
   * Terminals a panel is actually displaying. Output for anything else is not
   * sent to the renderer at all — see `publish`.
   */
  private watched = new Set<string>();

  /**
   * One message per terminal per frame instead of one per pty chunk. Measured
   * on the packaged app, a 40,000-line flood arrived as 39,803 messages and
   * burnt 8.3 CPU seconds moving 497 KB; batches make that a rounding error.
   */
  private readonly output = new OutputCoalescer({
    intervalMs: 16,
    maxBatchChars: 256 * 1024,
    flush: (id, data) => {
      const window = this.mainWindow;
      if (!window || window.isDestroyed()) return;
      window.webContents.send(IPC_CHANNELS.TERMINAL_DATA, { id, data });
    }
  });

  attachWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  /**
   * Records that a panel is displaying (or has stopped displaying) a terminal.
   * The renderer calls this when its terminal view mounts and unmounts, because
   * nothing else in the main process can know whether a byte of output has a
   * reader.
   */
  watchTerminal(id: string, watching: boolean): void {
    if (watching) {
      this.watched.add(id);
      return;
    }
    this.watched.delete(id);
    // Whatever was waiting for a panel that has now gone is dropped rather than
    // flushed into a page that stopped caring.
    this.output.forget(id);
  }

  /** Terminals currently being displayed somewhere. */
  watchedCount(): number {
    return this.watched.size;
  }

  /**
   * The single path every terminal byte takes out of this service.
   *
   * Two things happen here and nowhere else: the preview registry is fed (it
   * needs the text to find the address a dev server bound to), and the renderer
   * is fed — but only when a panel is watching that terminal. Routing an
   * unwatched terminal's output into the page was pure cost: a full structured
   * clone per chunk, and a renderer wake-up to hand the data to nobody.
   */
  private publish(terminalId: string, text: string): void {
    this.emitOutput(terminalId, text);
    if (!this.watched.has(terminalId)) return;
    this.output.push(terminalId, text);
  }

  onOutput(listener: (text: string, terminalId: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  private emitOutput(terminalId: string, text: string): void {
    for (const listener of this.outputListeners) {
      try {
        listener(text, terminalId);
      } catch (e) {
        console.warn('Terminal output listener failed:', e);
      }
    }
  }

  private getPty(): any | null {
    if (this.pty === undefined) this.pty = loadNodePty();
    return this.pty;
  }

  private defaultShell(shellType?: string): string {
    if (process.platform === 'win32') {
      if (shellType === 'bash') return process.env.GIT_BASH || 'bash.exe';
      if (shellType === 'cmd') return 'cmd.exe';
      return shellType || process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || 'bash';
  }

  /**
   * `env` is added to the shell's environment for this terminal only.
   *
   * It exists for one thing: a dev server that cannot be told its port on the
   * command line reads `PORT` instead, and the only moment that can be set is
   * before the process exists.
   */
  createTerminal(
    id: string,
    cwd: string,
    mainWindow: BrowserWindow,
    shellType?: string,
    env?: Record<string, string>
  ): void {
    if (this.terminals.has(id)) this.killTerminal(id);

    const shell = this.defaultShell(shellType);
    // Terminal lifetimes go to their own log stream: a shell that dies at the
    // wrong moment is a different investigation from an agent that misbehaved
    // (spec §66). Output itself is never logged verbatim — it can contain
    // anything the user typed.
    logService.info('terminal', 'Terminal started', { id, shell, cwd });
    const ptyModule = this.getPty();

    if (ptyModule?.spawn) {
      try {
        const proc: PtyProcess = ptyModule.spawn(shell, [], {
          name: 'xterm-256color',
          cwd: cwd || process.cwd(),
          env: { ...process.env, ...env, TERM: 'xterm-256color' },
          cols: 120,
          rows: 30
        });

        const instance: TerminalInstance = { id, cwd, shell, pty: proc };

        proc.onData((data: string) => this.publish(id, data));

        proc.onExit(({ exitCode }) => {
          instance.exited = true;
          logService.info('terminal', 'Terminal exited', { id, exitCode });
          this.publish(id, `\r\n[Process exited with code ${exitCode}]\r\n`);
          // The notice has to land after the output that preceded it, so the
          // batch is shipped now rather than on the next frame.
          this.output.flushNow();
          this.terminals.delete(id);
          this.watched.delete(id);
        });

        this.terminals.set(id, instance);
        return;
      } catch (e) {
        console.warn('node-pty failed to start, falling back to pipes:', e);
      }
    }

    const proc = spawn(shell, [], { cwd: cwd || process.cwd(), env: { ...process.env, ...env, TERM: 'xterm-256color' } });
    const fallbackInstance: TerminalInstance = { id, cwd, shell, child: proc };

    proc.stdout.on('data', (data: Buffer) => this.publish(id, data.toString('utf8')));
    proc.stderr.on('data', (data: Buffer) => this.publish(id, data.toString('utf8')));

    proc.on('close', (code) => {
      fallbackInstance.exited = true;
      logService.info('terminal', 'Terminal exited', { id, exitCode: code, mode: 'pipe' });
      this.publish(id, `\r\n[Process exited with code ${code}]\r\n`);
      this.output.flushNow();
      this.terminals.delete(id);
      this.watched.delete(id);
    });

    this.terminals.set(id, fallbackInstance);
  }

  /**
   * Runs a command that is meant to keep running — a dev server, a watcher —
   * inside a real terminal, and returns straight away.
   *
   * One-shot execution cannot host a dev server: `runCommandOnce` resolves on
   * `close`, and a server only closes when it is killed, so the agent used to
   * wait out the whole timeout and the server died with it. Nothing could ever
   * be previewed. The terminal stays open instead, the user can watch it in the
   * terminal panel, and its output feeds the preview registry.
   */
  startServer(
    command: string,
    cwd: string,
    mainWindow?: BrowserWindow,
    env?: Record<string, string>
  ): { id: string; pid: number } {
    const target = mainWindow ?? this.mainWindow;
    if (!target || target.isDestroyed()) throw new Error('No window available for a background terminal.');
    const id = `server_${Date.now()}_${++this.backgroundCounter}`;
    this.createTerminal(id, cwd, target, undefined, env);
    const instance = this.terminals.get(id);
    // A shell needs the newline to execute what is typed into it.
    this.write(id, `${command}\r`);
    const pid = instance?.pty?.pid ?? instance?.child?.pid ?? -1;
    logService.info('terminal', 'Background server started', { id, command: command.slice(0, 200), pid, cwd });
    return { id, pid };
  }

  /** Terminals that are running something long-lived, oldest id first. */
  serverIds(): string[] {
    return Array.from(this.terminals.keys()).filter((id) => id.startsWith('server_'));
  }

  /**
   * The folder a terminal was opened in, or null once it is gone.
   *
   * This is what attributes a printed address to a project: the server that
   * prints it was started in a folder, and that folder is the only evidence of
   * whose server it is.
   */
  cwdFor(id: string): string | null {
    return this.terminals.get(id)?.cwd ?? null;
  }

  /** True while the given terminal still has a live process behind it. */
  isRunning(id: string): boolean {
    const instance = this.terminals.get(id);
    return !!instance && !instance.exited;
  }

  write(id: string, data: string): void {
    const inst = this.terminals.get(id);
    if (!inst || inst.exited) return;
    try {
      if (inst.pty) inst.pty.write(data);
      else if (inst.child?.stdin.writable) inst.child.stdin.write(data);
    } catch (e) {
      console.warn('Failed to write to terminal:', e);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const inst = this.terminals.get(id);
    if (!inst || inst.exited || !inst.pty) return;
    try {
      inst.pty.resize(Math.max(cols, 2), Math.max(rows, 2));
    } catch {
      // Ignore resize races while the process is exiting.
    }
  }

  killTerminal(id: string): void {
    const inst = this.terminals.get(id);
    if (!inst) return;
    try {
      if (inst.pty && !inst.exited) {
        const pid = inst.pty.pid;
        inst.pty.kill();
        inst.exited = true;
        this.sweepProcessTree(pid);
      } else if (inst.child) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', inst.child.pid?.toString() || '', '/f', '/t']);
        } else {
          inst.child.kill('SIGTERM');
        }
      }
    } catch (e) {
      console.error('Failed to kill terminal process:', e);
    }
    this.terminals.delete(id);
    // Output still held for a terminal that is gone would otherwise be handed
    // to a panel that has already torn its view down.
    this.watched.delete(id);
    this.output.forget(id);
  }

  /**
   * node-pty tears down the console that owns the pty, but on Windows the helper
   * it uses to enumerate console processes cannot run inside a console-less
   * Electron process (it fails with "AttachConsole failed"). Sweeping the tree
   * ourselves stops stray grandchildren — a dev server started in a terminal,
   * for instance — from outliving the panel that spawned them.
   */
  private sweepProcessTree(pid?: number): void {
    if (process.platform !== 'win32' || !pid) return;
    try {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // The process may already be gone — taskkill would fail, which is fine.
    }
  }

  killAll(): void {
    for (const id of Array.from(this.terminals.keys())) this.killTerminal(id);
    this.output.dispose();
  }

  /** One-shot command execution used by the agent's run_terminal tool. */
  async runCommandOnce(
    command: string,
    cwd: string,
    timeoutMs = 120000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];

      const proc = spawn(shell, args, { cwd, env: process.env, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const MAX_OUTPUT = 200_000;

      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32' && proc.pid) {
            spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
          } else {
            proc.kill('SIGKILL');
          }
        } catch {
          // Process may already be gone.
        }
        resolve({ stdout, stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`, exitCode: -1 });
      }, timeoutMs);

      proc.stdout.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: -1 });
      });
    });
  }
}

export const terminalService = new TerminalService();
