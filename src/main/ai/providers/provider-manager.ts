import { IAIProvider } from './provider-interface';
import { OpenAICompatibleProvider } from './openai-adapter';
import { GeminiProvider } from './gemini-adapter';
import { AnthropicProvider } from './anthropic-adapter';
import { ResponsesProvider } from './responses-adapter';
import { appStore } from '../../database/store';
import { ModelInfo, ProviderConfig, ProviderTestResult } from '../../../shared/types';
import { rankCandidates, RouterCandidate, RoutingProfile } from './router';
import { requiresRunningEndpoint } from './provider-usability';

export interface AutoRouteDecision {
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
  /** Human-readable justification surfaced in the agent timeline. */
  reason: string;
}



/**
 * Identity of the configuration an instance was built from.
 *
 * The key is part of it on purpose: an instance holding a stale key is the bug
 * this exists to prevent. `safeStorage` cannot decrypt anything before
 * `app.whenReady()` — it throws, the key reads as empty, and a request goes out
 * with no `Authorization` header at all. Since this module builds its instances
 * at import time, that would otherwise be every provider on every launch.
 */
function instanceSignature(conf: ProviderConfig): string {
  return [conf.type, conf.baseUrl ?? '', conf.modelsPath ?? '', conf.apiKey ?? '', JSON.stringify(conf.headers ?? {})].join('|');
}

export class ProviderManager {
  private instances = new Map<string, IAIProvider>();
  private builtFrom = new Map<string, string>();
  /** Instances injected by tests: handed back untouched, never rebuilt. */
  private injected = new Set<string>();

  /**
   * Instances are built on first use, never in the constructor.
   *
   * This module is imported while the app is starting, and `safeStorage` cannot
   * decrypt a stored key until `app.whenReady()`: eager construction read every
   * key as an empty string and printed `safeStorage cannot be used before app is
   * ready` on each launch. The first lookup after ready is what builds them, and
   * `main/index.ts` also reloads once after ready.
   */
  private loaded = false;

  constructor() {
    // Intentionally empty — see `loaded`.
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.reloadProviders();
  }

  reloadProviders(): void {
    this.loaded = true;
    this.instances.clear();
    this.builtFrom.clear();
    for (const conf of appStore.getProviders()) {
      this.injected.delete(conf.id);
      if (!conf.enabled) continue;
      this.instances.set(conf.id, this.createInstance(conf));
      this.builtFrom.set(conf.id, instanceSignature(conf));
    }
  }

  private createInstance(conf: ProviderConfig): IAIProvider {
    if (conf.type === 'gemini') {
      return new GeminiProvider(conf.apiKey || '', conf.baseUrl || undefined);
    }
    if (conf.type === 'anthropic') {
      return new AnthropicProvider(conf.apiKey || '', conf.baseUrl || undefined);
    }
    if (conf.type === 'responses') {
      return new ResponsesProvider({
        id: conf.id,
        name: conf.name,
        baseUrl: conf.baseUrl || 'https://api.openai.com/v1',
        apiKey: conf.apiKey || '',
        modelsPath: conf.modelsPath,
        extraHeaders: conf.headers
      });
    }
    return new OpenAICompatibleProvider({
      id: conf.id,
      name: conf.name,
      baseUrl: conf.baseUrl || 'https://api.openai.com/v1',
      apiKey: conf.apiKey || '',
      isLocal: conf.type === 'ollama',
      extraHeaders: conf.headers,
      modelsPath: conf.modelsPath
    });
  }

  getProvider(providerId: string): IAIProvider | undefined {
    // Injected instances (tests) come first: `ensureLoaded` rebuilds from stored
    // configuration and would otherwise discard them.
    if (this.injected.has(providerId)) return this.instances.get(providerId);
    this.ensureLoaded();

    const conf = appStore.getProviders().find((p) => p.id === providerId && p.enabled);
    if (!conf) {
      // Disabled or deleted since the last reload.
      this.instances.delete(providerId);
      this.builtFrom.delete(providerId);
      return undefined;
    }

    // Rebuild whenever the stored configuration no longer matches the instance
    // in hand: a key typed while the app runs, an edited base URL, or — the case
    // that made a configured provider look unconfigured — an instance built
    // before the app was ready, when no stored key could be decrypted yet.
    const signature = instanceSignature(conf);
    if (this.instances.has(providerId) && this.builtFrom.get(providerId) === signature) {
      return this.instances.get(providerId);
    }

    const instance = this.createInstance(conf);
    this.instances.set(providerId, instance);
    this.builtFrom.set(providerId, signature);
    return instance;
  }

