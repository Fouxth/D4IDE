import fs from 'fs';
import path from 'path';
import {
  CatalogDiff,
  CatalogStatus,
  ModelChange,
  ModelInfo,
  ProviderCatalogChange,
  ProviderConfig
} from '../../../shared/types';
import { clampToGoPlan } from '../../../shared/opencode-go-plan';
import { isLocalRuntime } from '../../../shared/provider-vendors';
import { appStore } from '../../database/store';
import { logService } from '../../logging/log-service';
import { IPC_CHANNELS } from '../../../shared/ipc-events';
import { decideNextCheck } from '../../updater/update-schedule';
import { providerManager } from './provider-manager';

/**
 * Keeping the model catalogue current without re-installing D4IDE.
 *
 * The problem this solves: a provider adds a model every few weeks, and until now
 * the only way to see it was to install a new build. The fix is to ask each
 * provider what it serves — over the same `/models` endpoint the "fetch models"
 * button already uses — and show the difference.
 *
 * The rule, identical to the application updater: **look, never apply.** A check
 * writes nothing to the provider list. It stages what it found, reports what
 * would change, and waits for a click. Three guarantees make that safe:
 *
 *   - models the user typed themselves (`source: 'manual'`) are never touched;
 *   - a model the provider stopped listing is kept, not deleted — a retired model
 *     still works, and silently removing one would break a pinned selection;
 *   - the preview and the apply are the *same* function, so what was shown is
 *     what happens, and a snapshot is kept so it can be undone.
 *
 * Why each provider's own endpoint rather than the models.dev registry the build
 * uses: the registry covers every provider it knows about, so a scheduled job
 * would download a large document daily, and reading it correctly at runtime
 * would mean duplicating the curation table that lives in the build script. The
 * provider's own answer is smaller, authoritative for that provider, and needs no
 * second source of truth. It does not carry a price for providers that do not
 * publish one, which is why the summary says "no price reported" rather than
 * inventing a number.
 */

/** The fields a discovery is allowed to speak about. */
const FACT_FIELDS = [
  'name',
  'contextWindow',
  'maxOutputTokens',
  'inputPricePerMillion',
  'outputPricePerMillion',
  'cachedInputPricePerMillion',
  'supportsTools',
  'supportsVision',
  'supportsReasoning',
  'supportsCaching'
] as const;

export interface DiffAndMerge {
  merged: ModelInfo[];
  added: ModelChange[];
  changed: ModelChange[];
  missingUpstream: string[];
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  return false;
}

/**
 * One function for both "show me" and "do it".
 *
 * Preview and apply diverging is the classic way an update UI lies, so there is
 * only one implementation: the diff is the by-product of building the merged
 * list, not a second calculation that could disagree with it.
 */
export function diffAndMergeModels(local: ModelInfo[], discovered: ModelInfo[]): DiffAndMerge {
  const byId = new Map(local.map((model) => [model.id, model]));
  const seen = new Set<string>();
  const merged: ModelInfo[] = [];
  const added: ModelChange[] = [];
  const changed: ModelChange[] = [];

  for (const remote of discovered) {
    seen.add(remote.id);
    const previous = byId.get(remote.id);

    if (!previous) {
      // Anything a discovery call returns came from the provider, not from the
      // shipped presets, so it is labelled as fetched however the adapter chose
      // to describe it — 'builtin' is what marks an entry as ours to maintain.
      merged.push({ ...remote, source: 'fetched' });
      added.push({ id: remote.id, name: remote.name || remote.id, fields: ['new'] });
      continue;
    }

    // A model the user typed is theirs: it is carried over untouched even when
    // the provider describes a model with the same id differently.
    if (previous.source === 'manual') {
      merged.push(previous);
      continue;
    }

    // Facts: the provider's answer wins, because this path is only reached after
    // the user has seen exactly which fields change and pressed apply. That is
    // the difference from `providerManager.refreshModels`, where the same button
    // applies immediately and therefore keeps the previous value instead.
    const next: ModelInfo = { ...previous };
    const fields: string[] = [];
    for (const field of FACT_FIELDS) {
      const incoming = remote[field];
      if (incoming === undefined || incoming === null) continue;
      if (sameValue(previous[field], incoming)) continue;
      (next as any)[field] = incoming;
      fields.push(field);
    }
    next.source = previous.source ?? 'fetched';
    merged.push(next);
    if (fields.length > 0) changed.push({ id: previous.id, name: next.name || previous.id, fields });
  }

  // Anything local that the provider did not mention survives, in its old order
  // relative to what was merged. Losing a model the user pinned would be worse
  // than showing a stale one.
  const missingUpstream: string[] = [];
  for (const model of local) {
    if (seen.has(model.id)) continue;
    missingUpstream.push(model.id);
    merged.push(model);
  }

  return { merged, added, changed, missingUpstream };
}

