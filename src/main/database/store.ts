import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  AppSettings,
  Checkpoint,
  DatabaseCheckResult,
  DatabaseInfo,
  ProviderConfig,
  SessionSummary,
  ToolAuditEntry,
  UsageRecord
} from '../../shared/types';
import { keyStorage } from '../security/key-storage';
import { buildDefaultProviders, PROVIDER_PRESETS } from '../ai/providers/catalog';
import { SqliteRepo } from './sqlite-store';
import { BufferSnapshot, Mission } from '../../shared/types';
import { USAGE_RETENTION_DAYS } from '../performance/machine';

const DEFAULT_SETTINGS: AppSettings = {
  language: 'th',
  theme: 'd4-dark',
  fontSize: 14,
  permissionMode: 'safe',
  defaultMode: 'build',
  autoRunTests: true,
  autoRunBuild: true,
  maxAgentSteps: 30,
  activeProviderId: 'deepseek',
  activeModelId: 'deepseek-chat',
  routingProfile: 'balanced',
  reasoningEffort: 'medium',
  requireLogin: true,
  // Token economy. The context budget is what a single request may carry; the
  // run budget is what one task may spend before it stops and says so.
  thriftMode: false,
  contextTokenBudget: 48000,
  runTokenBudget: 0,
  cheaperModelForSmallTasks: false,
  cheapModelId: '',
  autoFallback: false,
  fallbackChain: [],
  toolTimeoutMs: 120000,
  retryLimit: 2,
  checkpointFrequency: 'write',
  favoriteModels: [],
  recentModels: [],
  recentProjects: [],
  spaces: [],
  sessionOrder: [],
  closedSessionIds: [],
  // Local runtimes stay out of the model picker until the user asks for them.
  localProvidersEnabled: false,
  firstRunComplete: false,
  removedProviderIds: [],
  logLevel: 'info',
  desktopNotifications: true,
  notificationSound: 'chime',
  // A law is only switched off when the user says so; the default is every one
  // of them in force.
  disabledLaws: [],
  // Minimal by default; "ask" makes the agent ask the user per project.
  designStyle: 'minimal',
  askDesignBeforeUiWork: true,
  projectMemoryEnabled: true,
  // Update detection is on by default; downloading and installing never are.
  updateCheckEnabled: true,
  checkUpdatesOnLaunch: true,
  updateCheckIntervalHours: 6,
  lastUpdateCheckAt: 0,
  lastNotifiedVersion: '',
  skippedUpdateVersion: '',
  catalogCheckEnabled: true,
  catalogCheckIntervalHours: 24,
  lastCatalogCheckAt: 0,
  // The health watch on the provider being talked to: on by default at a cost
  // of one models request per 10 minutes, paused while a run is in flight.
  providerHealthCheckEnabled: true,
  providerHealthCheckIntervalMinutes: 10
};

/** Masked display value for a stored key — never the key itself (spec §29). */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const tail = key.slice(-4);
  return `••••${tail}`;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    }
  } catch (e) {
    console.error(`Failed to read ${path.basename(file)}:`, e);
  }
  return fallback;
}

/**
 * Identity of a file's contents, cheap enough to take on every read.
 *
 * The app reads its own settings and provider list *per request* — the cost of
 * "is this still the file I parsed?" has to be a stat rather than a parse, and
 * one stat (~a few microseconds) is four orders of magnitude below re-reading
 * and re-decrypting. mtime plus size is enough to catch an external edit; the
 * store also clears its cache explicitly on every write it makes itself, so a
 * same-millisecond rewrite cannot slip through.
 */
