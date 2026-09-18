/**
 * Regenerates the shipped provider presets from the model registry.
 *
 *   node scripts/sync-providers.cjs            # downloads the registry
 *   node scripts/sync-providers.cjs --input=<path>   # reuse a saved copy
 *
 * Why a generator instead of a hand-written list: a provider catalogue rots.
 * Model ids get retired, prices change, context windows grow — and every stale
 * entry is a request that fails for a user who never typed anything wrong. The
 * registry (models.dev) is the same source the OpenCode CLI itself uses, so it
 * tracks reality far better than an array someone edited by hand last year.
 *
 * What stays hand-written is *identity*: which providers D4IDE ships, what each
 * one is called, how its URL is spelled for a plain OpenAI-compatible client,
 * and which model ids are worth showing. Everything factual about the models
 * (ids, prices, context windows, capability flags) comes from the registry.
 */
const fs = require('fs');
const path = require('path');

const REGISTRY_URL = 'https://models.dev/api.json';
const OUT_FILE = path.join('src', 'shared', 'provider-presets.generated.ts');

/**
 * `registry` is the models.dev provider id. `baseUrl` is only set when the
 * registry has no `api` field (those providers normally use a vendor SDK with a
 * baked-in URL) or when the value needs adapting for a plain OpenAI client.
 *
 * `modelIds` pins an explicit list — used where one provider id serves several
 * endpoint families and we only want the models that family can actually call.
 *
 */
