import { ModelInfo, ProviderConfig } from '../../../shared/types';
import { PROVIDER_PRESETS, ProviderPreset } from '../../../shared/provider-presets';

export { PROVIDER_PRESETS };
export type { ProviderPreset };


export function buildDefaultProviders(): ProviderConfig[] {
  return PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    type: preset.type,
    enabled: true,
    baseUrl: preset.baseUrl,
    modelsPath: preset.modelsPath,
    models: preset.models.map((m) => ({ ...m, providerId: preset.id }) as ModelInfo),
    isBuiltIn: true,
    docsUrl: preset.docsUrl,
    requiresApiKey: preset.requiresApiKey,
    status: preset.isLocal ? ('local' as const) : ('not_configured' as const)
  }));
}

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Built-in providers that a shipped version adds and older configs may lack. */
export function getPresetIds(): string[] {
  return PROVIDER_PRESETS.map((p) => p.id);
}
