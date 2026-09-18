import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Key,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Zap,
  Wrench,
  Image as ImageIcon,
  Database,
  Save,
  Power
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { ModelInfo, ProviderConfig, ProviderTestResult } from '../../../shared/types';
import { VendorGroup, VendorModel, groupProviders } from '../../../shared/provider-vendors';
import { formatPrice, providerErrorLabel } from '../../lib/format';
import { AddProviderDialog } from './AddProviderDialog';

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  connected: { dot: 'bg-emerald-400', label: 'connected', text: 'text-emerald-400' },
  not_configured: { dot: 'bg-d4-dimmed', label: 'not_configured', text: 'text-d4-dimmed' },
  error: { dot: 'bg-red-400', label: 'error', text: 'text-red-400' },
  local: { dot: 'bg-blue-400', label: 'local', text: 'text-blue-400' },
  unknown: { dot: 'bg-amber-400', label: 'unknown', text: 'text-amber-400' }
};

interface VendorCardProps {
  group: VendorGroup;
  drafts: Record<string, ProviderConfig>;
  onDraftChange: (configId: string, next: ProviderConfig) => void;
  onKeySaved: (providers: ProviderConfig[]) => void;
  onProvidersChanged: (providers: ProviderConfig[]) => void;
}

/** What each connection of the vendor reported when it was tested. */
interface VariantResult {
  providerId: string;
  protocol: string;
  result: ProviderTestResult;
}

/**
 * One card per vendor.
 *
 * The card used to be one per *provider config*, and a vendor that answers on
 * several protocols is several configs — so OpenCode Go appeared three times,
 * with the same key field three times, which reads as three things to set up.
 * This card owns every connection of one vendor: one key field (written to all
 * of them, because they are the same account), one test that checks each
 * protocol and reports which ones answered, and one model list that is the union
 * of what the vendor serves. Editing a model still writes to the config that
 * actually serves it, so request routing is untouched.
 */