const CURATED = [
  // ---------------------------------------------------------------- frontier
  { id: 'openai', registry: 'openai', type: 'openai', baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-...' },
  { id: 'anthropic', registry: 'anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-...' },
  { id: 'gemini', registry: 'google', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHint: 'AIza...' },
  { id: 'deepseek', registry: 'deepseek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyHint: 'sk-...' },
  { id: 'xai', registry: 'xai', type: 'openai', baseUrl: 'https://api.x.ai/v1', keyHint: 'xai-...' },
  { id: 'mistral', registry: 'mistral', type: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'cohere', registry: 'cohere', type: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1' },
  // Perplexity serves chat at the root but its model list at /v1/models — the
  // one provider where the two paths disagree (verified with pnpm providers:check).
  { id: 'perplexity', registry: 'perplexity', type: 'openai', baseUrl: 'https://api.perplexity.ai', modelsPath: '/v1/models' },

  // ------------------------------------------------------- fast inference
  { id: 'groq', registry: 'groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyHint: 'gsk_...' },
  { id: 'cerebras', registry: 'cerebras', type: 'openai', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'together', registry: 'togetherai', type: 'openai', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'deepinfra', registry: 'deepinfra', type: 'openai', baseUrl: 'https://api.deepinfra.com/v1/openai' },
  { id: 'fireworks', registry: 'fireworks-ai', type: 'openai' },
  { id: 'novita', registry: 'novita-ai', type: 'openai' },
  { id: 'nebius', registry: 'nebius', type: 'openai' },
  { id: 'baseten', registry: 'baseten', type: 'openai' },
  { id: 'chutes', registry: 'chutes', type: 'openai' },
  { id: 'nvidia', registry: 'nvidia', type: 'openai', keyHint: 'nvapi-...' },
  { id: 'huggingface', registry: 'huggingface', type: 'openai', keyHint: 'hf_...' },
  { id: 'digitalocean', registry: 'digitalocean', type: 'openai' },
  { id: 'siliconflow', registry: 'siliconflow', type: 'openai' },

  // ------------------------------------------------- regional / open weights
  { id: 'alibaba', registry: 'alibaba', type: 'openai', keyHint: 'DASHSCOPE_API_KEY' },
  { id: 'alibaba-cn', registry: 'alibaba-cn', type: 'openai', keyHint: 'DASHSCOPE_API_KEY' },
  { id: 'moonshot', registry: 'moonshotai', type: 'openai' },
  { id: 'moonshot-cn', registry: 'moonshotai-cn', type: 'openai' },
  { id: 'zai', registry: 'zai', type: 'openai' },
  { id: 'minimax', registry: 'minimax', type: 'anthropic' },
  { id: 'modelscope', registry: 'modelscope', type: 'openai' },
  { id: 'longcat', registry: 'longcat', type: 'openai' },

  // ------------------------------------------- subscriptions / coding plans
  { id: 'github-copilot', registry: 'github-copilot', type: 'openai', keyHint: 'GitHub token with Copilot access' },
  { id: 'kimi-for-coding', registry: 'kimi-for-coding', type: 'anthropic', keyHint: 'Kimi coding-plan key' },
  { id: 'zai-coding-plan', registry: 'zai-coding-plan', type: 'openai', keyHint: 'GLM coding-plan key' },
  { id: 'minimax-coding-plan', registry: 'minimax-coding-plan', type: 'anthropic', keyHint: 'MiniMax coding-plan key' },
  { id: 'alibaba-coding-plan', registry: 'alibaba-coding-plan', type: 'openai', keyHint: 'Qwen coding-plan key' },
  { id: 'cline-pass', registry: 'cline-pass', type: 'openai', keyHint: 'Cline API key' },

  // ------------------------------------------------------------- gateways
  { id: 'openrouter', registry: 'openrouter', type: 'openrouter', keyHint: 'sk-or-...' },
  { id: 'kilo', registry: 'kilo', type: 'openai' },
  { id: 'requesty', registry: 'requesty', type: 'openai' },
  { id: 'helicone', registry: 'helicone', type: 'openai' },
  { id: 'llmgateway', registry: 'llmgateway', type: 'openai' },
  { id: 'nano-gpt', registry: 'nano-gpt', type: 'openai' },
  { id: 'edenai', registry: 'edenai', type: 'openai' },
  { id: '302ai', registry: '302ai', type: 'openai' },

  // ---------------------------------------------------------------- local
  { id: 'ollama', registry: null, type: 'ollama', baseUrl: 'http://localhost:11434/v1', requiresApiKey: false, isLocal: true, localModels: ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'llama3.3:8b'] },
  { id: 'lmstudio', registry: 'lmstudio', type: 'openai', isLocal: true, requiresApiKey: false },

  // ------------------------------------------------------------ OpenCode Zen
  //
  // Zen is one key across four endpoint families, so it ships as four presets:
  // every model is listed once, under the protocol it actually answers on. The
  // split is not guesswork — it mirrors the endpoint table in the Zen docs, and
  // every id below is checked against the live catalogue by `--verify`. A model
  // in the wrong preset fails on first use with a format error, which is exactly
  // the failure this split exists to prevent.
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    registry: 'opencode',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    docsUrl: 'https://opencode.ai/docs/zen/',
    keyHint: 'Zen API key — opencode.ai/auth',
    isLocal: false,
    modelIds: [
      // /chat/completions
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'minimax-m3',
      'minimax-m2.7',
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'big-pickle',
      'mimo-v2.5-free',
      'ling-3.0-flash-fin-free',
      'nemotron-3-ultra-free',
      'nemotron-3.5-lightning-free'
    ]
  },
  {
    id: 'opencode-zen-messages',
    // Names are explicit: four presets behind one brand would otherwise be
    // indistinguishable in the Provider Hub and in the config file.
    name: 'OpenCode Zen · Claude & Qwen',
    registry: 'opencode',
    type: 'anthropic',
    baseUrl: 'https://opencode.ai/zen/v1',
    docsUrl: 'https://opencode.ai/docs/zen/',
    keyHint: 'Same Zen API key as above',
    isLocal: false,
    modelIds: [
      // /messages — Anthropic-shaped, the only shape Claude answers on
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      // Qwen3.7 Max/Plus sit in the Zen docs' endpoint table but are absent from
      // Zen's live catalogue (71 models, checked) — they are Go models, and
      // offering them here would be a model that 404s.
      'qwen3.6-plus',
      'qwen3.5-plus',
      'union-alpha'
    ]
  },
  {
    id: 'opencode-zen-responses',
    name: 'OpenCode Zen · GPT & Grok',
    registry: 'opencode',
    type: 'responses',
    baseUrl: 'https://opencode.ai/zen/v1',
    docsUrl: 'https://opencode.ai/docs/zen/',
    keyHint: 'Same Zen API key as above',
    isLocal: false,
    // OpenAI-shaped models are served on `/responses` and nowhere else — they
    // answer 401 "not supported for format oa-compat" on chat-completions.
    // Codex variants are left out: the Zen docs mark them deprecated.
    modelIds: [
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5',
      'gpt-5-nano',
      'grok-4.6',
      'grok-4.5',
      'grok-build-0.1',
      'muse-spark-1.3',
      'muse-spark-1.2',
      'muse-spark-1.3-contributor-free'
    ]
  },
  {
    id: 'opencode-zen-gemini',
    name: 'OpenCode Zen · Gemini',
    registry: 'opencode',
    type: 'gemini',
    baseUrl: 'https://opencode.ai/zen/v1',
    docsUrl: 'https://opencode.ai/docs/zen/',
    keyHint: 'Same Zen API key as above',
    isLocal: false,
    // Zen serves Gemini on Google's own wire shape: {base}/models/{model}:...
    modelIds: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro',
      'gemini-3-flash'
    ]
  },
  // OpenCode Go — the $10/month subscription.
  //
  // Same key, same host family, three protocols: chat-completions for the open
  // weights, `/messages` for MiniMax and the Qwen Max/Plus line, `/responses`
  // for Grok and GPT. Verified against the live gateway: a chat-only model
  // answers 500 on `/messages`, and `grok-4.6` answers 401 "not supported for
  // format oa-compat" on chat-completions. Models that the gateway refuses
  // outright ("Model is unavailable") are simply not listed — a preset that
  // offers a retired model is worse than one that offers fewer.
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    registry: 'opencode-go',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    docsUrl: 'https://opencode.ai/docs/go/',
    keyHint: 'OpenCode Go key — opencode.ai/auth',
    isLocal: false,
    modelIds: [
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'longcat-2.0',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'hy4-preview',
      'hy3'
    ]
  },
  {
    id: 'opencode-go-messages',
    name: 'OpenCode Go · MiniMax & Qwen',
    registry: 'opencode-go',
    type: 'anthropic',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    docsUrl: 'https://opencode.ai/docs/go/',
    keyHint: 'Same Go API key as above',
    isLocal: false,
    modelIds: [
      'minimax-m3',
      'minimax-m2.7',
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.6-plus',
      'union-alpha'
    ]
  },
  {
    id: 'opencode-go-responses',
    name: 'OpenCode Go · GPT & Grok',
    registry: 'opencode-go',
    type: 'responses',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    docsUrl: 'https://opencode.ai/docs/go/',
    keyHint: 'Same Go API key as above',
    isLocal: false,
    // The Muse models need an explicit opt-in for Meta's training terms; the
    // gateway answers 403 with the URL that turns it on until then.
    modelIds: ['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor']
  }
];

