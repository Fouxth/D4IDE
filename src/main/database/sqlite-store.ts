import fs from 'fs';
import path from 'path';
import {
  Checkpoint,
  DatabaseCheckResult,
  DatabaseInfo,
  DatabaseTableInfo,
  FileChange,
  SessionSummary,
  ToolAuditEntry,
  UsageRecord
} from '../../shared/types';
import {
  BACKUP_DIR,
  DATABASE_FILE,
  MIGRATIONS,
  SCHEMA_VERSION,
  backupFileName,
  isNewerSchema,
  migrationRecord,
  planMigrations,
  pragmaProblems,
  pruneBackupList,
  quarantineFileName
} from './schema';
import { machineProfile, sqliteCacheKb } from '../performance/machine';

/**
 * SQLite backend (spec §45/§46).
 *
 * `better-sqlite3` is a native module. When it is installed and loads we use it
 * for the high-volume data (usage, audit trail, sessions, checkpoints, file
 * changes); when it is missing or fails to load the JSON store keeps working
 * unchanged. Nothing here throws — a failure just disables the backend.
 *
 * The file this class opens is the user's history, so it is opened like a
 * database rather than a cache:
 *
 *   · `quick_check` on open. A damaged file is renamed to
 *     `d4ide.sqlite.corrupt-<stamp>` and a fresh one created — a corrupt
 *     database costs the user their history, never the app. Nothing is deleted.
 *   · Upgrades run through the versioned steps in `schema.ts` and are preceded
 *     by a `VACUUM INTO` snapshot in `backups/`.
 *   · `checkpoint()` folds the WAL back into the main file (on quit) and
 *     `vacuum()` / `integrityCheck()` are exposed to the Settings UI.
 */
/**
 * The values bound into `tool_audit`, in one place so the shape can be asserted
 * without a database (the native module only loads under Electron's ABI).
 */
export function auditRow(entry: ToolAuditEntry): Record<string, string | number> {
  return {
    entry_id: entry.id,
    session_id: entry.sessionId ?? '',
    tool_name: entry.toolName,
    args_preview: entry.argsPreview ?? '',
    mode: entry.mode,
    allowed: entry.allowed ? 1 : 0,
    requires_approval: entry.requiresApproval ? 1 : 0,
    decision: entry.decision ?? '',
    reason: entry.reason ?? '',
    duration_ms: entry.durationMs ?? 0,
    created_at: entry.timestamp
  };
}

export class SqliteRepo {
  private db: any;
  readonly file: string;
  readonly dataDir: string;
  /** Set when a damaged file was moved aside during `tryOpen`. */
  readonly quarantinedFile: string | null;

  private constructor(db: any, file: string, dataDir: string, quarantinedFile: string | null) {
    this.db = db;
    this.file = file;
    this.dataDir = dataDir;
    this.quarantinedFile = quarantinedFile;
  }