const VendorCard: React.FC<VendorCardProps> = ({ group, drafts, onDraftChange, onKeySaved, onProvidersChanged }) => {
  const { t } = useTranslation();
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [variantResults, setVariantResults] = useState<VariantResult[] | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);

  const primary = group.providers[0];
  const primaryDraft = drafts[primary.id] ?? primary;
  const status = STATUS_STYLES[group.status || 'unknown'] || STATUS_STYLES.unknown;

  // One key covers the vendor: the connections differ by protocol, not by
  // account, so whichever config holds it is the one to show.
  const keyHolder = group.providers.find((p) => p.hasApiKey) ?? primary;
  const requiresKey = group.requiresApiKey;
  const enabled = group.providers.some((p) => drafts[p.id]?.enabled ?? p.enabled);

  const writeAll = (patch: (provider: ProviderConfig) => ProviderConfig) => {
    for (const provider of group.providers) {
      const current = drafts[provider.id] ?? provider;
      onDraftChange(provider.id, patch(current));
    }
  };

  const handleSaveKey = async () => {
    if (!window.electronAPI) return;
    const key = keyInput.trim();
    // Every protocol of the vendor uses the same key, so it is written to all of
    // them; anything else would leave the other protocols authenticating with
    // nothing and failing later, somewhere less obvious.
    let providers: ProviderConfig[] = [];
    for (const provider of group.providers) {
      providers = await window.electronAPI.setProviderKey(provider.id, key);
    }
    onKeySaved(providers);
    setKeyInput('');
    if (key) toast.success(`${group.name}: ${t('providers.keySaved')}`);
    else toast.info(`${group.name}: ${t('providers.keyRemoved')}`);
  };

  const handleRemoveKey = async () => {
    if (!window.electronAPI) return;
    let providers: ProviderConfig[] = [];
    for (const provider of group.providers) {
      providers = await window.electronAPI.setProviderKey(provider.id, null);
    }
    onKeySaved(providers);
    toast.info(`${group.name}: ${t('providers.keyRemoved')}`);
  };

  const handleTest = async () => {
    if (!window.electronAPI) return;
    setTesting(true);
    setVariantResults(null);
    try {
      const collected: VariantResult[] = [];
      let latest: ProviderConfig[] = [];
      for (const provider of group.providers) {
        const draft = drafts[provider.id] ?? provider;
        const res = await window.electronAPI.testProvider(
          provider.id,
          keyInput.trim() || undefined,
          draft.baseUrl,
          draft.models[0]?.id
        );
        latest = res.providers;
        collected.push({ providerId: provider.id, protocol: provider.type, result: res.result });
      }
      setVariantResults(collected);
      onProvidersChanged(latest);

      const ok = collected.filter((entry) => entry.result.success);
      const firstFailure = collected.find((entry) => !entry.result.success);
      if (ok.length === collected.length) {
        toast.success(
          `${group.name}: ${t('providers.testSuccess')}`,
          `${ok[0]?.result.latencyMs ?? 0}ms${ok[0]?.result.modelCount ? ` · ${ok[0].result.modelCount} models` : ''}`
        );
      } else if (ok.length > 0) {
        toast.warning(
          `${group.name}: ${t('providers.testPartial', { ok: ok.length, total: collected.length })}`,
          providerErrorLabel(firstFailure?.result.errorKind, 'th')
        );
      } else {
        toast.error(`${group.name}: ${t('providers.testFailed')}`, providerErrorLabel(firstFailure?.result.errorKind, 'th'));
      }
    } catch (e: any) {
      setVariantResults([{ providerId: primary.id, protocol: primary.type, result: { success: false, error: e.message, errorKind: 'unknown' } }]);
    } finally {
      setTesting(false);
    }
  };

  const handleRefreshModels = async () => {
    if (!window.electronAPI) return;
    setRefreshing(true);
    try {
      let total = 0;
      let latest: ProviderConfig[] = [];
      for (const provider of group.providers) {
        const res = await window.electronAPI.refreshProviderModels(provider.id);
        latest = res.providers;
        if (res.success) total += res.models?.length ?? 0;
      }
      onProvidersChanged(latest);
      if (total > 0) {
        toast.success(`${group.name}: ${t('providers.modelsFetched')}`, t('providers.modelsCount', { count: total }));
        setModelsOpen(true);
      } else {
        toast.error(`${group.name}: ${t('providers.modelsFetchFailed')}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!window.electronAPI) return;
    let providers: ProviderConfig[] = [];
    for (const provider of group.providers) {
      providers = await window.electronAPI.deleteProvider(provider.id);
    }
    onProvidersChanged(providers);
    toast.info(`${group.name} ${t('providers.deleted')}`);
  };

  /** Which config serves a model — the edit has to land on that one. */
  const ownerOf = (modelId: string): VendorModel | undefined =>
    group.models.find((entry) => entry.model.id === modelId);

  const updateModel = (modelId: string, patch: Partial<ModelInfo>) => {
    const owner = ownerOf(modelId);
    if (!owner) return;
    const current = drafts[owner.providerId] ?? group.providers.find((p) => p.id === owner.providerId)!;
    onDraftChange(owner.providerId, {
      ...current,
      models: current.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m))
    });
  };

  const removeModel = (modelId: string) => {
    const owner = ownerOf(modelId);
    if (!owner) return;
    const current = drafts[owner.providerId] ?? group.providers.find((p) => p.id === owner.providerId)!;
    onDraftChange(owner.providerId, { ...current, models: current.models.filter((m) => m.id !== modelId) });
  };

  const addModel = () => {
    const id = `new-model-${Date.now().toString().slice(-4)}`;
    onDraftChange(primary.id, {
      ...primaryDraft,
      models: [
        ...primaryDraft.models,
        {
          id,
          name: id,
          providerId: primary.id,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: false,
          source: 'manual'
        }
      ]
    });
    setEditingModel(id);
    setModelsOpen(true);
  };

  const priceRange = useMemo(() => {
    const priced = group.models.map((entry) => entry.model).filter((m) => (m.inputPricePerMillion ?? 0) > 0);
    if (priced.length === 0) return t('providers.freeOrLocal');
    const min = Math.min(...priced.map((m) => m.inputPricePerMillion || 0));
    const max = Math.max(...priced.map((m) => m.outputPricePerMillion || 0));
    return `${formatPrice(min)}–${formatPrice(max)} / 1M`;
  }, [group.models, t]);

  const allOk = variantResults?.every((entry) => entry.result.success) ?? false;

  return (
    <div className="bg-d4-surface border border-d4-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
        <div className="flex items-center space-x-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-d4-text text-xs truncate">{group.name}</span>
              <span className={`text-[10px] ${status.text}`}>{t(`providers.status.${status.label}`)}</span>
              {group.latencyMs !== undefined && group.status === 'connected' && (
                <span className="text-[10px] text-d4-dimmed font-mono">{group.latencyMs}ms</span>
              )}
            </div>
            <div className="text-[10px] text-d4-dimmed truncate">
              {t('providers.modelsCount', { count: group.models.length })} · {priceRange}
              {group.providers.length > 1 && ` · ${t('providers.connections', { count: group.providers.length })}`}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {group.docsUrl && (
            <button
              onClick={() => window.electronAPI?.openExternal(group.docsUrl!)}
              title={t('providers.getKey')}
              className="p-1 text-d4-dimmed hover:text-d4-text rounded"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => writeAll((provider) => ({ ...provider, enabled: !enabled }))}
            title={enabled ? t('providers.enabled') : t('providers.disabled')}
            className={`p-1 rounded ${enabled ? 'text-d4-accent' : 'text-d4-dimmed'}`}
          >
            <Power className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center space-x-1 px-2 py-1 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            <span>{t('providers.test')}</span>
          </button>
          <button
            onClick={handleRefreshModels}
            disabled={refreshing}
            className="flex items-center space-x-1 px-2 py-1 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span>{t('providers.fetchModels')}</span>
          </button>
          <button onClick={handleDelete} title={t('providers.removeVendor')} className="p-1 text-d4-dimmed hover:text-red-400 rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* API key + base URL */}
      <div className="px-3.5 pb-3 space-y-2.5">
        {requiresKey && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-d4-dimmed uppercase tracking-wide flex items-center space-x-1">
                <Key className="w-3 h-3" />
                <span>API Key</span>
              </label>
              {keyHolder.hasApiKey && (
                <span className="text-[10px] text-emerald-400 font-mono flex items-center space-x-1">
                  <Check className="w-3 h-3" />
                  <span>{keyHolder.apiKeyPreview || '••••'}</span>
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={keyHolder.hasApiKey ? t('providers.replaceKeyPlaceholder') : 'sk-...'}
                  className="w-full bg-d4-panel border border-d4-border rounded px-2.5 py-1.5 pr-8 text-xs text-d4-text outline-none font-mono focus:border-d4-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-d4-dimmed hover:text-d4-text"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                onClick={handleSaveKey}
                disabled={!keyInput.trim()}
                className="px-2 py-1.5 bg-d4-accent hover:bg-d4-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded text-[11px]"
              >
                {keyHolder.hasApiKey ? t('providers.replaceKey') : t('providers.saveKey')}
              </button>
              {keyHolder.hasApiKey && (
                <button
                  onClick={handleRemoveKey}
                  className="px-2 py-1.5 border border-d4-border rounded text-[11px] text-red-400/80 hover:text-red-400"
                >
                  {t('providers.removeKey')}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] text-d4-dimmed uppercase tracking-wide">Base URL</label>
          <input
            type="text"
            value={primaryDraft.baseUrl || ''}
            onChange={(e) => writeAll((provider) => ({ ...provider, baseUrl: e.target.value }))}
            className="w-full bg-d4-panel border border-d4-border rounded px-2.5 py-1.5 text-xs text-d4-text outline-none font-mono focus:border-d4-accent"
          />
          {group.providers.length > 1 && (
            <p className="text-[10px] text-d4-dimmed">
              {t('providers.protocols', { list: group.protocols.join(', ') })}
            </p>
          )}
        </div>

        {variantResults && variantResults.length > 0 && (
          <div
            className={`text-[11px] p-2 rounded space-y-1 ${
              allOk
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-red-500/10 text-red-400 border border-red-500/30'
            }`}
          >
            {variantResults.map((entry) => (
              <div key={entry.providerId} className="flex items-start space-x-1.5">
                {entry.result.success ? (
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <span className="font-mono">{entry.protocol}</span>
                  <span className="opacity-80">
                    {' · '}
                    {entry.result.success
                      ? `${t('providers.testSuccess')} (${entry.result.latencyMs ?? 0}ms${
                          entry.result.modelCount ? `, ${entry.result.modelCount} models` : ''
                        })`
                      : providerErrorLabel(entry.result.errorKind, 'th')}
                  </span>
                  {!entry.result.success && entry.result.error && (
                    <div className="text-[10px] opacity-80 break-words">{entry.result.error.slice(0, 200)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Models */}
      <div className="border-t border-d4-border">
        <button
          onClick={() => setModelsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3.5 py-2 text-[11px] text-d4-muted hover:text-d4-text hover:bg-d4-subtle/30"
        >
          <span className="flex items-center space-x-1.5">
            {modelsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="uppercase tracking-wide">{t('providers.models')}</span>
            <span className="text-d4-dimmed">({group.models.length})</span>
          </span>
          <span className="text-[10px] text-d4-dimmed">{t('providers.editModelHint')}</span>
        </button>

        {modelsOpen && (
          <div className="px-3.5 pb-3.5 space-y-1.5">
            {group.models.map(({ model: m, providerId }) => {
              const isEditing = editingModel === m.id;
              return (
                <div key={`${providerId}:${m.id}`} className="bg-d4-panel border border-d4-border rounded">
                  <div className="flex items-center justify-between px-2.5 py-1.5 gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-xs text-d4-text truncate">{m.name}</span>
                      <span className="text-[10px] text-d4-dimmed font-mono truncate max-w-[160px]">{m.id}</span>
                      <span className="flex items-center space-x-1 shrink-0">
                        {m.supportsTools && (
                          <span title="Tools">
                            <Wrench className="w-3 h-3 text-d4-muted" />
                          </span>
                        )}
                        {m.supportsVision && (
                          <span title="Vision">
                            <ImageIcon className="w-3 h-3 text-d4-muted" />
                          </span>
                        )}
                        {m.supportsReasoning && (
                          <span title="Reasoning">
                            <Zap className="w-3 h-3 text-amber-400" />
                          </span>
                        )}
                        {m.supportsCaching && (
                          <span title="Prompt caching">
                            <Database className="w-3 h-3 text-blue-400" />
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="text-[10px] text-d4-dimmed font-mono">
                        {m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '—'}
                      </span>
                      <span className="text-[10px] text-d4-muted font-mono">
                        {formatPrice(m.inputPricePerMillion)}/{formatPrice(m.outputPricePerMillion)}
                      </span>
                      <button
                        onClick={() => setEditingModel(isEditing ? null : m.id)}
                        className="text-[10px] text-d4-dimmed hover:text-d4-text"
                      >
                        {isEditing ? t('common.close') : t('common.edit')}
                      </button>
                      <button onClick={() => removeModel(m.id)} className="text-d4-dimmed hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="border-t border-d4-border px-2.5 py-2 grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.modelId')}</span>
                        <input
                          value={m.id}
                          onChange={(e) => updateModel(m.id, { id: e.target.value })}
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.modelName')}</span>
                        <input
                          value={m.name}
                          onChange={(e) => updateModel(m.id, { name: e.target.value })}
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] text-d4-text outline-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.contextWindow')}</span>
                        <input
                          type="number"
                          value={m.contextWindow ?? ''}
                          onChange={(e) => updateModel(m.id, { contextWindow: parseInt(e.target.value) || undefined })}
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.inputPrice')} / 1M</span>
                        <input
                          type="number"
                          step="0.01"
                          value={m.inputPricePerMillion ?? ''}
                          onChange={(e) =>
                            updateModel(m.id, {
                              inputPricePerMillion: e.target.value === '' ? undefined : parseFloat(e.target.value)
                            })
                          }
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.outputPrice')} / 1M</span>
                        <input
                          type="number"
                          step="0.01"
                          value={m.outputPricePerMillion ?? ''}
                          onChange={(e) =>
                            updateModel(m.id, {
                              outputPricePerMillion: e.target.value === '' ? undefined : parseFloat(e.target.value)
                            })
                          }
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-d4-dimmed">{t('providers.cachedPrice')} / 1M</span>
                        <input
                          type="number"
                          step="0.01"
                          value={m.cachedInputPricePerMillion ?? ''}
                          onChange={(e) =>
                            updateModel(m.id, {
                              cachedInputPricePerMillion: e.target.value === '' ? undefined : parseFloat(e.target.value)
                            })
                          }
                          className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                        />
                      </label>
                      <div className="col-span-2 flex items-center space-x-3 pt-1">
                        {[
                          { key: 'supportsTools' as const, label: t('providers.supportsTools') },
                          { key: 'supportsVision' as const, label: t('providers.supportsVision') },
                          { key: 'supportsReasoning' as const, label: t('providers.supportsReasoning') },
                          { key: 'supportsCaching' as const, label: t('providers.supportsCaching') }
                        ].map((cap) => (
                          <label key={cap.key} className="flex items-center space-x-1.5 text-[11px] text-d4-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!m[cap.key]}
                              onChange={(e) => updateModel(m.id, { [cap.key]: e.target.checked } as Partial<ModelInfo>)}
                              className="accent-teal-500 w-3 h-3"
                            />
                            <span>{cap.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={addModel}
              className="w-full flex items-center justify-center space-x-1 px-2 py-1.5 border border-dashed border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-dimmed"
            >
              <Plus className="w-3 h-3" />
              <span>{t('providers.addModel')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const ProviderHub: React.FC = () => {
  const { t } = useTranslation();
  const { providers, settings, saveProviders, applyProviders } = useSettingsStore();
  const [drafts, setDrafts] = useState<Record<string, ProviderConfig>>({});
  const [filter, setFilter] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showUnused, setShowUnused] = useState(false);

  useEffect(() => {
    const next: Record<string, ProviderConfig> = {};
    for (const p of providers) next[p.id] = { ...p, models: p.models.map((m) => ({ ...m })) };
    setDrafts(next);
  }, [providers]);

  const dirty = useMemo(
    () =>
      providers.some((p) => {
        const draft = drafts[p.id];
        if (!draft) return false;
        return (
          draft.enabled !== p.enabled ||
          draft.baseUrl !== p.baseUrl ||
          JSON.stringify(draft.models) !== JSON.stringify(p.models)
        );
      }),
    [providers, drafts]
  );

  // The vendor behind the active model is always shown, so the provider being
  // talked to can never be hidden by the "in use only" filter.
  const groups = useMemo(
    () =>
      groupProviders(providers, {
        activeProviderIds: settings?.activeProviderId ? [settings.activeProviderId] : []
      }),
    [providers, settings?.activeProviderId]
  );

  const inUse = useMemo(() => groups.filter((group) => group.inUse), [groups]);
  const unused = useMemo(() => groups.filter((group) => !group.inUse), [groups]);
  const shown = (showUnused ? groups : inUse).filter((group) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      group.name.toLowerCase().includes(q) ||
      group.id.includes(q) ||
      group.models.some((entry) => entry.model.id.toLowerCase().includes(q) || entry.model.name.toLowerCase().includes(q))
    );
  });

  const modelCount = inUse.reduce((total, group) => total + group.models.length, 0);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveProviders(providers.map((p) => drafts[p.id] ?? p));
      toast.success(t('providers.saved'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3 select-text">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-d4-text">{t('settings.providers')}</h3>
          <p className="text-[11px] text-d4-dimmed mt-0.5">
            {t('providers.summary', { vendors: inUse.length, models: modelCount })}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('providers.searchPlaceholder')}
            className="w-40 bg-d4-panel border border-d4-border rounded px-2 py-1 text-[11px] text-d4-text outline-none focus:border-d4-accent"
          />
          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-d4-surface border border-d4-border hover:bg-d4-subtle text-d4-text rounded text-[11px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('providers.addProvider')}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || isSaving}
            className="flex items-center space-x-1 px-3 py-1 bg-d4-accent hover:bg-d4-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded text-[11px]"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{t('settings.save')}</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {shown.map((group) => (
          <VendorCard
            key={group.id}
            group={group}
            drafts={drafts}
            onDraftChange={(configId, next) => setDrafts((prev) => ({ ...prev, [configId]: next }))}
            onKeySaved={applyProviders}
            onProvidersChanged={applyProviders}
          />
        ))}

        {shown.length === 0 && (
          <div className="text-center py-10 text-d4-dimmed text-xs">
            {filter.trim() ? t('providers.noMatch') : t('providers.noneInUse')}
          </div>
        )}
      </div>

      {/* Everything that ships a preset but has no key and no working connection
          stays out of the way — but reachable, so a provider the user disabled
          by accident is not something they have to guess how to get back. */}
      {unused.length > 0 && !filter.trim() && (
        <button
          onClick={() => setShowUnused((v) => !v)}
          className="w-full flex items-center justify-center space-x-1.5 px-2 py-1.5 border border-dashed border-d4-border rounded text-[11px] text-d4-dimmed hover:text-d4-text hover:border-d4-dimmed"
        >
          {showUnused ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>{showUnused ? t('providers.hideUnused') : t('providers.showUnused', { count: unused.length })}</span>
        </button>
      )}

      <AddProviderDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        existingIds={providers.map((p) => p.id)}
        onAdded={(providers) => {
          applyProviders(providers);
          setIsAddOpen(false);
          toast.success(t('providers.added'));
        }}
      />
    </div>
  );
};
