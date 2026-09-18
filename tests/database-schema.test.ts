import { describe, it, expect } from 'vitest';
import {
  BACKUP_PREFIX,
  KEEP_BACKUPS,
  MIGRATIONS,
  SCHEMA_VERSION,
  backupFileName,
  isNewerSchema,
  migrationRecord,
  planMigrations,
  pragmaIsOk,
  pragmaProblems,
  pruneBackupList,
  quarantineFileName
} from '../src/main/database/schema';

/**
 * The database file is the user's history, so the decisions around it are worth
 * pinning: a corrupt file must be kept, an upgrade must be a single ordered
 * sequence of steps, and a file from a newer build must never be rewritten.
 *
 * `better-sqlite3` is compiled for the Electron ABI and cannot be loaded by
 * Vitest, so these cover the pure decision logic; the store itself is exercised
 * live against the packaged app.
 */
describe('schema versioning', () => {
  it('has one migration step per revision', () => {
    expect(MIGRATIONS.length).toBe(SCHEMA_VERSION);
    for (const step of MIGRATIONS) expect(step.trim().length).toBeGreaterThan(0);
  });

  it('creates the bookkeeping table in the baseline so every step can be recorded', () => {
    expect(MIGRATIONS[0]).toContain('schema_migrations');
  });

  it('creates every table idempotently', () => {
    // A legacy file already has its tables; re-running the baseline must not
    // fail, which is what makes it safe as step one for an existing database.
    expect(MIGRATIONS[0]).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });

  it('plans every step for a new file and none for an up-to-date one', () => {
    expect(planMigrations(0)).toEqual([1, 2]);
    expect(planMigrations(1)).toEqual([2]);
    expect(planMigrations(SCHEMA_VERSION)).toEqual([]);
  });

  it('never plans a downgrade for a file from a newer build', () => {
    expect(planMigrations(SCHEMA_VERSION + 5)).toEqual([]);
    expect(isNewerSchema(SCHEMA_VERSION + 1)).toBe(true);
    expect(isNewerSchema(SCHEMA_VERSION)).toBe(false);
    expect(isNewerSchema(0)).toBe(false);
  });

  it('treats a missing or nonsense revision as brand new', () => {
    expect(planMigrations(-1)).toEqual([1, 2]);
    expect(planMigrations(Number.NaN)).toEqual([1, 2]);
  });

  it('records which revision was applied, with the app version', () => {
    const [version, at, app] = migrationRecord(2, new Date(1_700_000_000_000));
    expect(version).toBe(2);
    expect(at).toBe(1_700_000_000_000);
    expect(app).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('integrity results', () => {
  it('accepts "ok" in every shape the driver returns', () => {
    expect(pragmaIsOk([{ quick_check: 'ok' }])).toBe(true);
    expect(pragmaIsOk(['ok'])).toBe(true);
    expect(pragmaIsOk('ok')).toBe(true);
    expect(pragmaIsOk([{ integrity_check: 'OK' }])).toBe(true);
  });

  it('reports the actual problems rather than a bare failure', () => {
    const problems = pragmaProblems([{ quick_check: 'database disk image is malformed' }]);
    expect(problems).toEqual(['database disk image is malformed']);
    expect(pragmaIsOk([{ quick_check: 'database disk image is malformed' }])).toBe(false);
  });

  it('reports no problems when the driver returns no rows', () => {
    // Lenient on purpose: quarantining a healthy file would look like data loss
    // to the user, so only an explicit complaint moves a file aside.
    expect(pragmaProblems([])).toEqual([]);
    expect(pragmaIsOk([])).toBe(true);
  });

  it('treats a missing answer as a failure', () => {
    // No result at all means the pragma never ran — that is not health.
    expect(pragmaIsOk(undefined)).toBe(false);
    expect(pragmaIsOk(null)).toBe(false);
  });
});

describe('backup files', () => {
  it('names backups so they sort chronologically as text', () => {
    const older = backupFileName(new Date('2026-09-17T08:30:12Z'));
    const newer = backupFileName(new Date('2026-09-17T09:30:12Z'));
    expect(older.startsWith(BACKUP_PREFIX)).toBe(true);
    expect(older.endsWith('.sqlite')).toBe(true);
    expect([newer, older].sort()).toEqual([older, newer]);
  });

  it('keeps the newest backups and returns the oldest for pruning', () => {
    const names = Array.from({ length: 8 }, (_, i) => `d4ide-2026-09-0${i + 1}_00-00-00.sqlite`);
    const prune = pruneBackupList(names);
    expect(prune).toHaveLength(names.length - KEEP_BACKUPS);
    expect(prune[0]).toBe('d4ide-2026-09-01_00-00-00.sqlite');
    // The newest file is never a prune candidate.
    expect(prune).not.toContain('d4ide-2026-09-08_00-00-00.sqlite');
  });

  it('ignores files that are not backups', () => {
    expect(pruneBackupList(['d4ide.sqlite', 'd4ide.sqlite-wal', 'notes.txt'])).toEqual([]);
  });
});

describe('quarantine naming', () => {
  it('marks the damaged file instead of reusing the live name', () => {
    const name = quarantineFileName(new Date('2026-09-17T08:30:12Z'));
    expect(name).toContain('.corrupt-');
    expect(name.startsWith('d4ide.sqlite')).toBe(true);
    expect(name.endsWith('.sqlite')).toBe(true);
  });
});