function summarize(
  changes: { providerId: string; providerName: string; result: DiffAndMerge }[],
  failures: { providerId: string; error: string }[],
  checkedAt: number
): CatalogDiff {
  const providers: ProviderCatalogChange[] = changes.map(({ providerId, providerName, result }) => ({
    providerId,
    providerName,
    added: result.added,
    changed: result.changed,
    missingUpstream: result.missingUpstream
  }));

  return {
    checkedAt,
    providers,
    failures,
    totals: {
      providers: providers.filter((p) => p.added.length > 0 || p.changed.length > 0).length,
      added: providers.reduce((total, p) => total + p.added.length, 0),
      changed: providers.reduce((total, p) => total + p.changed.length, 0),
      kept: providers.reduce((total, p) => total + p.missingUpstream.length, 0),
      failed: failures.length
    }
  };
}

interface PendingCatalog {
  checkedAt: number;
  /** What each provider answered, ready to be merged when the user applies it. */
  discovered: { providerId: string; providerName: string; models: ModelInfo[] }[];
  failures: { providerId: string; error: string }[];
}

interface CatalogBackup {
  at: number;
  /** Models only — never the API keys, which must not be written a second time. */
  providers: { id: string; models: ModelInfo[] }[];
}

export class CatalogRefreshService {
  private status: CatalogStatus = { state: 'idle', undoAvailable: false };
  private busy = false;
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private guarded = false;
  private getWindow: () => { webContents: { send: (channel: string, payload: unknown) => void }; isDestroyed: () => boolean } | null =
    () => null;

  setWindowProvider(provider: () => any): void {
    this.getWindow = provider;
  }

  getStatus(): CatalogStatus {
    return { ...this.status, undoAvailable: this.hasBackup() };
  }

  setAgentBusy(busy: boolean): void {
    const was = this.guarded;
    this.guarded = busy;
    if (was && !busy) this.schedule('agent-idle');
  }

  private pendingFile(): string {
    return path.join(appStore.getDataDir(), 'catalog-pending.json');
  }

  private backupFile(): string {
    return path.join(appStore.getDataDir(), 'catalog-backup.json');
  }

