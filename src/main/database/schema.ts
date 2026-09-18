import { APP_VERSION } from '../../shared/version';

/**
 * Versioned schema for the SQLite backend.
 *
 * Everything durable the app owns — sessions, messages, usage, checkpoints, the
 * audit trail — lives in one file under `%APPDATA%/d4ide/D4IDE_DATA`. That file
 * is the difference between "my history is still there" and "my history is
 * gone", so it gets treated like a database rather than a cache:
 *
 *   · `PRAGMA user_version` records which revision the file is on, so an upgrade
 *     is a sequence of named steps instead of a pile of `CREATE TABLE IF NOT
 *     EXISTS` that silently leaves old files behind.
 *   · Each revision is an ordered, idempotent step. A file created today and a
 *     file created a year ago converge on the same shape.
 *   · Opening runs `PRAGMA quick_check`; a file that fails is quarantined rather
 *     than deleted, and a fresh one is created, so a corrupt database costs the
 *     user their history but never the app.
 *   · Before an upgrade touches an existing file, the file is copied to
 *     `backups/` with `VACUUM INTO`, which produces a consistent snapshot.
 *
 * The decision logic below is pure and shared with the unit tests, which cannot
 * load `better-sqlite3` (it is compiled for the Electron ABI).
 */

/** Current revision. Bump this and append a step whenever the shape changes. */
export const SCHEMA_VERSION = 2;

export const DATABASE_FILE = 'd4ide.sqlite';
export const BACKUP_DIR = 'backups';
export const BACKUP_PREFIX = 'd4ide-';
export const CORRUPT_MARKER = '.corrupt-';

/** How many automatic backups to keep. */
export const KEEP_BACKUPS = 5;

/** v1 — the baseline: every table the app has ever written to. */
const V1 = `
  CREATE TABLE IF NOT EXISTS projects (
    path TEXT PRIMARY KEY,
    name TEXT,
    last_opened_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    project_path TEXT,
    provider_id TEXT,
    model_id TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,
    content TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    type TEXT,
    title TEXT,
    content TEXT,
    status TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    prompt TEXT,
    mode TEXT,
    status TEXT,
    created_at INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY,
    prompt TEXT,
    mode TEXT,
    status TEXT,
    position INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    timestamp INTEGER,
    description TEXT,
    file_count INTEGER,
    payload TEXT
  );

  CREATE TABLE IF NOT EXISTS file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    path TEXT,
    change_type TEXT,
    additions INTEGER,
    deletions INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS provider_configs (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    enabled INTEGER,
    base_url TEXT,
    status TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS model_configs (
    provider_id TEXT,
    model_id TEXT,
    name TEXT,
    context_window INTEGER,
    input_price REAL,
    output_price REAL,
    PRIMARY KEY (provider_id, model_id)
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    provider_id TEXT,
    provider_name TEXT,
    model_id TEXT,
    model_name TEXT,
    project_path TEXT,
    mode TEXT,
    status TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_input_tokens INTEGER,
    estimated_cost REAL,
    duration_ms INTEGER,
    created_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);

  CREATE TABLE IF NOT EXISTS tool_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name TEXT,
    args_preview TEXT,
    mode TEXT,
    allowed INTEGER,
    requires_approval INTEGER,
    decision TEXT,
    reason TEXT,
    duration_ms INTEGER,
    created_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON tool_audit(created_at);

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT,
    project_path TEXT,
    description TEXT,
    content TEXT,
    is_global INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER,
    app_version TEXT
  );
`;

/**
 * v2 — index the lookups the UI actually performs, and start recording which
 * revision was applied when. The app reads a session's messages and events on
 * every reopen; without these indexes those reads scanned the whole table.
 */
const V2 = `
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_events_session ON agent_events(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_queue_position ON queue_items(status, position);
`;

/** Ordered migration steps: index 0 is revision 1. */
export const MIGRATIONS: readonly string[] = [V1, V2];

/**
 * Which revisions a file still needs. A brand-new file reports `user_version =
 * 0` and runs everything; an up-to-date file runs nothing.
 */
export function planMigrations(current: number, target: number = SCHEMA_VERSION): number[] {
  const from = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
  const steps: number[] = [];
  for (let v = from + 1; v <= target; v++) steps.push(v);
  return steps;
}

/** A file written by a newer build must not be "upgraded" downwards. */
export function isNewerSchema(current: number, target: number = SCHEMA_VERSION): boolean {
  return Number.isFinite(current) && Math.floor(current) > target;
}

/** Turns a `PRAGMA` result into "did it answer ok?" across driver result shapes. */
export function pragmaIsOk(result: unknown): boolean {
  return pragmaProblems(result).length === 0;
}

/** The failure messages a `PRAGMA quick_check` / `integrity_check` reported. */
export function pragmaProblems(result: unknown): string[] {
  if (result === undefined || result === null) return ['no result'];
  if (typeof result === 'string') return result.toLowerCase() === 'ok' ? [] : [result];
  if (!Array.isArray(result)) return [String(result)];
  const problems: string[] = [];
  for (const row of result) {
    if (row && typeof row === 'object') {
      const values = Object.values(row as Record<string, unknown>).map((v) => String(v));
      if (values.length === 1 && values[0].toLowerCase() === 'ok') continue;
      problems.push(values.join(' '));
    } else if (String(row).toLowerCase() !== 'ok') {
      problems.push(String(row));
    }
  }
  return problems;
}

const stamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/** `d4ide-2026-09-17_08-30-12.sqlite` — sorts chronologically as text. */
export function backupFileName(date: Date = new Date()): string {
  return `${BACKUP_PREFIX}${stamp(date)}.sqlite`;
}

/** Where a damaged file is moved so it can be inspected instead of deleted. */
export function quarantineFileName(date: Date = new Date()): string {
  return `${DATABASE_FILE}${CORRUPT_MARKER}${stamp(date)}.sqlite`;
}

/** Backups beyond the newest `keep`, oldest first — the ones safe to delete. */
export function pruneBackupList(names: string[], keep: number = KEEP_BACKUPS): string[] {
  const backups = names
    .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith('.sqlite'))
    .sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** Row appended to `schema_migrations` after each applied step. */
export function migrationRecord(version: number, date: Date = new Date()): [number, number, string] {
  return [version, date.getTime(), APP_VERSION];
}