  getConfig(providerId: string): ProviderConfig | undefined {
    return appStore.getProviders().find((p) => p.id === providerId);
  }

  /**
   * Inject an in-memory provider instance, bypassing the config file.
   * Used by tests to exercise the agent loop against a scripted adapter; the
   * real flow still goes through `getProvider`/`getConfig`. Call
   * `forgetInstance()` to undo it.
   */
  setProviderInstance(providerId: string, instance: IAIProvider): void {
    this.instances.set(providerId, instance);
    this.injected.add(providerId);
  }

  forgetInstance(providerId: string): void {
    this.instances.delete(providerId);
    this.builtFrom.delete(providerId);
    this.injected.delete(providerId);
  }

  /**
   * Providers a request could actually be sent to right now.
   *
   * A keyless local server (Ollama, LM Studio) is only usable once it has been
   * seen running: `localhost:11434` is closed on most machines, and routing to it
   * blindly costs the user a retry backoff before every fallback.
   */
  getUsableProviders(): ProviderConfig[] {
    return appStore.getProviders().filter((p) => {
      if (!p.enabled || p.models.length === 0) return false;
      // The last probe failed — do not spend a request finding that out again.
      if (p.status === 'error') return false;
      // A keyless endpoint on this machine (Ollama, LM Studio) is a shipped
      // guess that is usually not running, so it must answer once first. The
      // check is on the URL, not the provider type: LM Studio is seeded as an
      // OpenAI-compatible local server and slipped past the old type test.
      if (requiresRunningEndpoint(p)) return p.status === 'connected';
      return !p.requiresApiKey || !!p.apiKey;
    });
  }

  async testConnection(
    providerId: string,
    apiKey?: string,
    baseUrl?: string,
    model?: string
  ): Promise<ProviderTestResult> {
    const conf = appStore.getProviders().find((c) => c.id === providerId);
    if (!conf) return { success: false, error: 'Provider not found', errorKind: 'unknown' };

    // A key typed in the form wins; otherwise use the stored key server-side.
    const key = apiKey && apiKey.trim() ? apiKey.trim() : conf.apiKey || '';
    const url = baseUrl || conf.baseUrl || '';

    if (conf.requiresApiKey !== false && !key) {
      const result: ProviderTestResult = {
        success: false,
        error: 'No API key configured',
        errorKind: 'invalid_key'
      };
      appStore.updateProviderMeta(providerId, {
        status: 'not_configured',
        lastTestedAt: Date.now(),
        lastError: result.error
      });
      return result;
    }

    let probe: IAIProvider;
    if (conf.type === 'gemini') probe = new GeminiProvider(key, url || undefined);
    else if (conf.type === 'anthropic') probe = new AnthropicProvider(key, url || undefined);
    else if (conf.type === 'responses')
      probe = new ResponsesProvider({
        id: conf.id,
        name: conf.name,
        baseUrl: url || 'https://api.openai.com/v1',
        apiKey: key,
        modelsPath: conf.modelsPath,
        extraHeaders: conf.headers
      });
    else
      probe = new OpenAICompatibleProvider({
        id: conf.id,
        name: conf.name,
        baseUrl: url || 'https://api.openai.com/v1',
        apiKey: key,
        isLocal: conf.type === 'ollama',
        extraHeaders: conf.headers,
        modelsPath: conf.modelsPath
      });

    const result = await probe.testConnection(key, url, model || conf.models[0]?.id);
    appStore.updateProviderMeta(providerId, {
      status: result.success ? 'connected' : result.errorKind === 'unavailable' && conf.type === 'ollama' ? 'error' : 'error',
      lastTestedAt: Date.now(),
      lastError: result.success ? undefined : result.error,
      latencyMs: result.latencyMs,
      modelCount: result.modelCount
    });
    return result;
  }