  private readJson<T>(file: string): T | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private writeJson(file: string, value: unknown): void {
    try {
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (error) {
      logService.warn('provider', 'Catalogue file could not be written', { file, error: String(error) });
    }
  }

  private hasBackup(): boolean {
    return this.readJson<CatalogBackup>(this.backupFile()) !== null;
  }

  private publish(patch: Partial<CatalogStatus>): void {
    this.status = { ...this.status, ...patch };
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.CATALOG_STATUS, this.getStatus());
    }
    if (patch.state) this.schedule('state');
  }

  // ------------------------------------------------------------------ schedule

  start(): void {
    if (this.started) return;
    this.started = true;
    const pending = this.readJson<PendingCatalog>(this.pendingFile());
    if (pending) {
      // A check that finished while the app was closing is still worth showing.
      const diff = this.diffAgainstCurrent(pending);
      this.status = { ...this.status, state: 'changes', diff, checkedAt: pending.checkedAt };
    }
    this.schedule('startup');
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reconfigure(): void {
    if (this.started) this.schedule('settings');
  }

  private schedule(reason: string): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.started) return;

    const settings = appStore.getSettings();
    const decision = decideNextCheck(
      {
        enabled: settings.catalogCheckEnabled,
        // A fresh install should learn about new models in its first minute
        // rather than after a day; the delay keeps it off the launch path.
        checkOnLaunch: true,
        intervalHours: settings.catalogCheckIntervalHours,
        lastCheckedAt: settings.lastCatalogCheckAt || 0,
        // Staged changes park the schedule exactly like a found update does:
        // there is no point looking again while a decision is waiting.
        state: this.status.state === 'changes' ? 'available' : 'idle',
        agentBusy: this.guarded,
        checkInProgress: this.busy
      },
      Date.now()
    );

    if (decision.delayMs === null) {
      logService.info('provider', 'Catalogue checks parked', { reason: decision.reason, trigger: reason });
      return;
    }

    const delayMs = decision.delayMs;
    const isCheck = decision.action === 'check';
    this.timer = setTimeout(() => {
      this.timer = null;
      if (isCheck) void this.check('interval');
      else this.schedule(decision.reason);
    }, delayMs);
    this.timer.unref?.();
  }

  // --------------------------------------------------------------------- check

  /**
   * Providers worth asking: enabled, not removed by the user, and reachable.
   *
   * Local runtimes are asked only when the user turned them on (or is talking to
   * one right now). With the setting off, a check spent its whole round trip on
   * Ollama and LM Studio — endpoints that answer "nothing here" on most machines
   * — and reported no changes for the accounts the user actually pays for.
   */
  private candidates(): ProviderConfig[] {
    const settings = appStore.getSettings();
    return appStore
      .getProviders()
      .filter((provider) => provider.enabled)
      .filter((provider) => !settings.removedProviderIds.includes(provider.id))
      .filter(
        (provider) =>
          settings.localProvidersEnabled ||
          provider.id === settings.activeProviderId ||
          !isLocalRuntime(provider)
      )
      .filter((provider) => provider.requiresApiKey === false || provider.apiKey);
  }

  private diffAgainstCurrent(pending: PendingCatalog): CatalogDiff {
    const providers = appStore.getProviders();
    const changes = pending.discovered.map((entry) => {
      const local = providers.find((p) => p.id === entry.providerId)?.models ?? [];
      return {
        providerId: entry.providerId,
        providerName: entry.providerName,
        result: diffAndMergeModels(local, entry.models)
      };
    });
    return summarize(changes, pending.failures, pending.checkedAt);
  }

  /**
   * Ask every configured provider what it serves, and stage the answer. Writes
   * nothing to the provider list: the only file touched is the pending one.
   */
  async check(origin: 'launch' | 'interval' | 'manual' = 'manual'): Promise<CatalogStatus> {
    if (this.busy) return this.getStatus();
    this.busy = true;
    this.publish({ state: 'checking', error: undefined });

    try {
      const candidates = this.candidates();
      const discovered: PendingCatalog['discovered'] = [];
      const failures: PendingCatalog['failures'] = [];

      for (const provider of candidates) {
        const result = await providerManager.discoverModels(provider.id);
        if (result.success && result.models) {
          // Same clamp the apply path uses, so the preview cannot promise a Go
          // model the subscription does not serve.
          const models = clampToGoPlan(provider.id, result.models);
          discovered.push({ providerId: provider.id, providerName: provider.name, models });
        } else {
          failures.push({ providerId: provider.id, error: result.error || 'No answer' });
        }
      }

      const pending: PendingCatalog = { checkedAt: Date.now(), discovered, failures };
      this.writeJson(this.pendingFile(), pending);
      appStore.saveSettings({ lastCatalogCheckAt: pending.checkedAt });

      const diff = this.diffAgainstCurrent(pending);
      const hasChanges = diff.totals.added > 0 || diff.totals.changed > 0;
      logService.info('provider', 'Catalogue check finished', {
        origin,
        asked: candidates.length,
        added: diff.totals.added,
        changed: diff.totals.changed,
        failed: failures.length
      });
      this.publish({ state: hasChanges ? 'changes' : 'idle', diff, checkedAt: pending.checkedAt });
      return this.getStatus();
    } catch (error) {
      logService.warn('provider', 'Catalogue check failed', { error: (error as Error).message });
      this.publish({ state: 'error', error: (error as Error).message, checkedAt: Date.now() });
      return this.getStatus();
    } finally {
      this.busy = false;
    }
  }

  // --------------------------------------------------------------------- apply

  /** Write the staged changes, keeping a snapshot so it can be undone. */
  apply(): CatalogStatus {
    const pending = this.readJson<PendingCatalog>(this.pendingFile());
    if (!pending) {
      this.publish({ state: 'idle', error: 'Nothing staged to apply.' });
      return this.getStatus();
    }

    const providers = appStore.getProviders();
    const backup: CatalogBackup = {
      at: Date.now(),
      providers: providers
        .filter((provider) => pending.discovered.some((entry) => entry.providerId === provider.id))
        // Keys deliberately dropped: a second copy of a credential on disk is a
        // new thing to leak, and the live list already holds the only one needed.
        .map((provider) => ({ id: provider.id, models: provider.models }))
    };

    let touched = 0;
    const next = providers.map((provider) => {
      const entry = pending.discovered.find((d) => d.providerId === provider.id);
      if (!entry) return provider;
      const { merged } = diffAndMergeModels(provider.models, entry.models);
      touched += 1;
      return { ...provider, models: merged, modelCount: merged.length };
    });

    this.writeJson(this.backupFile(), backup);
    appStore.saveProviders(next);
    providerManager.reloadProviders();
    fs.rmSync(this.pendingFile(), { force: true });

    logService.info('provider', 'Catalogue applied', { providers: touched });
    // The window re-reads providers itself; the status here is only about this
    // screen's state, so it does not need to carry the provider list.
    this.publish({ state: 'idle', diff: undefined, checkedAt: Date.now() });
    return this.getStatus();
  }

  /** Put back exactly the models that the last apply replaced. */
  undo(): CatalogStatus {
    const backup = this.readJson<CatalogBackup>(this.backupFile());
    if (!backup) {
      this.publish({ state: 'idle', error: 'There is nothing to undo.' });
      return this.getStatus();
    }

    const providers = appStore.getProviders().map((provider) => {
      const entry = backup.providers.find((item) => item.id === provider.id);
      return entry ? { ...provider, models: entry.models, modelCount: entry.models.length } : provider;
    });
    appStore.saveProviders(providers);
    providerManager.reloadProviders();
    fs.rmSync(this.backupFile(), { force: true });

    logService.info('provider', 'Catalogue apply undone', { providers: backup.providers.length });
    this.publish({ state: 'idle', diff: undefined });
    return this.getStatus();
  }

  /** "Not this time": drop what was staged without touching the provider list. */
  discard(): CatalogStatus {
    fs.rmSync(this.pendingFile(), { force: true });
    this.publish({ state: 'idle', diff: undefined });
    return this.getStatus();
  }
}

export const catalogRefreshService = new CatalogRefreshService();