  static tryOpen(dataDir: string): SqliteRepo | null {
    let sqlite: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sqlite = require('better-sqlite3');
    } catch {
      return null;
    }

    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const file = path.join(dataDir, DATABASE_FILE);
      const { db, quarantined } = SqliteRepo.openVerified(sqlite, file);
      const repo = new SqliteRepo(db, file, dataDir, quarantined);
      repo.migrate();
      return repo;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/.test(message)) {
        // `pnpm rebuild:native` builds SQLite for the Electron ABI, so plain
        // Node processes (unit tests, scripts) cannot load it. Expected — JSON
        // storage covers those runs.
        console.warn('[D4IDE] Native SQLite is built for the Electron runtime — using JSON storage here.');
      } else {
        console.warn('[D4IDE] SQLite unavailable, using JSON storage instead:', e);
      }
      return null;
    }
  }

  /**
   * Opens the file and proves it is readable before anyone writes to it. A file
   * that fails `quick_check` is moved aside (with its `-wal`/`-shm` siblings)
   * and replaced by a new one, so the app always starts with a usable database.
   */
  private static openVerified(sqlite: any, file: string): { db: any; quarantined: string | null } {
    let db = new sqlite(file);
    SqliteRepo.applyPragmas(db);

    const problems = pragmaProblems(db.pragma('quick_check'));
    if (problems.length === 0) return { db, quarantined: null };

    console.warn('[D4IDE] SQLite quick_check failed — quarantining the damaged file:', problems.join('; '));
    try {
      db.close();
    } catch {
      // Already closed.
    }

    const target = path.join(path.dirname(file), quarantineFileName());
    for (const suffix of ['', '-wal', '-shm']) {
      const from = file + suffix;
      if (!fs.existsSync(from)) continue;
      try {
        fs.renameSync(from, target + suffix);
      } catch (e) {
        console.warn(`[D4IDE] Could not move ${from} aside:`, e);
      }
    }

    db = new sqlite(file);
    SqliteRepo.applyPragmas(db);
    return { db, quarantined: target };
  }

  /**
   * Durability and memory settings, applied to every connection.
   *
   * `cache_size` is the one that decides how much this database holds: SQLite's
   * own default is 2 MB, chosen for servers, and a negative value means
   * kilobytes. On a small machine it is halved — the reads here are small and
   * indexed, so the pages it gives up were not earning their memory.
   */
  private static applyPragmas(db: any): void {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 4000');
    db.pragma('temp_store = MEMORY');
    db.pragma(`cache_size = -${sqliteCacheKb(machineProfile())}`);
    // Fold the WAL back periodically so it cannot grow without bound between
    // quits; a long agent run writes a lot of small rows.
    db.pragma('wal_autocheckpoint = 512');
  }

  // ------------------------------------------------------------- migration

  private currentVersion(): number {
    try {
      const value = this.db.pragma('user_version', { simple: true });
      return typeof value === 'number' ? value : 0;
    } catch {
      return 0;
    }
  }

  private hasUserTables(): boolean {
    try {
      const rows = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[];
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Brings the file up to `SCHEMA_VERSION`. A file already on the current
   * revision does no work; a file from a newer build is left untouched, because
   * a downgrade would silently drop columns the newer build relies on.
   */
  private migrate(): void {
    const current = this.currentVersion();

    if (isNewerSchema(current)) {
      console.warn(
        `[D4IDE] Database is at revision ${current}, newer than this build (${SCHEMA_VERSION}) — leaving it untouched.`
      );
      return;
    }

    const plan = planMigrations(current);
    if (plan.length === 0) return;

    // Only snapshot when there is something to lose; a brand-new file has no
    // history worth copying.
    const upgrading = this.hasUserTables();
    if (upgrading) this.backup();

    for (const version of plan) {
      this.db.exec(MIGRATIONS[version - 1]);
      try {
        const record = migrationRecord(version);
        this.db
          .prepare('INSERT OR REPLACE INTO schema_migrations (version, applied_at, app_version) VALUES (?, ?, ?)')
          .run(record[0], record[1], record[2]);
      } catch {
        // The bookkeeping table arrives with revision 2; a failure to record a
        // step is not a reason to abandon the upgrade.
      }
    }

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    if (upgrading) console.log(`[D4IDE] Database upgraded from revision ${current} to ${SCHEMA_VERSION}.`);
  }

  // ----------------------------------------------------------- maintenance

  /** Copies the database to `backups/` as a consistent snapshot. */
  backup(): string | null {
    try {
      const dir = path.join(this.dataDir, BACKUP_DIR);
      fs.mkdirSync(dir, { recursive: true });

      let target = path.join(dir, backupFileName());
      for (let n = 2; fs.existsSync(target) && n < 100; n++) {
        target = path.join(dir, backupFileName().replace(/\.sqlite$/, `-${n}.sqlite`));
      }

      // `VACUUM INTO` writes a transactionally consistent copy without locking
      // the live connection for the whole session.
      this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

      for (const stale of pruneBackupList(fs.readdirSync(dir))) {
        try {
          fs.unlinkSync(path.join(dir, stale));
        } catch {
          // Another process may hold it; it will be pruned next time.
        }
      }
      return target;
    } catch (e) {
      console.warn('[D4IDE] Database backup failed:', e);
      return null;
    }
  }

  /** Full `integrity_check`. Slower than `quickCheck`, so it is on demand. */
  integrityCheck(): DatabaseCheckResult {
    return this.runCheck('integrity_check');
  }

  /** Fast check — the same one performed on open. */
  quickCheck(): DatabaseCheckResult {
    return this.runCheck('quick_check');
  }

  private runCheck(pragma: 'integrity_check' | 'quick_check'): DatabaseCheckResult {
    try {
      const problems = pragmaProblems(this.db.pragma(pragma));
      return { ok: problems.length === 0, problems, checkedAt: Date.now() };
    } catch (e) {
      return {
        ok: false,
        problems: [e instanceof Error ? e.message : String(e)],
        checkedAt: Date.now()
      };
    }
  }

  /** Folds the write-ahead log back into the main file. Called on quit. */
  checkpoint(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A checkpoint is an optimisation, never a correctness requirement.
    }
  }

  /** Reclaims free pages after deletions. Exclusive, so it only runs on demand. */
  vacuum(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
      this.db.exec('ANALYZE');
    } catch (e) {
      console.warn('[D4IDE] VACUUM failed:', e);
    }
  }

  private fileSize(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  private tableCounts(): DatabaseTableInfo[] {
    const tables: DatabaseTableInfo[] = [];
    try {
      const rows = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as { name: string }[];
      for (const row of rows) {
        let count = 0;
        try {
          count = (this.db.prepare(`SELECT COUNT(*) AS n FROM "${row.name}"`).get() as { n: number })?.n ?? 0;
        } catch {
          count = -1;
        }
        tables.push({ name: row.name, rows: count });
      }
    } catch {
      // Report whatever we managed to read.
    }
    return tables;
  }

  private backupFiles(): { name: string; sizeBytes: number; modifiedAt: number }[] {
    try {
      const dir = path.join(this.dataDir, BACKUP_DIR);
      return fs
        .readdirSync(dir)
        .filter((n) => n.endsWith('.sqlite'))
        .sort()
        .reverse()
        .map((name) => {
          const stat = fs.statSync(path.join(dir, name));
          return { name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs };
        });
    } catch {
      return [];
    }
  }

  /** Everything the Settings → Database panel shows. */
  info(): DatabaseInfo {
    const pageSize = Number(this.db.pragma('page_size', { simple: true })) || 0;
    const pageCount = Number(this.db.pragma('page_count', { simple: true })) || 0;
    const freePages = Number(this.db.pragma('freelist_count', { simple: true })) || 0;
    const version = this.currentVersion();

    return {
      file: this.file,
      dataDir: this.dataDir,
      sizeBytes: this.fileSize(this.file),
      walBytes: this.fileSize(`${this.file}-wal`),
      version,
      targetVersion: SCHEMA_VERSION,
      journalMode: String(this.db.pragma('journal_mode', { simple: true }) ?? 'unknown'),
      pageSize,
      pageCount,
      freePages,
      tables: this.tableCounts(),
      backups: this.backupFiles(),
      quarantinedFile: this.quarantinedFile,
      healthy: version <= SCHEMA_VERSION
    };
  }

  // ---------------------------------------------------------------- usage

  insertUsage(record: UsageRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO usage_records
         (id, session_id, provider_id, provider_name, model_id, model_name, project_path, mode, status,
          input_tokens, output_tokens, cached_input_tokens, estimated_cost, duration_ms, created_at,
          summary, summary_request)
         VALUES (@id, @session_id, @provider_id, @provider_name, @model_id, @model_name, @project_path, @mode, @status,
          @input_tokens, @output_tokens, @cached_input_tokens, @estimated_cost, @duration_ms, @created_at,
          @summary, @summary_request)`
      )
      .run({
        id: record.id,
        session_id: record.sessionId ?? '',
        provider_id: record.providerId ?? '',
        provider_name: record.providerName ?? '',
        model_id: record.modelId ?? '',
        model_name: record.modelName ?? '',
        project_path: record.projectPath ?? '',
        mode: record.mode ?? '',
        status: record.status ?? 'completed',
        input_tokens: record.inputTokens ?? 0,
        output_tokens: record.outputTokens ?? 0,
        cached_input_tokens: record.cachedInputTokens ?? 0,
        estimated_cost: record.estimatedCost ?? 0,
        duration_ms: record.durationMs ?? 0,
        created_at: record.timestamp ?? Date.now(),
        summary: record.summary ?? null,
        summary_request: record.summaryRequest ?? null
      });
  }

  insertUsageMany(records: UsageRecord[]): void {
    const insert = this.db.transaction((items: UsageRecord[]) => {
      for (const item of items) this.insertUsage(item);
    });
    insert(records);
  }

  /**
   * Attaches a completion report to the newest usage row of a session.
   *
   * Newest, because the summary is written when the run ends and the run's last
   * provider call is the row that was created moments before. Returns false when
   * the session has no usage yet — nothing was spent, so there is nowhere to put
   * the report, and the caller should not pretend otherwise.
   */
  attachUsageSummary(sessionId: string, summary: string, request: string): boolean {
    const row = this.db
      .prepare(`SELECT id FROM usage_records WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(sessionId) as { id: string } | undefined;
    if (!row) return false;
    this.db
      .prepare(`UPDATE usage_records SET summary = ?, summary_request = ? WHERE id = ?`)
      .run(summary, request, row.id);
    return true;
  }

  queryUsage(limit = 20000): UsageRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM usage_records ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      providerId: r.provider_id,
      providerName: r.provider_name || undefined,
      modelId: r.model_id,
      modelName: r.model_name || undefined,
      projectPath: r.project_path || undefined,
      mode: r.mode || undefined,
      status: r.status || 'completed',
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedInputTokens: r.cached_input_tokens || undefined,
      estimatedCost: r.estimated_cost,
      durationMs: r.duration_ms || undefined,
      summary: r.summary || undefined,
      summaryRequest: r.summary_request || undefined,
      timestamp: r.created_at
    }));
  }

  clearUsage(fromTimestamp = 0): void {
    if (fromTimestamp <= 0) this.db.prepare('DELETE FROM usage_records').run();
    else this.db.prepare('DELETE FROM usage_records WHERE created_at >= ?').run(fromTimestamp);
  }

  /**
   * Deletes usage rows older than a timestamp and reports how many went.
   *
   * Indexed on `created_at`, so this is a range scan rather than a table scan,
   * and the WAL grows by the deleted pages until the next checkpoint — which
   * `wal_autocheckpoint` performs on its own.
   */
  pruneUsage(before: number): number {
    const info = this.db.prepare('DELETE FROM usage_records WHERE created_at < ?').run(before);
    return Number(info?.changes ?? 0);
  }

  countUsage(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM usage_records').get() as { count: number };
    return row?.count ?? 0;
  }

  // ---------------------------------------------------------------- audit

  /**
   * Records one tool call.
   *
   * Two things matter here beyond the columns. The caller's id is **text**
   * (`a_1789…`), so it goes into `entry_id` and never into `id`, which is a
   * rowid alias: SQLite answers a non-integer there with SQLITE_MISMATCH, and
   * that threw inside the run loop — a refused tool call ended the run instead of
   * being reported. And the write is best-effort: a bookkeeping failure must
   * never abort the work it is recording, so it is logged and swallowed.
   */
  insertAudit(entry: ToolAuditEntry): void {
    try {
      const row = auditRow(entry);
      this.db
        .prepare(
          `INSERT INTO tool_audit
           (entry_id, session_id, tool_name, args_preview, mode, allowed, requires_approval, decision, reason, duration_ms, created_at)
           VALUES (@entry_id, @session_id, @tool_name, @args_preview, @mode, @allowed, @requires_approval, @decision, @reason, @duration_ms, @created_at)`
        )
        .run(row);
    } catch (error) {
      console.error('[db] failed to record a tool call in the audit trail:', error);
    }
  }

  queryAudit(limit = 200): ToolAuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM tool_audit ORDER BY created_at DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((r) => ({
      // Rows written before v3 have no `entry_id`; the rowid names them instead.
      id: r.entry_id || `a_${r.id}`,
      sessionId: r.session_id,
      toolName: r.tool_name,
      argsPreview: r.args_preview,
      mode: r.mode,
      allowed: !!r.allowed,
      requiresApproval: !!r.requires_approval,
      decision: r.decision || undefined,
      reason: r.reason || undefined,
      durationMs: r.duration_ms || undefined,
      timestamp: r.created_at
    }));
  }

  // ------------------------------------------------------------- sessions

  upsertSession(session: SessionSummary): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, project_path, provider_id, model_id, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, project_path=excluded.project_path,
           provider_id=excluded.provider_id, model_id=excluded.model_id, updated_at=excluded.updated_at, status=excluded.status`
      )
      .run(
        session.id,
        session.title ?? '',
        session.projectPath ?? '',
        session.providerId ?? '',
        session.modelId ?? '',
        session.createdAt ?? Date.now(),
        session.updatedAt ?? Date.now(),
        session.status ?? 'idle'
      );
  }

  listSessions(): SessionSummary[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 100').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      projectPath: r.project_path,
      providerId: r.provider_id,
      modelId: r.model_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      status: r.status
    }));
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM agent_events WHERE session_id = ?').run(sessionId);
  }

  insertMessages(sessionId: string, messages: { role: string; content: string; timestamp: number }[]): void {
    const insert = this.db.transaction((items: typeof messages) => {
      const stmt = this.db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)');
      for (const m of items) stmt.run(sessionId, m.role, m.content, m.timestamp);
    });
    insert(messages);
  }

  getMessages(sessionId: string): { role: string; content: string; timestamp: number }[] {
    const rows = this.db
      .prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as any[];
    return rows.map((r) => ({ role: r.role, content: r.content, timestamp: r.created_at }));
  }

  // ---------------------------------------------------------- checkpoints

  saveCheckpoint(checkpoint: Checkpoint): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints (id, timestamp, description, file_count, payload) VALUES (?, ?, ?, ?, ?)`
      )
      .run(checkpoint.id, checkpoint.timestamp, checkpoint.description, checkpoint.files?.length ?? 0, JSON.stringify(checkpoint));
  }

  listCheckpoints(): Checkpoint[] {
    const rows = this.db
      .prepare('SELECT payload FROM checkpoints ORDER BY timestamp DESC')
      .all() as { payload: string }[];
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payload) as Checkpoint;
        } catch {
          return null;
        }
      })
      .filter((c): c is Checkpoint => !!c);
  }

  getCheckpoint(id: string): Checkpoint | null {
    const row = this.db.prepare('SELECT payload FROM checkpoints WHERE id = ?').get(id) as { payload: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as Checkpoint;
    } catch {
      return null;
    }
  }

  deleteCheckpoint(id: string): void {
    this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
  }

  // -------------------------------------------------------- file changes

  insertFileChange(sessionId: string, change: FileChange): void {
    this.db
      .prepare(
        'INSERT INTO file_changes (session_id, path, change_type, additions, deletions, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      // `?? 0` for the same reason the audit row is defensive: a caller that
      // omits the counts must not make the write throw. Binding `undefined` is
      // refused outright by the driver, and this runs inside the file-change
      // handler of a live run.
      .run(sessionId, change.relativePath, change.type, change.additions ?? 0, change.deletions ?? 0, Date.now());
  }

  // ------------------------------------------------------------ projects

  touchProject(projectPath: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO projects (path, name, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at`
      )
      .run(projectPath, name, Date.now());
  }

  close(): void {
    this.checkpoint();
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }
}
