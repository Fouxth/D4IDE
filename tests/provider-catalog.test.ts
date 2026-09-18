import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, buildDefaultProviders, getPreset, getPresetIds } from '../src/main/ai/providers/catalog';
import { PROVIDER_PRESETS as SHARED_PRESETS } from '../src/shared/provider-presets';

/**
 * Catalog guard rails.
 *
 * A preset is the only provider configuration a user never types, so a mistake
 * here ships to everyone: a trailing slash breaks URL joining, a wrong type
 * sends the request to the wrong endpoint, and a model id that does not exist
 * upstream produces a confusing 404 deep inside a run.
 */

describe('provider presets', () => {
  it('is the single list both the main process and the renderer read', () => {
    // The renderer's "Add provider" dialog used to keep its own copy, which is
    // how a provider ends up seeded on startup but unofferable in the UI.
    expect(SHARED_PRESETS).toBe(PROVIDER_PRESETS);
  });

  it('has unique ids and matching built-in providers', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);

    const built = buildDefaultProviders();
    expect(built.map((p) => p.id)).toEqual(ids);
    expect(built.every((p) => p.isBuiltIn)).toBe(true);
    expect(getPresetIds()).toEqual(ids);
  });

  it('uses a clean https base URL for every remote provider', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.baseUrl, preset.id).toMatch(/^https?:\/\//);
      // No trailing slash: adapters join with `${baseUrl}/chat/completions`.
      expect(preset.baseUrl.endsWith('/'), preset.id).toBe(false);
      if (!preset.isLocal) expect(preset.baseUrl.startsWith('https://'), preset.id).toBe(true);
    }
  });

  it('asks for a key everywhere except local runtimes', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.isLocal) expect(preset.requiresApiKey, preset.id).toBe(false);
      else expect(preset.requiresApiKey, preset.id).toBe(true);
    }
  });

  it('describes every model with finite, non-negative prices', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.models.length, preset.id).toBeGreaterThan(0);
      const modelIds = preset.models.map((model) => model.id);
      expect(new Set(modelIds).size, preset.id).toBe(modelIds.length);

      for (const model of preset.models) {
        expect(model.id, preset.id).toBeTruthy();
        expect(model.name, model.id).toBeTruthy();
        expect(typeof model.supportsTools, model.id).toBe('boolean');
        expect(typeof model.supportsVision, model.id).toBe('boolean');
        expect(model.source, model.id).toBe('builtin');

        for (const price of [
          model.inputPricePerMillion,
          model.outputPricePerMillion,
          model.cachedInputPricePerMillion
        ]) {
          if (price === undefined) continue;
          expect(Number.isFinite(price), `${preset.id}/${model.id}`).toBe(true);
          expect(price, `${preset.id}/${model.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('maps each provider type to the endpoint family its adapter speaks', () => {
    const anthropic = getPreset('anthropic');
    const openai = getPreset('openai');
    expect(anthropic!.type).toBe('anthropic'); // POST {baseUrl}/messages
    expect(openai!.type).toBe('openai'); // POST {baseUrl}/chat/completions
  });

  it('offers every provider through an adapter D4IDE actually has', () => {
    // 'custom', 'openai', 'deepseek', 'openrouter', 'xai' and 'ollama' all route
    // to the OpenAI-compatible adapter; the other three have their own. A preset
    // whose type falls outside this set would have no way to make a request.
    const supported = new Set([
      'openai',
      'anthropic',
      'gemini',
      'responses',
      'deepseek',
      'openrouter',
      'xai',
      'ollama',
      'custom'
    ]);
    for (const preset of PROVIDER_PRESETS) {
      expect(supported.has(preset.type), `${preset.id} → ${preset.type}`).toBe(true);
    }
  });

  it('ships a broad catalogue rather than a handful of brands', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(40);
    expect(PROVIDER_PRESETS.reduce((total, preset) => total + preset.models.length, 0)).toBeGreaterThan(150);

    // A few providers that must be present: frontier labs, fast inference, the
    // regional vendors, the gateways people already pay for, and local runtimes.
    for (const id of [
      'openai',
      'anthropic',
      'gemini',
      'deepseek',
      'xai',
      'mistral',
      'groq',
      'cerebras',
      'together',
      'openrouter',
      'alibaba',
      'moonshot',
      'zai',
      'minimax',
      'github-copilot',
      'ollama',
      'lmstudio'
    ]) {
      expect(getPreset(id), id).toBeDefined();
    }
  });

  it('declares a model path only where it is not the default one', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.modelsPath === undefined) continue;
      expect(preset.modelsPath.startsWith('/'), preset.id).toBe(true);
    }
    // Perplexity really does differ: chat at the root, catalogue under /v1.
    expect(getPreset('perplexity')!.modelsPath).toBe('/v1/models');
  });

  it('records what each model can actually do', () => {
    for (const preset of PROVIDER_PRESETS) {
      for (const model of preset.models) {
        expect(model.id, preset.id).toBeTruthy();
        expect(typeof model.supportsTools, `${preset.id}/${model.id}`).toBe('boolean');
        if (model.contextWindow !== undefined) {
          expect(model.contextWindow, `${preset.id}/${model.id}`).toBeGreaterThan(0);
        }
        if (model.inputPricePerMillion !== undefined) {
          expect(model.inputPricePerMillion, `${preset.id}/${model.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

/**
 * OpenCode's gateways are not one protocol each.
 *
 * The same key reaches four endpoint families on Zen and three on Go, and a
 * model sent to the wrong one fails immediately — chat-only models answer 500
 * on `/messages`, and `grok-4.6` answers 401 "not supported for format
 * oa-compat" on chat-completions (all observed against the live gateway). The
 * presets therefore mirror the vendor's endpoint table one model at a time, and
 * these tests pin that split so a future edit cannot quietly undo it.
 */
describe('OpenCode presets', () => {
  const zen = getPreset('opencode-zen');
  const zenMessages = getPreset('opencode-zen-messages');
  const zenResponses = getPreset('opencode-zen-responses');
  const zenGemini = getPreset('opencode-zen-gemini');
  const go = getPreset('opencode-go');
  const goMessages = getPreset('opencode-go-messages');
  const goResponses = getPreset('opencode-go-responses');

  const idsOf = (preset: typeof zen) => (preset?.models ?? []).map((model) => model.id);

  it('names each preset distinguishably', () => {
    // One brand, several presets: identical names would make the Provider Hub
    // (and providers.json) impossible to tell apart.
    const family = [zen, zenMessages, zenResponses, zenGemini, go, goMessages, goResponses].map((p) => p!.name);
    expect(new Set(family).size).toBe(family.length);
    for (const name of family) expect(name).toMatch(/^OpenCode (Zen|Go)/);
  });

  it('ships one preset per protocol, each on the documented base URL', () => {
    for (const preset of [zen, zenMessages, zenResponses, zenGemini]) {
      expect(preset, 'zen family').toBeDefined();
      expect(preset!.baseUrl).toBe('https://opencode.ai/zen/v1');
      expect(preset!.docsUrl).toBe('https://opencode.ai/docs/zen/');
    }
    expect([zen!.type, zenMessages!.type, zenResponses!.type, zenGemini!.type]).toEqual([
      'openai',
      'anthropic',
      'responses',
      'gemini'
    ]);

    for (const preset of [go, goMessages, goResponses]) {
      expect(preset, 'go family').toBeDefined();
      expect(preset!.baseUrl).toBe('https://opencode.ai/zen/go/v1');
      expect(preset!.docsUrl).toBe('https://opencode.ai/docs/go/');
      expect(preset!.requiresApiKey).toBe(true);
    }
    expect([go!.type, goMessages!.type, goResponses!.type]).toEqual(['openai', 'anthropic', 'responses']);
  });

  it('lists every model exactly once across a gateway\'s presets', () => {
    // A model in two presets is a model whose calls depend on which card the user
    // happened to pick — and one of those answers will be a format error.
    const zenIds = [zen, zenMessages, zenResponses, zenGemini].flatMap(idsOf);
    expect(new Set(zenIds).size).toBe(zenIds.length);
    const goIds = [go, goMessages, goResponses].flatMap(idsOf);
    expect(new Set(goIds).size).toBe(goIds.length);
  });

  it('keeps Zen responses-only families out of the chat preset', () => {
    for (const model of zen!.models) {
      expect(model.id, model.id).not.toMatch(/^(gpt-|grok-|muse-spark)/);
      // Qwen Max/Plus answer on /messages, not chat-completions.
      expect(model.id, model.id).not.toMatch(/^qwen/);
    }
    expect(zenResponses!.models.some((m) => m.id === 'gpt-5.6-luna')).toBe(true);
    expect(zenResponses!.models.some((m) => m.id === 'grok-4.6')).toBe(true);
  });

  it('puts every Go model on the protocol the gateway serves it on', () => {
    const goChat = idsOf(go);
    // Documented as /messages: sending these to chat-completions returns 500.
    for (const id of ['minimax-m3', 'minimax-m2.7', 'qwen3.8-max', 'qwen3.7-max', 'union-alpha']) {
      expect(goChat, id).not.toContain(id);
      expect(idsOf(goMessages), id).toContain(id);
    }
    // Documented as /responses: 401 "not supported for format oa-compat" on chat.
    for (const id of ['grok-4.6', 'gpt-5.6-luna']) {
      expect(goChat, id).not.toContain(id);
      expect(idsOf(goResponses), id).toContain(id);
    }
    for (const id of ['glm-5.3', 'kimi-k3', 'deepseek-v4-pro', 'longcat-2.0']) {
      expect(goChat, id).toContain(id);
    }
  });

  it('leaves out models the gateway refuses to serve', () => {
    // Each of these answered "Model is unavailable" (or is past its published
    // deprecation date) when called with a working key. Offering them would put a
    // request that cannot succeed in the model picker.
    const refused = [
      'glm-5',
      'kimi-k2.5',
      'qwen3.5-plus',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'hy3-preview',
      'grok-4.5',
      'minimax-m2.5'
    ];
    for (const id of refused) {
      expect(idsOf(go), id).not.toContain(id);
      expect(idsOf(goMessages), id).not.toContain(id);
      expect(idsOf(goResponses), id).not.toContain(id);
    }
  });

  it('keeps Claude and Qwen in the Anthropic-shaped presets', () => {
    for (const model of zenMessages!.models) {
      expect(model.id).toMatch(/^(claude-|qwen|union-alpha)/);
    }
    // Claude and Qwen are billed with a cache read, so caching must be on for
    // them. The stealth model beside them (union-alpha) is free and carries no
    // cache pricing at all.
    const billed = zenMessages!.models.filter((m) => /^(claude-|qwen)/.test(m.id));
    expect(billed.length).toBeGreaterThan(0);
    expect(billed.every((m) => m.supportsCaching), 'caching').toBe(true);
    expect(goMessages!.models.some((m) => m.id === 'qwen3.6-plus')).toBe(true);
  });

  it('marks the free models as free rather than merely unpriced', () => {
    const free = zen!.models.filter((model) => model.id.endsWith('-free') || model.id === 'big-pickle');
    expect(free.length).toBeGreaterThan(0);
    for (const model of free) {
      expect(model.inputPricePerMillion, model.id).toBe(0);
      expect(model.outputPricePerMillion, model.id).toBe(0);
    }
  });

  it('can drive the agent loop from every Go model it ships', () => {
    for (const preset of [go, goMessages, goResponses]) {
      expect(preset!.models.filter((model) => model.supportsTools).length, preset!.id).toBe(preset!.models.length);
    }
  });
});
