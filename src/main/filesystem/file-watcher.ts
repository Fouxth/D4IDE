import fs from 'fs';
import path from 'path';

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'out',
  '.next',
  'coverage',
  'release',
  '__pycache__',
  '.turbo',
  '.cache'
]);

export interface FileWatchEvent {
  path: string;
  relativePath: string;
  kind: 'changed' | 'created' | 'deleted';
  timestamp: number;
}

/**
 * Watches a project folder for changes made outside D4IDE (spec §48).
 * Uses `fs.watch` so no native dependency is required; recursive watching is
 * supported on Windows and macOS, and falls back to top-level watching on Linux.
 */
export class FileWatcher {
  private watcher: fs.FSWatcher | null = null;
  private root: string | null = null;
  private pending = new Map<string, FileWatchEvent>();
  private flushTimer: NodeJS.Timeout | null = null;
  private listener: ((events: FileWatchEvent[]) => void) | null = null;

  isWatching(rootDir?: string): boolean {
    if (!this.watcher) return false;
    return !rootDir || this.root === rootDir;
  }

  start(rootDir: string, listener: (events: FileWatchEvent[]) => void): boolean {
    this.stop();
    if (!rootDir || !fs.existsSync(rootDir)) return false;

    this.root = rootDir;
    this.listener = listener;

    try {
      this.watcher = fs.watch(rootDir, { recursive: process.platform !== 'linux', persistent: false }, (_event, filename) => {
        if (!filename) return;
        const relative = filename.toString();
        if (this.shouldIgnore(relative)) return;

        const absolute = path.join(rootDir, relative);
        const exists = fs.existsSync(absolute);
        this.pending.set(relative, {
          path: absolute,
          relativePath: relative.replace(/\\/g, '/'),
          kind: exists ? 'changed' : 'deleted',
          timestamp: Date.now()
        });
        this.scheduleFlush();
      });

      this.watcher.on('error', (error) => {
        console.warn('[D4IDE] File watcher error:', error);
        this.stop();
      });
      return true;
    } catch (e) {
      console.warn('[D4IDE] Could not start the file watcher:', e);
      this.watcher = null;
      return false;
    }
  }

  stop(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Already closed.
      }
    }
    this.watcher = null;
    this.root = null;
    this.pending.clear();
  }

  /** Debounce bursts so a save-all does not flood the renderer (spec §57). */
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.listener || this.pending.size === 0) return;
      const events = Array.from(this.pending.values());
      this.pending.clear();
      this.listener(events);
    }, 350);
  }

  private shouldIgnore(relativePath: string): boolean {
    const parts = relativePath.split(/[\\/]/);
    if (parts.some((part) => IGNORED.has(part))) return true;
    return /\.(tmp|swp|log)$/i.test(relativePath);
  }
}

export const fileWatcher = new FileWatcher();
