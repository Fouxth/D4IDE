import fs from 'fs';
import path from 'path';

/**
 * Structured logging (spec §66).
 *
 * Four separate streams — application, agent, provider, terminal — because they
 * have different lifetimes and different audiences: an agent trace is what you
 * read when a task went wrong, while provider errors are mostly keys and rate
 * limits, and terminal output is noisy by nature.
 *
 * Everything goes through `redact()` before it touches a file: a log that leaks
 * an API key is worse than no log at all. Records are kept both in memory (for
 * the Settings → Logs view) and on disk (rotated, so a long-running app cannot
 * fill the disk).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogChannel = 'app' | 'agent' | 'provider' | 'terminal';

export const LOG_CHANNELS: LogChannel[] = ['app', 'agent', 'provider', 'terminal'];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_MEMORY_PER_CHANNEL = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ROTATED_FILES = 2;

export interface LogRecord {
  id: string;
  channel: LogChannel;
  level: LogLevel;
  message: string;
  /** Structured context, already redacted. */
  context?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Patterns that must never reach a log file. Deliberately broad: a false
 * positive costs a few characters, a false negative leaks a credential.
 */
const SECRET_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // Authorization headers and bearer tokens.
  { regex: /(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;"']+/gi, replacement: '$1[redacted]' },
  { regex: /\bbearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, replacement: 'Bearer [redacted]' },
  // Provider keys by shape.
  { regex: /\b(sk|pk|rk)-[A-Za-z0-9_-]{10,}/g, replacement: '[redacted-key]' },
  { regex: /\bsk-ant-[A-Za-z0-9_-]{10,}/g, replacement: '[redacted-key]' },
  { regex: /\bAIza[0-9A-Za-z_-]{20,}/g, replacement: '[redacted-key]' },
  { regex: /\bxai-[A-Za-z0-9]{10,}/g, replacement: '[redacted-key]' },
  // key=value / "key": "value" style assignments.
  {
    regex:
      /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\s*["']?\s*[:=]\s*["']?)([^\s,;"'}\]]{4,})/gi,
    replacement: '$1[redacted]'
  },
  // JWTs.
  { regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[redacted-jwt]' },
  // Private key blocks.
  {
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[redacted-private-key]'
  }
];

/**
 * Recursively strips secrets out of a string or object. Exported for tests: this
 * is the guarantee that logs are safe to share.
 */
export function redact<T>(value: T): T {
  if (typeof value === 'string') {
    let out: string = value;
    for (const { regex, replacement } of SECRET_PATTERNS) out = out.replace(regex, replacement);
    return out as unknown as T;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redact(entry)]);
    return Object.fromEntries(entries) as unknown as T;
  }
  return value;
}

class LogService {
  private dir: string | null = null;
  private minLevel: LogLevel = 'info';
  private buffers: Record<LogChannel, LogRecord[]> = { app: [], agent: [], provider: [], terminal: [] };
  private writeQueue: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private seq = 0;

