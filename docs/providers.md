# AI Provider Configuration Guide

D4IDE operates entirely via **BYOK (Bring Your Own Key)**. Every request goes straight from your desktop
app to the provider you configured — there is no proxy and no key escrow.

## The Provider Hub

Open **Settings → AI Providers**. Each provider is a card showing:

| Element | Meaning |
|---|---|
| Status dot | Connected · Not configured · Unreachable · Running locally · Not tested |
| Latency | Measured by the last successful **Test** (e.g. `412ms`) |
| Key row | `••••1a2b` preview of the stored key, plus **Replace key** / **Remove key** |
| Base URL | Editable — point it at a gateway or a local server |
| Power icon | Enable/disable this provider everywhere (model picker, auto-routing) |
| **Test** | Validates the key without spending generation tokens |
| **Fetch models** | Calls the provider's model-list API and merges the results |

### Adding a provider

**Add provider → Built-in providers** offers DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter,
xAI (Grok) and Ollama. **Add provider → OpenAI-compatible (custom)** creates a provider for anything
speaking the OpenAI API (vLLM, LM Studio, Groq, Together, Mistral, a corporate gateway…) where you set
name, base URL, model id, context window, prices and capability flags.

Built-in providers that a newer app version adds are merged into your config on startup. Your keys,
base URLs, model lists and prices are never overwritten by that merge.

### Model metadata

Every model row is fully editable: **Model ID**, display name, context window, and prices per 1M tokens
for input / output / **cached** input, plus capability flags (Tools, Vision, Reasoning, Prompt cache).
The flags drive three things:

- whether the model appears in the composer for tool-using agent work,
- whether the reasoning-effort selector is shown for it,
- how the **Auto** router scores it.

Prices are only ever used to *estimate* cost locally, so a wrong number never breaks a request — it just
makes the usage dashboard wrong. Correct them once and the estimates stay right.

### Fetching live model lists

`Fetch models` uses each provider's own discovery endpoint:

| Provider | Endpoint |
|---|---|
| OpenAI-compatible | `GET {baseUrl}/models` |
| Anthropic | `GET {baseUrl}/models` |
| Google Gemini | `GET {baseUrl}/models` |
| Ollama | `GET {host}/api/tags`, falling back to `{baseUrl}/models` |

Discovered models are added; anything you tuned by hand (name, prices, capability flags) is preserved.

## Model selection

The composer's model button opens a searchable picker grouped by provider, with badges for tools,
vision, reasoning and prompt caching, plus context size and per-1M prices. Models you star appear under
**Favorites**, and the last few you used appear under **Recently used**.

### Auto routing ✨

Selecting **Auto ✨** hands the choice to the router. Pick a profile:

| Profile | Optimises for |
|---|---|
| Best quality | reasoning capability and large context first |
| Balanced | capability vs price (default) |
| Lowest cost | cheapest capable model, including local ones |
| Fastest | cheapest/fastest with enough capability |

Candidates are scored from declared metadata only, filtered to providers that are enabled *and* have a
usable key. The winning choice and the reason are written to the agent timeline, so nothing is silent.

### Failover

If the selected provider cannot be used, D4IDE tries your configured fallback chain and then any other
usable provider, and says which one it switched to. Enable/disable this under
**Settings → Agent → Fail over to another provider**.

## API key handling

- Keys are encrypted with Windows' own crypto (`safeStorage`/DPAPI) or AES-256-GCM as a fallback.
- **The renderer never receives a plaintext key.** It only sees `hasApiKey` and a `••••1a2b` preview;
  testing and model discovery happen in the main process using the stored key.
- Typing a new key replaces the stored one. Leaving the field empty keeps the existing key.
- `Remove key` deletes it explicitly.

## Cost estimation

Cost comes from the active model's configured prices:

```
cost = (freshInputTokens × inputPrice + cachedTokens × cachedPrice + outputTokens × outputPrice) / 1,000,000
```

Cached-token counts are read from the provider's own usage report (`prompt_tokens_details.cached_tokens`,
`cache_read_input_tokens`, `cachedContentTokenCount`). When a model has no cached price configured, cached
tokens are billed at the normal input rate. See **Usage & cost** in Settings for the breakdown by
provider, model and project.

## OpenCode Zen (and Go): one key, four protocols

Zen and the Go subscription are OpenCode's own AI gateways: one API key, one base URL each, a curated list of
coding models. **Neither is a single API.** Under one key they serve four endpoint families, and a model sent
to the wrong family fails immediately — so D4IDE ships one preset per family, and each preset lists only the
models that answer on it.

| Preset | Type | Endpoint it calls | Models |
|---|---|---|---|
| **OpenCode Zen** | OpenAI-compatible | `POST {base}/chat/completions` | DeepSeek V4, GLM 5.3/5.2/5.1, Kimi K3/K2.7/K2.6, MiniMax M3/M2.7, the free models |
| **OpenCode Zen · Claude & Qwen** | Anthropic Messages | `POST {base}/messages` | Claude Fable/Opus/Sonnet/Haiku, Qwen3.6 & 3.5 Plus, Union Alpha |
| **OpenCode Zen · GPT & Grok** | OpenAI **Responses** | `POST {base}/responses` | GPT 5–6 (incl. Codex), Grok 4.5/4.6, Grok Build, Muse Spark |
| **OpenCode Zen · Gemini** | Google Gemini | `POST {base}/models/{model}:streamGenerateContent` | Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash, 3.1 Pro, 3 Flash |

Go is the same shape with three families — `OpenCode Go` (16 chat models), `OpenCode Go · MiniMax & Qwen`
(`/messages`) and `OpenCode Go · GPT & Grok` (`/responses`) — and Go adds two rules of its own:

| Header | Why |
|---|---|
| `User-Agent: D4IDE/1.0` | Go asks clients to identify themselves instead of arriving as a generic HTTP library, and throttles traffic that degrades the shared pool |
| `x-opencode-session: <session id>` | A stable id per conversation, so the gateway can route consistently and reuse prompt caching. **It is mandatory**: without it every model answers `400 Request is missing x-opencode-session and cannot be routed` |

The session header is sent **only** to `opencode.ai` — the meaning is vendor-specific, so no other provider
receives it (`tests/client-identity.test.ts` pins both halves of that rule).

### Setup

1. Sign in at `opencode.ai/auth`, add billing, and copy the key. The same key covers every preset on both
gateways.
2. **Settings → AI Providers →** paste it into the card for the protocol you want. A preset added by a later
   version inherits the key from an already-configured preset on the same base URL, so you normally type it
   once.
3. Press **Test**. Because these gateways publish `/models` to anyone, Test does not stop there: when a key is
   present it spends one minimal request to prove the key really authenticates. Without that check a typo
   would report "connected" and then fail mid-task.
4. Press **Fetch models** to pull the gateway's live catalogue (Zen: about 70 ids; Go: about 38).

**Prices:** `/models` returns ids only — no pricing and no context windows — so the numbers shipped in the
preset are the ones from the [Zen pricing table](https://opencode.ai/docs/zen/#pricing), and every model the
fetcher adds arrives at $0. Edit the price and context window of any fetched model in the Provider Hub, or
cost tracking and budget warnings will read zero for it. The published prices are also editable because Zen
discounts models from time to time (for example GPT 5.6 Sol includes a temporary 50% discount).

**Not the same thing:** the `opencode` CLI's local server (`opencode serve`) exposes the *agent* over HTTP,
not a chat-completions endpoint. Pointing a provider at it will not work — Zen (or a provider's own API) is
what a model provider slot expects.

### OpenCode Go (the $10/month subscription)

```text
base URL  https://opencode.ai/zen/go/v1        ← verified against the live gateway
key       the same OpenCode key as Zen — opencode.ai/auth
models    28 served ids across three protocols, all tool-capable
```

The split is not inferred from a registry field — each model was classified by calling it on all three
protocols with a real key and recording which one answered. That is how `grok-4.6` and `gpt-5.6-luna` came to
sit on `/responses` (chat-completions answers `401 not supported for format oa-compat`) and how
`minimax-m2.7` and `union-alpha` came to sit on `/messages`.

**Models the gateway refuses are not listed.** Calling `glm-5`, `kimi-k2.5`, `qwen3.5-plus`, `mimo-v2-pro`,
`mimo-v2-omni`, `hy3-preview` or `grok-4.5` answers `400 Upstream request failed: Model is unavailable`, so
they are absent from every preset — a preset that offers a retired model is worse than one that offers fewer.

**Two Go models are gated by an account setting**, and the gateway says so in the error text:

| Model | Gate |
|---|---|
| DeepSeek V4 Pro / V4 Flash / V4.1 Flash / Flash Vision | Hosted in China: the workspace must opt in explicitly before these answer (the 403 includes the link) |
| Muse Spark 1.2 / 1.3 Contributor | Training-data consent for Meta's terms; the 403 includes the link |

They are listed, so once the workspace opts in they simply work — until then they answer 403 with the URL
that turns them on.

## The shipped catalogue is generated, not typed by hand

D4IDE ships **48 providers and ~360 models**, and the whole list is produced from the model registry the
OpenCode CLI uses (<https://models.dev/api.json>):

```bash
pnpm providers:sync     # refresh presets from the registry
pnpm providers:sync -- --verify   # …and drop ids the provider no longer serves (network)
pnpm providers:check    # probe every endpoint, and report model drift
```

`scripts/sync-providers.cjs` holds a **CURATED table** — one line per provider — naming its id, registry id,
protocol shape, base URL where the registry has none, key hint and docs link. Everything factual about the
models (ids, prices, context windows, tool/vision/reasoning flags) comes from the registry, so a refresh picks
up a new model or a price change without anyone editing a data file.

`scripts/check-providers.cjs` is the honesty check that goes with it, and it reports two different things:

- **Reachability** — the endpoint the app will call answers with something other than 404. A 401/403 is a
  pass: the endpoint exists and wants a key. Current result: **46/46 remote endpoints reachable**.
- **Model drift** — where a provider publishes its catalogue openly, the preset's ids are compared against it.
  This is not theoretical: the first run found 6 providers listing models their endpoint no longer served
  (44 ids across Novita, NVIDIA, ModelScope, the Alibaba coding plan, Cline and Requesty). Six were dropped.
  Three gateways namespace their ids differently from the registry — those are reported as *not comparable*
  rather than silently "fixed".

What the check **cannot** do is prove a key works or that a specific model answers a chat request: that needs
credentials. The verification performed in this repository therefore covers endpoint existence, model-id
validity and parsing rules — not live completions.

Adding a provider is one line in the curated table; the generator fills in its base URL, models and prices and
skips anything it cannot resolve (no base URL, no models, a URL that needs an account-specific placeholder).
Providers that need more than a URL and a key — Amazon Bedrock (SigV4), Google Vertex and Azure OpenAI
(deployment-scoped URLs and OAuth) — are deliberately absent rather than shipped broken.

## Local models with Ollama

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

Ollama needs no API key; its models are priced at zero so they never touch your budgets. Point the base
URL at a different host if Ollama runs on another machine.