function fileStamp(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Failed to write ${path.basename(file)}:`, e);
  }
}

export class AppDataStore {
  private dataDir: string;
  private missionsFile: string;
  private buffersFile: string;
  private settingsFile: string;
  private providersFile: string;
  private checkpointsDir: string;
  private usageFile: string;
  private sessionsDir: string;
  private sessionsFile: string;
  private auditFile: string;
  /** Optional SQLite backend (spec §46). Null when the native module is absent. */
  private sqlite: SqliteRepo | null = null;

  /**
   * Parsed copies of what the main process asks for over and over.
   *
   * `getSettings()` and `getProviders()` sit on the hot path of every model
   * request — routing reads the settings, and cost accounting reads the
   * providers — and each call used to re-read and re-parse a JSON file and then
   * rebuild the merged provider list. Measured on a log the size of a heavy
   * user's, one such rebuild is ~7.9 ms and one usage-log read is ~22 ms, both
   * paid on *every* request; read from memory they are 0.04 ms and none.
   *
   * (The key decryption that happens alongside is not what this saves: measured
   * in a real Electron main process, one `safeStorage.decryptString` is ~1 µs,
   * because the OS keychain caches its master key per process. The file work is
   * the cost.)
   *
   * Cached values are only ever handed back as stored, and are rebuilt whenever
   * the file they came from is written — including by this store itself. The
   * decrypted keys now live in memory for the session rather than for the
   * duration of one call; they were already in memory for every request, and
   * nothing here is persisted or sent to the renderer.
   */
  private settingsCache: { stamp: string; value: AppSettings } | null = null;
  private providersCache: { stamp: string; value: ProviderConfig[] } | null = null;

  /**
   * The usage log, kept in memory once read.
   *
   * Every recorded request asks for a fresh summary, and the summary walks the
   * whole log — so re-reading and re-mapping up to 20,000 rows from SQLite on
   * each model call was pure overhead. Writes go through this store, so the
   * in-memory log is authoritative between reads and is invalidated on every
   * write, including the startup prune.
   */
  private usageCache: UsageRecord[] | null = null;

  /** Matches the cap `queryUsage` applies, so the cache cannot outgrow the query. */
  private static readonly USAGE_CACHE_LIMIT = 20000;

  constructor() {
    try {
      this.dataDir = path.join(app.getPath('userData'), 'D4IDE_DATA');
    } catch {
      // Fallback if app is not ready yet or running in a node test.
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      this.dataDir = path.join(appData, 'D4IDE', 'D4IDE_DATA');
    }

    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.providersFile = path.join(this.dataDir, 'providers.json');
    this.usageFile = path.join(this.dataDir, 'usage.json');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.auditFile = path.join(this.dataDir, 'tool-audit.json');
    this.checkpointsDir = path.join(this.dataDir, 'checkpoints');
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.missionsFile = path.join(this.dataDir, 'missions.json');
    this.buffersFile = path.join(this.dataDir, 'buffers.json');

    this.ensureDirs();
    this.sqlite = SqliteRepo.tryOpen(this.dataDir);
    if (this.sqlite) this.migrateJsonInto(this.sqlite);
  }

  /** True when the app is backed by SQLite rather than the JSON files. */
  isUsingSqlite(): boolean {
    return !!this.sqlite;
  }

  getStorageInfo(): { backend: 'sqlite' | 'json'; dataDir: string; sqliteFile?: string } {
    return this.sqlite
      ? { backend: 'sqlite', dataDir: this.dataDir, sqliteFile: this.sqlite.file }
      : { backend: 'json', dataDir: this.dataDir };
  }

  // -------------------------------------------------- database maintenance

  /**
   * Revision, sizes, row counts and backups of the SQLite file — what the
   * Settings → Database panel reports. `null` when the JSON backend is in use.
   */
  getDatabaseInfo(): DatabaseInfo | null {
    if (!this.sqlite) return null;
    try {
      return this.sqlite.info();
    } catch (e) {
      console.warn('[D4IDE] Could not read database info:', e);
      return null;
    }
  }

  /** `full` runs `integrity_check` (slow, thorough); otherwise `quick_check`. */
  checkDatabase(full = false): DatabaseCheckResult {
    if (!this.sqlite) {
      return {
        ok: false,
        problems: ['SQLite backend is not available — data is in the JSON files under the data folder.'],
        checkedAt: Date.now()
      };
    }
    return full ? this.sqlite.integrityCheck() : this.sqlite.quickCheck();
  }

  /** Manual backup; upgrades also take one automatically. Returns the file path. */
  backupDatabase(): string | null {
    if (!this.sqlite) return null;
    const target = this.sqlite.backup();
    if (target) console.info(`[D4IDE] Database backed up to ${target}`);
    return target;
  }

  /** Reclaims free pages. Returns the byte size before and after. */
  vacuumDatabase(): { before: number; after: number } | null {
    if (!this.sqlite) return null;
    const before = this.sqlite.info().sizeBytes;
    this.sqlite.vacuum();
    const after = this.sqlite.info().sizeBytes;
    console.info(`[D4IDE] Database compacted: ${before} → ${after} bytes.`);
    return { before, after };
  }

  /** Folds the write-ahead log back into the main file (called on quit). */
  checkpointDatabase(): void {
    this.sqlite?.checkpoint();
  }

  /**
   * One-time migration: pull existing JSON history into SQLite, then rewrite
   * the JSON files so the data is not counted twice if SQLite later disappears.
   */
  private migrateJsonInto(sqlite: SqliteRepo): void {
    try {
      if (sqlite.countUsage() === 0) {
        const records = readJson<UsageRecord[]>(this.usageFile, []);
        if (Array.isArray(records) && records.length > 0) {
          sqlite.insertUsageMany(
            records.map((r, index) => ({
              ...r,
              id: r.id || `legacy_${index}_${r.timestamp}`,
              sessionId: r.sessionId || 'legacy',
              status: r.status || 'completed'
            }))
          );
          writeJson(this.usageFile, []);
          // Inserted directly, bypassing `saveUsage`, so the in-memory log must
          // be told the rows it does not have are now in the database.
          this.usageCache = null;
          console.info(`[D4IDE] Migrated ${records.length} usage records into SQLite.`);
        }
      }

      for (const session of readJson<SessionSummary[]>(this.sessionsFile, [])) {
        sqlite.upsertSession(session);
      }

      for (const entry of readJson<ToolAuditEntry[]>(this.auditFile, [])) {
        sqlite.insertAudit(entry);
      }

      for (const checkpoint of this.readCheckpointsFromDisk()) {
        sqlite.saveCheckpoint(checkpoint);
      }
    } catch (e) {
      console.warn('[D4IDE] JSON→SQLite migration skipped:', e);
    }
  }

  private ensureDirs() {
    for (const dir of [this.dataDir, this.checkpointsDir, this.sessionsDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------- settings

  /** Where the app keeps its data — used by the log service and the UI. */
  getDataDir(): string {
    return this.dataDir;
  }

  getSettings(): AppSettings {
    const stamp = fileStamp(this.settingsFile);
    if (this.settingsCache && this.settingsCache.stamp === stamp) return this.settingsCache.value;

    const stored = readJson<Partial<AppSettings>>(this.settingsFile, {});
    const value = { ...DEFAULT_SETTINGS, ...stored };
    this.settingsCache = { stamp, value };
    return value;
  }

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    const updated = { ...this.getSettings(), ...settings };
    writeJson(this.settingsFile, updated);
    // The settings decide which preset providers are hidden, and the file stamp
    // alone cannot distinguish two writes in the same millisecond.
    this.settingsCache = { stamp: fileStamp(this.settingsFile), value: updated };
    this.providersCache = null;
    return updated;
  }

  // --------------------------------------------------------------- providers

  /**
   * Providers with decrypted API keys. Main-process only — never send the
   * result of this method to the renderer (spec §29). Use
   * `getSanitizedProviders()` across IPC.
   */
  getProviders(): ProviderConfig[] {
    const stamp = fileStamp(this.providersFile);
    if (this.providersCache && this.providersCache.stamp === stamp) return this.providersCache.value;

    const stored = readJson<ProviderConfig[] | null>(this.providersFile, null);
    const removed = new Set(this.getSettings().removedProviderIds ?? []);

    if (!stored || !Array.isArray(stored) || stored.length === 0) {
      const defaults = buildDefaultProviders().filter((p) => !removed.has(p.id));
      this.saveProviders(defaults);
      this.providersCache = { stamp: fileStamp(this.providersFile), value: defaults };
      return defaults;
    }

    const merged = this.mergeWithPresets(stored, removed);

    let keyReadFailed = false;
    const decrypted = merged.map((p) => {
      let apiKey = '';
      let keyUnreadable = false;
      if (p.apiKey) {
        const read = keyStorage.decryptChecked(p.apiKey);
        apiKey = read.value;
        if (read.failed) {
          // Before `app.whenReady()` the keychain cannot serve anything yet —
          // that is our timing, not the user's data. After that, a blob that
          // will not decrypt is genuinely unreadable (the keychain changed), and
          // pretending the provider simply has no key is a lie the UI repeats.
          if (this.keychainServing()) keyUnreadable = true;
          else keyReadFailed = true;
        }
      }
      return {
        ...p,
        apiKey,
        hasApiKey: !!apiKey,
        keyUnreadable,
        apiKeyPreview: maskApiKey(apiKey),
        status: this.deriveStatus(p, !!apiKey, keyUnreadable)
      };
    });

    // "Not decryptable *yet*" must never be cached: this module is read during
    // startup, and caching that answer under the providers file's stamp would
    // freeze every keyed provider as keyless for the life of the process — no
    // `Authorization` header on requests, no catalogue check, and the UI calling
    // a working provider "needs a key". Answer honestly this once and let the
    // next read succeed.
    if (keyReadFailed) {
      return decrypted;
    }

    // Taken *after* the rebuild: `mergeWithPresets` may have written a backfill
    // to disk, and caching the stamp taken before that would miss our own edit.
    this.providersCache = { stamp: fileStamp(this.providersFile), value: decrypted };
    return decrypted;
  }

  /** Same shape as `getProviders()` but with secrets replaced by a masked preview. */
  getSanitizedProviders(): ProviderConfig[] {
    return this.getProviders().map(({ apiKey, ...rest }) => ({
      ...rest,
      hasApiKey: !!apiKey && apiKey.length > 0,
      apiKeyPreview: maskApiKey(apiKey || '')
    }));
  }

  /**
   * Add providers introduced by a newer app version without touching user
   * edits — but never resurrect one the user deleted (spec §26).
   */
  private mergeWithPresets(stored: ProviderConfig[], removed: Set<string> = new Set()): ProviderConfig[] {
    const byId = new Map(stored.map((p) => [p.id, p]));
    let changed = false;

    for (const preset of PROVIDER_PRESETS) {
      if (byId.has(preset.id) || removed.has(preset.id)) continue;
      const fresh = buildDefaultProviders().find((p) => p.id === preset.id);
      if (fresh) {
        // A new preset on an endpoint that is already configured is the same
        // account reached a different way — OpenCode's gateways serve one key
        // across several protocols, so making the user paste it once per preset
        // would be busywork. The value copied is the stored, encrypted one.
        const sibling = Array.from(byId.values()).find((p) => p.baseUrl && p.baseUrl === fresh.baseUrl && p.apiKey);
        if (sibling) fresh.apiKey = sibling.apiKey;
        byId.set(preset.id, fresh);
        changed = true;
      }
    }

    // Backfill metadata added in this version so existing configs behave.
    const merged = Array.from(byId.values()).map((p) => {
      const preset = PROVIDER_PRESETS.find((x) => x.id === p.id);
      const storedModels = p.models || [];
      const shipped = preset ? new Set(preset.models.map((m) => m.id)) : null;

      // Retire models a newer version no longer ships.
      //
      // `source: 'builtin'` models are ours — seeded from the preset, never
      // typed by the user — and a preset only shrinks for one reason: the
      // vendor stopped serving that id, or we learned this endpoint cannot call
      // it (OpenCode's gateways answer a chat-only model with a format error).
      // Keeping them means the picker offers requests that fail on first use, so
      // they go. Anything the user typed (`manual`) or the provider itself listed
      // (`fetched`) is left alone.
      const models = shipped
        ? storedModels.filter((m) => (m.source ?? 'manual') !== 'builtin' || shipped.has(m.id))
        : storedModels;
      if (models.length !== storedModels.length) {
        const dropped = storedModels.filter((m) => !models.includes(m)).map((m) => m.id);
        console.log(`[providers] ${p.id}: retired ${dropped.length} shipped model(s): ${dropped.join(', ')}`);
      }

      const next: ProviderConfig = {
        ...p,
        isBuiltIn: p.isBuiltIn ?? !!preset,
        requiresApiKey: p.requiresApiKey ?? (preset ? preset.requiresApiKey : true),
        docsUrl: p.docsUrl ?? preset?.docsUrl,
        models: models.map((m) => ({ ...m, providerId: p.id, source: m.source ?? 'manual' }))
      };
      if (JSON.stringify(next) !== JSON.stringify(p)) changed = true;
      return next;
    });

    if (changed) this.saveProviders(merged);
    return merged;
  }

  /**
   * How long a failed probe keeps a provider out of automatic routing.
   *
   * Only the Test button and a model refresh ever set `error`, and nothing clears
   * it — so without an expiry a single blip, or a probe that happened to use a
   * model needing opt-in (OpenCode Go answers 403 for those), would exclude a
   * perfectly working provider from routing for the rest of its life. A fresh
   * verdict is worth one request after this long.
   */
  private static readonly ERROR_TTL_MS = 10 * 60_000;

  /**
   * Whether the OS keychain has had its chance to serve us yet.
   *
   * `safeStorage` cannot decrypt anything before `app.whenReady()`, so a failure
   * then means "ask again in a moment" — while the same failure after startup
   * means the key on file is genuinely dead.
   */
  private keychainServing(): boolean {
    try {
      return typeof app?.isReady === 'function' ? app.isReady() : true;
    } catch {
      return true;
    }
  }

  private deriveStatus(p: ProviderConfig, hasKey: boolean, keyUnreadable = false): ProviderConfig['status'] {
    // A key we cannot decrypt is not "no key": no request can be authorized, so
    // routing must not choose this provider and the hub must say why.
    if (keyUnreadable) return 'error';
    if (p.status === 'connected') return p.status;
    if (p.status === 'error') {
      if (this.isFreshError(p)) return 'error';
      return hasKey ? 'unknown' : 'not_configured';
    }
    if (p.type === 'ollama') return 'local';
    if (!p.requiresApiKey && p.type === 'custom') return 'unknown';
    return hasKey ? 'unknown' : 'not_configured';
  }

  /**
   * Whether a stored test failure is still worth acting on. The agent loop and
   * the provider hub must agree on this: reading the raw `status` field made the
   * agent warn about a failure the UI had already aged out.
   */
  isFreshError(p: Pick<ProviderConfig, 'status' | 'lastTestedAt' | 'keyUnreadable'>): boolean {
    // An unreadable key has no expiry: it stays wrong until the user acts.
    if (p.keyUnreadable) return true;
    return p.status === 'error' && Date.now() - (p.lastTestedAt ?? 0) < AppDataStore.ERROR_TTL_MS;
  }

  /**
   * `clearKeys` is how a caller says "delete this key"; passing an empty `apiKey`
   * does *not* mean that, because an empty key is also what a provider arrives
   * with when its key could not be decrypted on the read that produced it.
   */
  saveProviders(providers: ProviderConfig[], options: { clearKeys?: string[] } = {}): void {
    const onDisk = new Map(
      (readJson<ProviderConfig[]>(this.providersFile, []) || []).map((p) => [p.id, p.apiKey ?? ''])
    );

    // Accept both encrypted values coming back from storage and plaintext keys
    // typed by the user in the renderer; never persist plaintext.
    const toSave = providers.map((p) => {
      let apiKey = p.apiKey ?? '';
      if (!apiKey && !options.clearKeys?.includes(p.id)) {
        // Keep the ciphertext we already have. Writing the empty value back
        // would destroy a key the user pasted — the read that produced it may
        // simply have been unable to decrypt yet (see `getProviders`).
        apiKey = onDisk.get(p.id) ?? '';
      }
      if (apiKey && !apiKey.startsWith('dpapi:') && !apiKey.startsWith('aes:')) {
        apiKey = keyStorage.encrypt(apiKey);
      }
      // Derived/sanitized fields are recomputed on read; don't persist them.
      const { hasApiKey: _hasApiKey, apiKeyPreview: _apiKeyPreview, keyUnreadable: _keyUnreadable, ...rest } = p;
      return { ...rest, apiKey } as ProviderConfig;
    });
    writeJson(this.providersFile, toSave);
    // Never leave a read served from a cache the write has just disproved.
    this.providersCache = null;

    // A provider that is present again (re-added from the catalog) is no longer removed.
    const removed = this.getSettings().removedProviderIds ?? [];
    const stillRemoved = removed.filter((id) => !toSave.some((p) => p.id === id));
    if (stillRemoved.length !== removed.length) this.saveSettings({ removedProviderIds: stillRemoved });
  }

  /**
   * Store (or clear) a single provider key without the renderer ever having to
   * handle the plaintext of other providers.
   */
  setProviderKey(providerId: string, apiKey: string | null): ProviderConfig[] {
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === providerId);
    if (target) {
      target.apiKey = apiKey ?? '';
      target.status = apiKey ? 'unknown' : target.type === 'ollama' ? 'local' : 'not_configured';
      target.lastError = undefined;
      target.keyUnreadable = false;
    }
    // Explicit intent: `null` means "forget this key", not "I did not touch it".
    this.saveProviders(providers, { clearKeys: apiKey ? [] : [providerId] });
    return this.getSanitizedProviders();
  }

  updateProviderMeta(
    providerId: string,
    meta: Partial<Pick<ProviderConfig, 'status' | 'lastTestedAt' | 'lastError' | 'latencyMs' | 'modelCount'>>
  ): void {
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === providerId);
    if (!target) return;
    Object.assign(target, meta);
    this.saveProviders(providers);
  }

  deleteProvider(providerId: string): ProviderConfig[] {
    const providers = this.getProviders().filter((p) => p.id !== providerId);
    this.saveProviders(providers);

    // Remember the removal, otherwise the shipped preset list re-adds it on the
    // next read (`mergeWithPresets`) and the provider never really goes away.
    const settings = this.getSettings();
    if (!(settings.removedProviderIds ?? []).includes(providerId)) {
      this.saveSettings({ removedProviderIds: [...(settings.removedProviderIds ?? []), providerId] });
    }
    return this.getSanitizedProviders();
  }

  upsertProviderModels(providerId: string, models: ProviderConfig['models'], replace = false): ProviderConfig[] {
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === providerId);
    if (target) {
      if (replace) {
        const manual = target.models.filter((m) => m.source === 'manual');
        const manualIds = new Set(manual.map((m) => m.id));
        target.models = [...models.filter((m) => !manualIds.has(m.id)), ...manual];
      } else {
        const existing = new Map(target.models.map((m) => [m.id, m]));
        for (const m of models) {
          const prev = existing.get(m.id);
          // Keep user-tuned pricing/metadata; only fill in what we learned.
          existing.set(m.id, prev ? { ...m, ...prev, source: prev.source ?? m.source } : m);
        }
        target.models = Array.from(existing.values());
      }
    }
    this.saveProviders(providers);
    return this.getSanitizedProviders();
  }

  // ------------------------------------------------------------------ usage

  /**
   * The usage log, oldest first. Treat the result as read-only: it is the cached
   * log itself, not a copy, so the summary that runs after every request does
   * not allocate twenty thousand objects to throw away.
   */
  getUsageRecords(): UsageRecord[] {
    if (this.usageCache) return this.usageCache;

    if (this.sqlite) {
      this.usageCache = this.sqlite.queryUsage(AppDataStore.USAGE_CACHE_LIMIT);
      return this.usageCache;
    }

    const records = readJson<UsageRecord[]>(this.usageFile, []);
    // Normalise records written by earlier versions.
    this.usageCache = (Array.isArray(records) ? records : []).map((r, index) => ({
      ...r,
      id: r.id || `legacy_${index}_${r.timestamp}`,
      sessionId: r.sessionId || 'legacy',
      status: r.status || 'completed'
    }));
    return this.usageCache;
  }

  saveUsage(record: UsageRecord): void {
    if (this.sqlite) {
      this.sqlite.insertUsage(record);
    } else {
      const records = [...this.getUsageRecords(), record];
      // Keep the file bounded; the aggregation views only need recent history.
      writeJson(this.usageFile, records.slice(-AppDataStore.USAGE_CACHE_LIMIT));
    }

    // Appended rather than invalidated: the next thing that happens is a summary
    // over the whole log, and re-reading it to add one row would undo the point
    // of holding it in memory.
    if (this.usageCache) {
      const next = [...this.usageCache, record];
      this.usageCache = next.length > AppDataStore.USAGE_CACHE_LIMIT ? next.slice(-AppDataStore.USAGE_CACHE_LIMIT) : next;
    }
  }

  /**
   * Stores a finished run's report on its request's usage row.
   *
   * The report used to be a card in the conversation. It lives here instead for
   * two reasons: a request's cost and a request's outcome answer the same
   * question, and the transcript is for the work, not for the paperwork after
   * it. Returns false when nothing was recorded for the session — the caller
   * then leaves the report out entirely rather than inventing a row for it.
   */
  saveRunSummary(sessionId: string, summary: string, request: string): boolean {
    if (!sessionId) return false;

    if (this.sqlite) {
      const updated = this.sqlite.attachUsageSummary(sessionId, summary, request);
      // The cached log holds the row that was just changed; dropping it is
      // cheaper than finding and rewriting the one entry in place.
      if (updated) this.usageCache = null;
      return updated;
    }

    const records = this.getUsageRecords();
    for (let index = records.length - 1; index >= 0; index--) {
      if (records[index].sessionId !== sessionId) continue;
      const next = [...records];
      next[index] = { ...next[index], summary, summaryRequest: request };
      writeJson(this.usageFile, next);
      this.usageCache = next;
      return true;
    }
    return false;
  }

  /** Replace the whole usage log (used by "reset usage"). */
  clearUsage(fromTimestamp = 0): void {
    if (this.sqlite) {
      this.sqlite.clearUsage(fromTimestamp);
    } else if (fromTimestamp <= 0) {
      writeJson(this.usageFile, []);
    } else {
      writeJson(this.usageFile, this.getUsageRecords().filter((r) => r.timestamp < fromTimestamp));
    }

    // Dropped rather than adjusted: "reset usage" is rare, and a wrong total
    // afterwards would be worse than one extra read here.
    this.usageCache = null;
  }

  /**
   * Deletes usage rows past the retention window and reports how many went.
   *
   * Usage is the one table with no natural bound — a row per request, for ever —
   * and every summary walks all of it, so an unbounded log makes each request
   * progressively more expensive. The window is longer than any figure the app
   * can display (`USAGE_RETENTION_DAYS`), which makes this deletion invisible
   * except in the log line at startup.
   */
  pruneUsageHistory(retentionDays: number = USAGE_RETENTION_DAYS): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    if (this.sqlite) {
      const removed = this.sqlite.pruneUsage(cutoff);
      if (removed > 0) this.usageCache = null;
      return removed;
    }

    const before = this.getUsageRecords();
    const kept = before.filter((r) => r.timestamp >= cutoff);
    const removed = before.length - kept.length;
    if (removed > 0) {
      writeJson(this.usageFile, kept);
      this.usageCache = kept;
    }
    return removed;
  }

  // ----------------------------------------------------------- tool auditing

  getToolAudit(limit = 200): ToolAuditEntry[] {
    if (this.sqlite) return this.sqlite.queryAudit(limit);
    const entries = readJson<ToolAuditEntry[]>(this.auditFile, []);
    return Array.isArray(entries) ? entries.slice(-limit).reverse() : [];
  }

  appendToolAudit(entry: ToolAuditEntry): void {
    if (this.sqlite) {
      this.sqlite.insertAudit(entry);
      return;
    }
    let entries = readJson<ToolAuditEntry[]>(this.auditFile, []);
    entries.push(entry);
    if (entries.length > 2000) entries = entries.slice(-2000);
    writeJson(this.auditFile, entries);
  }

  // --------------------------------------------------------------- sessions

  getSessions(): SessionSummary[] {
    if (this.sqlite) return this.sqlite.listSessions();
    const sessions = readJson<SessionSummary[]>(this.sessionsFile, []);
    return Array.isArray(sessions) ? sessions.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  }

  upsertSession(session: SessionSummary): SessionSummary {
    if (this.sqlite) {
      this.sqlite.upsertSession(session);
      return session;
    }
    const sessions = this.getSessions();
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) sessions[index] = session;
    else sessions.unshift(session);
    writeJson(this.sessionsFile, sessions.slice(0, 100));
    return session;
  }

  deleteSession(sessionId: string): void {
    if (this.sqlite) this.sqlite.deleteSession(sessionId);
    else
      writeJson(
        this.sessionsFile,
        this.getSessions().filter((s) => s.id !== sessionId)
      );
    const transcript = path.join(this.sessionsDir, `${sessionId}.json`);
    if (fs.existsSync(transcript)) {
      try {
        fs.unlinkSync(transcript);
      } catch (e) {
        console.error('Failed to delete session transcript:', e);
      }
    }
  }

  saveSessionTranscript(sessionId: string, payload: unknown): void {
    writeJson(path.join(this.sessionsDir, `${sessionId}.json`), payload);
  }

  getSessionTranscript<T>(sessionId: string): T | null {
    const file = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(file)) return null;
    return readJson<T | null>(file, null);
  }

  // ---------------------------------------------------------------- mission

  /**
   * Missions are session-scoped (spec §40), so they are stored next to the
   * session list rather than in global settings: switching project or session
   * must not carry one project's constraints into another.
   */
  getMissions(): Record<string, Mission> {
    const missions = readJson<Record<string, Mission>>(this.missionsFile, {});
    return missions && typeof missions === 'object' ? missions : {};
  }

  getMission(sessionId: string): Mission | null {
    return this.getMissions()[sessionId] ?? null;
  }

  saveMission(sessionId: string, mission: Mission | null): Mission | null {
    const missions = this.getMissions();
    if (!mission || !mission.objective.trim()) delete missions[sessionId];
    else missions[sessionId] = mission;
    writeJson(this.missionsFile, missions);
    return mission;
  }

  // ------------------------------------------------- unsaved editor buffers

  /**
   * Unsaved buffers are written on a debounce so a crash cannot lose typing
   * (spec §84). They are keyed by absolute path and capped, because a stale
   * snapshot of a deleted file is worse than no snapshot.
   */
  getBuffers(): BufferSnapshot[] {
    const buffers = readJson<BufferSnapshot[]>(this.buffersFile, []);
    return Array.isArray(buffers) ? buffers.slice(-40) : [];
  }

  saveBuffers(buffers: BufferSnapshot[]): void {
    writeJson(this.buffersFile, (Array.isArray(buffers) ? buffers : []).slice(-40));
  }

  clearBuffers(): void {
    writeJson(this.buffersFile, []);
  }

  // ------------------------------------------------------------ checkpoints

  saveCheckpoint(checkpoint: Checkpoint): void {
    if (this.sqlite) {
      this.sqlite.saveCheckpoint(checkpoint);
      return;
    }
    const file = path.join(this.checkpointsDir, `${checkpoint.id}.json`);
    writeJson(file, checkpoint);
  }

  deleteCheckpoint(id: string): void {
    if (this.sqlite) {
      this.sqlite.deleteCheckpoint(id);
      return;
    }
    const file = path.join(this.checkpointsDir, `${id}.json`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        console.error('Failed to delete checkpoint:', e);
      }
    }
  }

  getCheckpoints(): Checkpoint[] {
    if (this.sqlite) return this.sqlite.listCheckpoints();
    return this.readCheckpointsFromDisk();
  }

  private readCheckpointsFromDisk(): Checkpoint[] {
    try {
      const files = fs.readdirSync(this.checkpointsDir).filter((f) => f.endsWith('.json'));
      return files
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.checkpointsDir, f), 'utf8')) as Checkpoint;
          } catch {
            return null;
          }
        })
        .filter((c): c is Checkpoint => !!c)
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('Failed to list checkpoints:', e);
      return [];
    }
  }

  getCheckpointById(id: string): Checkpoint | null {
    if (this.sqlite) return this.sqlite.getCheckpoint(id);
    const file = path.join(this.checkpointsDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return readJson<Checkpoint | null>(file, null);
  }
}

export const appStore = new AppDataStore();