  /**
   * Points the logger at the app data directory. Until this runs, records are
   * kept in memory only — logging must never be a reason the app fails to boot.
   */
  init(dataDir: string, minLevel: LogLevel = 'info'): void {
    this.minLevel = minLevel;
    try {
      this.dir = path.join(dataDir, 'logs');
      fs.mkdirSync(this.dir, { recursive: true });
      for (const channel of LOG_CHANNELS) this.rotateIfNeeded(channel);
      this.log('app', 'info', 'D4IDE log service started', { dir: this.dir, minLevel });
    } catch (error) {
      this.dir = null;
      this.log('app', 'warn', 'Log files are unavailable — keeping logs in memory only', {
        error: (error as Error).message
      });
    }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  debug(channel: LogChannel, message: string, context?: Record<string, unknown>): void {
    this.log(channel, 'debug', message, context);
  }

  info(channel: LogChannel, message: string, context?: Record<string, unknown>): void {
    this.log(channel, 'info', message, context);
  }

  warn(channel: LogChannel, message: string, context?: Record<string, unknown>): void {
    this.log(channel, 'warn', message, context);
  }

  error(channel: LogChannel, message: string, context?: Record<string, unknown>): void {
    this.log(channel, 'error', message, context);
  }

  log(channel: LogChannel, level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;

    const record: LogRecord = {
      id: `log_${++this.seq}`,
      channel,
      level,
      message: redact(String(message)).slice(0, 4000),
      context: context ? redact(context) : undefined,
      timestamp: Date.now()
    };

    const buffer = this.buffers[channel];
    buffer.push(record);
    if (buffer.length > MAX_MEMORY_PER_CHANNEL) buffer.splice(0, buffer.length - MAX_MEMORY_PER_CHANNEL);

    const line = `${new Date(record.timestamp).toISOString()} ${level.toUpperCase().padEnd(5)} ${record.message}${
      record.context ? ` ${JSON.stringify(record.context)}` : ''
    }\n`;
    this.writeQueue.push(`${channel}\t${line}`);
    this.scheduleFlush();
  }

  /** Sequence number of a record, used to break timestamp ties. */
  private static seqOf(record: LogRecord): number {
    return Number.parseInt(record.id.slice(4), 10) || 0;
  }

  /** Newest-first slice of the in-memory buffer, for the Settings → Logs view. */
  read(options: { channel?: LogChannel; level?: LogLevel; limit?: number; search?: string } = {}): LogRecord[] {
    const channels = options.channel ? [options.channel] : LOG_CHANNELS;
    const floor = options.level ? LEVEL_ORDER[options.level] : 0;
    const search = options.search?.trim().toLowerCase();

    const records = channels
      .flatMap((channel) => this.buffers[channel])
      .filter((record) => LEVEL_ORDER[record.level] >= floor)
      .filter((record) =>
        !search ? true : `${record.message} ${JSON.stringify(record.context ?? {})}`.toLowerCase().includes(search)
      )
      // Ties are common (many records share a millisecond) and `sort` is only
      // stable, not newest-first — so the monotonic sequence is the tiebreaker.
      .sort((a, b) => b.timestamp - a.timestamp || LogService.seqOf(b) - LogService.seqOf(a));

    return records.slice(0, Math.min(Math.max(options.limit ?? 200, 1), MAX_MEMORY_PER_CHANNEL));
  }

  /** Counts per level across the selected channels, for the log viewer badges. */
  counts(): Record<LogLevel, number> {
    const total: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const channel of LOG_CHANNELS) {
      for (const record of this.buffers[channel]) total[record.level] += 1;
    }
    return total;
  }

  getLogDirectory(): string | null {
    return this.dir;
  }

  clear(): void {
    for (const channel of LOG_CHANNELS) this.buffers[channel] = [];
  }

  /** Writes queued lines and truncates a channel's file when it grows too large. */
  private scheduleFlush(): void {
    if (this.flushTimer || !this.dir) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 250);
    this.flushTimer.unref?.();
  }

  private flush(): void {
    if (!this.dir || this.writeQueue.length === 0) return;
    const pending = this.writeQueue;
    this.writeQueue = [];

    const byChannel = new Map<LogChannel, string[]>();
    for (const entry of pending) {
      const tab = entry.indexOf('\t');
      const channel = entry.slice(0, tab) as LogChannel;
      byChannel.set(channel, [...(byChannel.get(channel) ?? []), entry.slice(tab + 1)]);
    }

    for (const [channel, lines] of byChannel) {
      try {
        this.rotateIfNeeded(channel);
        fs.appendFileSync(path.join(this.dir, `${channel}.log`), lines.join(''), 'utf8');
      } catch {
        // A failed log write must never surface as an application error.
      }
    }
  }

  private rotateIfNeeded(channel: LogChannel): void {
    if (!this.dir) return;
    const file = path.join(this.dir, `${channel}.log`);
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size < MAX_FILE_BYTES) return;
      for (let index = ROTATED_FILES - 1; index >= 1; index--) {
        const from = path.join(this.dir, `${channel}.${index}.log`);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(this.dir, `${channel}.${index + 1}.log`));
      }
      fs.renameSync(file, path.join(this.dir, `${channel}.1.log`));
    } catch {
      // Rotation is best effort; appending is still better than losing the line.
    }
  }
}

export const logService = new LogService();