const DEFAULT_MAX_MODELS = 8;

const readRegistry = async (inputPath) => {
  if (inputPath) return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`Registry request failed: HTTP ${res.status}`);
  return res.json();
};

const modelIdOf = (key, model) => model.id || key;

/** Models worth showing: tool-capable first, then newest, then cheapest. */
const pickModels = (entry, limit) => {
  const models = Object.entries(entry.models || {}).map(([key, model]) => ({ key, model }));
  const scorable = models.map((m) => ({
    ...m,
    toolCall: !!m.model.tool_call,
    released: Date.parse(m.model.release_date || '') || 0,
    outputCost: Number(m.model.cost?.output ?? Number.POSITIVE_INFINITY)
  }));
  return scorable
    .sort(
      (a, b) =>
        Number(b.toolCall) - Number(a.toolCall) || b.released - a.released || a.outputCost - b.outputCost
    )
    .slice(0, limit);
};

const toModelInfo = (key, model) => ({
  id: modelIdOf(key, model),
  name: model.name || modelIdOf(key, model),
  supportsTools: !!model.tool_call,
  supportsVision: !!(model.attachment || (model.modalities?.input || []).includes('image')),
  supportsReasoning: !!model.reasoning,
  supportsCaching: !!(model.cost?.cache_read || model.cost?.cache_write),
  contextWindow: model.limit?.context,
  maxOutputTokens: model.limit?.output,
  inputPricePerMillion: model.cost?.input,
  outputPricePerMillion: model.cost?.output,
  cachedInputPricePerMillion: model.cost?.cache_read,
  source: 'builtin'
});

const buildPreset = (spec, registry) => {
  const entry = spec.registry ? registry[spec.registry] : null;
  if (spec.registry && !entry) {
    console.warn(`skip ${spec.id}: registry has no provider "${spec.registry}"`);
    return null;
  }

  const baseUrl = (spec.baseUrl || entry?.api || '').replace(/\/+$/, '');
  if (!baseUrl) {
    console.warn(`skip ${spec.id}: no base URL in registry and none configured`);
    return null;
  }
  if (baseUrl.includes('${')) {
    console.warn(`skip ${spec.id}: base URL needs an account-specific placeholder (${baseUrl})`);
    return null;
  }

  let models = [];
  if (spec.modelIds) {
    for (const id of spec.modelIds) {
      const found = Object.entries(entry.models || {}).find(([key, model]) => modelIdOf(key, model) === id);
      if (!found) {
        console.warn(`  ${spec.id}: registry has no model "${id}" — dropped`);
        continue;
      }
      models.push(toModelInfo(found[0], found[1]));
    }
  } else if (spec.localModels) {
    models = spec.localModels.map((id) => ({
      id,
      name: id,
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: /r1|reason/i.test(id),
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      cachedInputPricePerMillion: 0,
      source: 'builtin'
    }));
  } else {
    const excluded = new Set(spec.excludeModelIds || []);
    models = pickModels(
      { models: Object.fromEntries(Object.entries(entry.models || {}).filter(([key, model]) => !excluded.has(modelIdOf(key, model)))) },
      spec.maxModels || DEFAULT_MAX_MODELS
    ).map((m) => toModelInfo(m.key, m.model));
  }

  if (models.length === 0) {
    console.warn(`skip ${spec.id}: no usable models`);
    return null;
  }

  return {
    id: spec.id,
    name: spec.name || entry?.name || spec.id,
    type: spec.type,
    baseUrl,
    modelsPath: spec.modelsPath,
    requiresApiKey: spec.requiresApiKey ?? !spec.isLocal,
    docsUrl: spec.docsUrl || entry?.doc,
    keyHint: spec.keyHint || (entry?.env || [])[0],
    isLocal: spec.isLocal,
    models
  };
};