  /**
   * Ask the provider what it serves without storing the answer.
   *
   * The catalogue check previews before it applies, so it must be able to look
   * without writing: a check that has already changed the provider list cannot
   * be declined. `refreshModels` below is the apply half of the same call.
   */
  async discoverModels(providerId: string): Promise<{ success: boolean; models?: ModelInfo[]; error?: string }> {
    const conf = appStore.getProviders().find((c) => c.id === providerId);
    if (!conf) return { success: false, error: 'Provider not found' };

    try {
      const instance = this.getProvider(providerId) ?? this.createInstance(conf);
      return { success: true, models: await instance.listModels() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to fetch models' };
    }
  }

  /**
   * Discover live models from the provider API and store them (spec §26).
   *
   * Applies immediately, so it keeps the previous value wherever the user may
   * have tuned one. The scheduled catalogue check is the reviewed path and uses
   * `diffAndMergeModels` instead — see `catalog-refresh.ts` for why they differ.
   */
  async refreshModels(providerId: string): Promise<{ success: boolean; models?: ModelInfo[]; error?: string }> {
    const conf = appStore.getProviders().find((c) => c.id === providerId);
    if (!conf) return { success: false, error: 'Provider not found' };

    const instance = this.getProvider(providerId) ?? this.createInstance(conf);

    try {
      const models = await instance.listModels();
      const existing = new Map(conf.models.map((m) => [m.id, m]));
      const merged = models.map((m) => {
        const prev = existing.get(m.id);
        if (!prev) return m;
        // Preserve user-tuned metadata and fill any gaps from discovery.
        return {
          ...m,
          name: prev.name || m.name,
          contextWindow: prev.contextWindow ?? m.contextWindow,
          maxOutputTokens: prev.maxOutputTokens ?? m.maxOutputTokens,
          inputPricePerMillion: prev.inputPricePerMillion ?? m.inputPricePerMillion,
          outputPricePerMillion: prev.outputPricePerMillion ?? m.outputPricePerMillion,
          cachedInputPricePerMillion: prev.cachedInputPricePerMillion ?? m.cachedInputPricePerMillion,
          supportsTools: prev.supportsTools,
          supportsVision: prev.supportsVision,
          supportsReasoning: prev.supportsReasoning,
          supportsCaching: prev.supportsCaching ?? m.supportsCaching,
          source: prev.source ?? 'fetched'
        } as ModelInfo;
      });
      appStore.upsertProviderModels(providerId, merged, true);

      // What the provider listed is not the whole list: hand-added models survive
      // the refresh, so report the count the user will actually see in the hub.
      const storedModels = appStore.getProviders().find((p) => p.id === providerId)?.models ?? merged;
      appStore.updateProviderMeta(providerId, {
        status: 'connected',
        lastTestedAt: Date.now(),
        lastError: undefined,
        modelCount: storedModels.length
      });
      return { success: true, models: storedModels };
    } catch (e: any) {
      const error = e?.message || 'Failed to fetch models';
      appStore.updateProviderMeta(providerId, { status: 'error', lastError: error, lastTestedAt: Date.now() });
      return { success: false, error };
    }
  }

  /**
   * Pick the best model for a profile (spec §33). Scores every usable model on
   * capability, price and context so the choice is explainable to the user.
   */
  resolveAutoModel(profile: RoutingProfile, requiresTools = true): AutoRouteDecision {
    const candidates: RouterCandidate[] = [];

    for (const provider of this.getUsableProviders()) {
      for (const model of provider.models) {
        candidates.push({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
          model
        });
      }
    }

    const ranked = rankCandidates(candidates, profile, requiresTools);

    if (ranked.length === 0) {
      const fallback = appStore.getProviders().find((p) => p.enabled) ?? appStore.getProviders()[0];
      return {
        providerId: fallback?.id ?? 'deepseek',
        modelId: fallback?.models[0]?.id ?? 'deepseek-chat',
        providerName: fallback?.name ?? 'DeepSeek',
        modelName: fallback?.models[0]?.name ?? 'DeepSeek V3',
        reason: 'No usable provider configured — falling back to the default preset.'
      };
    }

    const best = ranked[0];
    return {
      providerId: best.candidate.providerId,
      modelId: best.candidate.model.id,
      providerName: best.candidate.providerName,
      modelName: best.candidate.model.name,
      reason: best.reason
    };
  }
}

export const providerManager = new ProviderManager();
