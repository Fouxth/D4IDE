import { ModelInfo, ProviderConfig } from './types';
import { GENERATED_PROVIDER_PRESETS } from './provider-presets.generated';

/**
 * Shipped provider presets (spec §26/§28).
 *
 * The list itself is generated — see `scripts/sync-providers.cjs` — because
 * everything factual about it (model ids, prices, context windows, capability
 * flags) comes from the registry the OpenCode CLI uses, and facts like those rot
 * fast. What lives here is the *shape* the rest of the app depends on.
 *
 * Two places read this and they must never disagree: the store, which seeds
 * provider configs on startup, and the renderer's "Add provider" dialog. That is
 * why it sits in `shared` rather than inside the main process.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderConfig['type'];
  baseUrl: string;
  /** Set only where the model list is not at `{baseUrl}/models`. */
  modelsPath?: string;
  requiresApiKey: boolean;
  docsUrl?: string;
  /** Short hint shown next to the API key field. */
  keyHint?: string;
  isLocal?: boolean;
  models: Omit<ModelInfo, 'providerId'>[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = GENERATED_PROVIDER_PRESETS;

/** Providers that speak the OpenAI chat-completions protocol. */
export const OPENAI_SHAPED_PRESETS = PROVIDER_PRESETS.filter(
  (preset) => preset.type !== 'anthropic' && preset.type !== 'gemini' && preset.type !== 'responses'
);

/**
 * OpenCode's gateways are the reason provider *type* exists.
 *
 * Zen and the Go subscription each serve one key across several protocols: a
 * preset exists per protocol rather than per brand, because the key is the same
 * but the endpoint — and therefore which models are callable — is not. The
 * suffix names the protocol, and each preset only carries models that answer on
 * it (verified against the live gateway and the vendor's endpoint table).
 */
export const OPENCODE_PRESET_IDS = [
  'opencode-zen',
  'opencode-zen-messages',
  'opencode-zen-responses',
  'opencode-zen-gemini',
  'opencode-go',
  'opencode-go-messages',
  'opencode-go-responses'
] as const;
