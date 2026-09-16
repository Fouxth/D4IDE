import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-events';

interface TerminalInstance {
  id: string;
  process: ChildProcessWithoutNullStreams;
  cwd: string;
}

export class TerminalService {
  private terminals = new Map<string, TerminalInstance>();

  createTerminal(id: string, cwd: string, mainWindow: BrowserWindow, shellType = 'powershell.exe'): void {
    if (this.terminals.has(id)) {
      this.killTerminal(id);
    }

    const shell = process.platform === 'win32' ? (shellType || 'powershell.exe') : 'bash';
    const proc = spawn(shell, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    proc.stdout.on('data', (data: Buffer) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_DATA, { id, data: data.toString('utf8') });
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_DATA, { id, data: data.toString('utf8') });
      }
    });

    proc.on('close', (code) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_DATA, {
          id,
          data: `\r\n[Process exited with code ${code}]\r\n`
        });
      }
      this.terminals.delete(id);
    });

    this.terminals.set(id, { id, process: proc, cwd });
  }

  write(id: string, data: string): void {
    const inst = this.terminals.get(id);
    if (inst && inst.process.stdin.writable) {
      inst.process.stdin.write(data);
    }
  }

  killTerminal(id: string): void {
    const inst = this.terminals.get(id);
    if (inst) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', inst.process.pid?.toString() || '', '/f', '/t']);
        } else {
          inst.process.kill('SIGTERM');
        }
      } catch (e) {
        console.error('Failed to kill terminal process:', e);
      }
      this.terminals.delete(id);
    }
  }

  async runCommandOnce(command: string, cwd: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
      
      const proc = spawn(shell, args, { cwd, env: process.env });
      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        resolve({ stdout, stderr: stderr + '\nCommand timed out after ' + timeoutMs + 'ms', exitCode: -1 });
      }, timeoutMs);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

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
