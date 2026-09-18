import React, { useMemo, useState } from 'react';
import { X, Plus, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { ModelInfo, ProviderConfig } from '../../../shared/types';
// One source of truth for the provider list: the same array the main process
// seeds configs from, so a new preset can never appear in one place only.
import { PROVIDER_PRESETS, ProviderPreset } from '../../../shared/provider-presets';
import { vendorIdOf, vendorLabel } from '../../../shared/provider-vendors';

interface AddProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingIds: string[];
  onAdded: (providers: ProviderConfig[]) => void;
}

export const AddProviderDialog: React.FC<AddProviderDialogProps> = ({ isOpen, onClose, existingIds, onAdded }) => {
  const { t } = useTranslation();
  const { providers, saveProviders } = useSettingsStore();
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [name, setName] = useState('My Provider');
  const [baseUrl, setBaseUrl] = useState('https://api.example.com/v1');
  const [modelId, setModelId] = useState('model-name');
  const [contextWindow, setContextWindow] = useState(128000);
  const [inputPrice, setInputPrice] = useState(1);
  const [outputPrice, setOutputPrice] = useState(3);
  const [supportsTools, setSupportsTools] = useState(true);
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Presets are per protocol, so the list is grouped the way the settings screen
   * shows it: a vendor is one choice, and taking it adds every connection that
   * vendor needs. Adding only the chat-completions config would silently drop
   * the vendor's Anthropic- and responses-only models.
   */
  const presetVendors = useMemo(() => {
    const groups = new Map<string, ProviderPreset[]>();
    for (const preset of PROVIDER_PRESETS) {
      const id = vendorIdOf(preset.id);
      groups.set(id, [...(groups.get(id) ?? []), preset]);
    }
    return Array.from(groups.entries()).map(([id, presets]) => {
      const ordered = [...presets].sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
      return {
        id,
        name: vendorLabel(ordered[0].name),
        baseUrl: ordered[0].baseUrl,
        modelCount: new Set(ordered.flatMap((preset) => preset.models.map((model) => model.id))).size,
        presets: ordered
      };
    });
  }, []);

  if (!isOpen) return null;

  const buildPresetConfig = (preset: ProviderPreset): ProviderConfig => ({
    id: preset.id,
    name: preset.name,
    type: preset.type,
    enabled: true,
    baseUrl: preset.baseUrl,
    // Bring the preset's models along: they carry the prices and capability
    // flags, which is the difference between working cost tracking and $0.
    models: preset.models.map((model) => ({ ...model, providerId: preset.id }) as ModelInfo),
    isBuiltIn: true,
    docsUrl: preset.docsUrl,
    requiresApiKey: preset.requiresApiKey,
    status: preset.isLocal ? 'local' : 'not_configured'
  });

  const addPresetVendor = async (vendor: { presets: ProviderPreset[] }) => {
    const fresh = vendor.presets.filter((preset) => !existingIds.includes(preset.id));
    if (fresh.length === 0) return;
    setIsSaving(true);
    try {
      const next = [...providers, ...fresh.map(buildPresetConfig)];
      await saveProviders(next);
      onAdded(next);
    } finally {
      setIsSaving(false);
    }
  };

  const addCustom = async () => {
    setIsSaving(true);
    try {
      const id = `custom_${Date.now().toString(36)}`;
      const model: ModelInfo = {
        id: modelId.trim() || 'model-name',
        name: modelId.trim() || 'model-name',
        providerId: id,
        contextWindow: contextWindow || undefined,
        supportsTools,
        supportsVision,
        supportsReasoning,
        inputPricePerMillion: inputPrice,
        outputPricePerMillion: outputPrice,
        source: 'manual'
      };
      const provider: ProviderConfig = {
        id,
        name: name.trim() || 'Custom Provider',
        type: 'custom',
        enabled: true,
        baseUrl: baseUrl.trim(),
        models: [model],
        isCustom: true,
        isBuiltIn: false,
        requiresApiKey: true,
        status: 'not_configured'
      };
      await saveProviders([...providers, provider]);
      onAdded([...providers, provider]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center select-none text-xs">
      <div className="w-[560px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-d4-border bg-d4-bg/50">
          <span className="font-semibold text-d4-text text-sm flex items-center space-x-2">
            <Server className="w-4 h-4 text-d4-accent" />
            <span>{t('providers.addProvider')}</span>
          </span>
          <button onClick={onClose} className="text-d4-dimmed hover:text-d4-text p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center space-x-1 px-4 pt-3">
          <button
            onClick={() => setMode('preset')}
            className={`px-3 py-1 rounded-sm text-[11px] ${mode === 'preset' ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-muted hover:text-d4-text'}`}
          >
            {t('providers.builtIn')}
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`px-3 py-1 rounded-sm text-[11px] ${mode === 'custom' ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-muted hover:text-d4-text'}`}
          >
            {t('providers.openAiCompatible')}
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto select-text">
          {mode === 'preset' ? (
            <div className="grid grid-cols-2 gap-2">
              {presetVendors.map((vendor) => {
                const already = vendor.presets.every((preset) => existingIds.includes(preset.id));
                return (
                  <button
                    key={vendor.id}
                    onClick={() => void addPresetVendor(vendor)}
                    disabled={already || isSaving}
                    className={`text-left p-2.5 rounded border transition-colors ${
                      already
                        ? 'border-d4-border/50 bg-d4-surface/50 text-d4-dimmed cursor-not-allowed'
                        : 'border-d4-border bg-d4-surface hover:border-d4-accent text-d4-text'
                    }`}
                  >
                    <div className="font-medium text-xs">{vendor.name}</div>
                    <div className="text-[10px] text-d4-dimmed font-mono truncate">{vendor.baseUrl}</div>
                    <div className="text-[10px] mt-1 text-d4-dimmed">
                      {already
                        ? t('providers.alreadyAdded')
                        : `${t('providers.tapToAdd')} · ${t('providers.modelsCount', { count: vendor.modelCount })}`}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="text-[10px] text-d4-dimmed uppercase">{t('providers.providerName')}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-d4-surface border border-d4-border rounded px-2.5 py-1.5 text-xs text-d4-text outline-none focus:border-d4-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-d4-dimmed uppercase">Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full bg-d4-surface border border-d4-border rounded px-2.5 py-1.5 text-xs font-mono text-d4-text outline-none focus:border-d4-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-d4-dimmed uppercase">Model ID</span>
                <input
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full bg-d4-surface border border-d4-border rounded px-2.5 py-1.5 text-xs font-mono text-d4-text outline-none focus:border-d4-accent"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] text-d4-dimmed uppercase">Context</span>
                  <input
                    type="number"
                    value={contextWindow}
                    onChange={(e) => setContextWindow(parseInt(e.target.value) || 0)}
                    className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-d4-dimmed uppercase">In $/1M</span>
                  <input
                    type="number"
                    step="0.01"
                    value={inputPrice}
                    onChange={(e) => setInputPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-d4-dimmed uppercase">Out $/1M</span>
                  <input
                    type="number"
                    step="0.01"
                    value={outputPrice}
                    onChange={(e) => setOutputPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center space-x-4 pt-1">
                {[
                  { label: t('providers.supportsTools'), value: supportsTools, set: setSupportsTools },
                  { label: t('providers.supportsVision'), value: supportsVision, set: setSupportsVision },
                  { label: t('providers.supportsReasoning'), value: supportsReasoning, set: setSupportsReasoning }
                ].map((cap) => (
                  <label key={cap.label} className="flex items-center space-x-1.5 text-[11px] text-d4-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cap.value}
                      onChange={(e) => cap.set(e.target.checked)}
                      className="accent-teal-500 w-3 h-3"
                    />
                    <span>{cap.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-d4-dimmed leading-relaxed">{t('providers.customKeyNote')}</p>
            </div>
          )}
        </div>

        {mode === 'custom' && (
          <div className="px-4 py-3 border-t border-d4-border flex justify-end">
            <button
              onClick={addCustom}
              disabled={isSaving}
              className="flex items-center space-x-1 px-3 py-1.5 bg-d4-accent hover:bg-d4-accent-hover disabled:opacity-40 text-black font-semibold rounded text-[11px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('providers.addProvider')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