/**
 * Drops model ids the provider itself no longer serves.
 *
 * The registry is a snapshot, and it drifts from reality: a retired model stays
 * in it, or a provider renames its ids. Where the catalogue is public this is
 * checked against the live endpoint — a preset that offers a model which 404s is
 * worse than one that offers fewer models.
 *
 * If nothing survives the check, the id form simply differs from what the
 * vendor publishes (namespaced gateways do this), so the registry list is kept
 * and the mismatch reported instead of emptying a working provider.
 */
const verifyModels = async (preset) => {
  const path = preset.modelsPath || (preset.type === 'gemini' ? '/models?pageSize=200' : '/models');
  try {
    const response = await fetch(`${preset.baseUrl}${path}`, {
      headers: { 'user-agent': 'D4IDE/1.0 (+provider-sync)' }
    });
    if (response.status !== 200) return { checked: false };

    const body = await response.json().catch(() => null);
    const live = new Set(
      (body?.data || body?.models || [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.id || entry?.name))
        .filter(Boolean)
    );
    if (live.size === 0) return { checked: false };

    const kept = preset.models.filter((model) => live.has(model.id));
    if (kept.length === 0) return { checked: true, idFormMismatch: true, live: live.size };

    const dropped = preset.models.filter((model) => !live.has(model.id)).map((model) => model.id);
    preset.models = kept;
    return { checked: true, dropped, live: live.size };
  } catch {
    return { checked: false };
  }
};

const main = async () => {
  const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
  const registry = await readRegistry(inputArg?.slice('--input='.length));
  const verify = process.argv.includes('--verify');

  const presets = [];
  for (const spec of CURATED) {
    const preset = buildPreset(spec, registry);
    if (preset) presets.push(preset);
  }

  if (verify) {
    console.log('verifying model ids against each provider\'s live catalogue…');
    for (const preset of presets) {
      if (preset.isLocal) continue;
      const result = await verifyModels(preset);
      if (result.dropped?.length) {
        console.log(`  ${preset.id}: dropped ${result.dropped.length} stale id(s): ${result.dropped.join(', ')}`);
      } else if (result.idFormMismatch) {
        console.log(`  ${preset.id}: NOT verified — its ids are shaped differently upstream (${result.live} live ids)`);
      }
    }
  }

  const header = `import { ModelInfo, ProviderType } from './types';

/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by \`node scripts/sync-providers.cjs\` (or \`pnpm providers:sync\`) from
 * the model registry the OpenCode CLI uses: ${REGISTRY_URL}
 *
 * Edit the CURATED table in that script instead — provider identity and the
 * choice of which models to show belong there. Prices, context windows and
 * capability flags come from the registry, so a refresh is enough to pick up a
 * new model or a price change.
 */

export interface GeneratedProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  /** Set only where the model list is not at the provider's default path. */
  modelsPath?: string;
  requiresApiKey: boolean;
  docsUrl?: string;
  keyHint?: string;
  isLocal?: boolean;
  models: Omit<ModelInfo, 'providerId'>[];
}

export const GENERATED_PROVIDER_PRESETS: GeneratedProviderPreset[] = `;

  fs.writeFileSync(OUT_FILE, `${header}${JSON.stringify(presets, null, 2)};\n`, 'utf8');

  const modelCount = presets.reduce((total, preset) => total + preset.models.length, 0);
  console.log(`wrote ${OUT_FILE}`);
  console.log(`${presets.length} providers · ${modelCount} models`);
  for (const preset of presets) {
    console.log(`  ${preset.id.padEnd(24)} ${String(preset.models.length).padStart(3)} models  ${preset.type.padEnd(10)} ${preset.baseUrl}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
