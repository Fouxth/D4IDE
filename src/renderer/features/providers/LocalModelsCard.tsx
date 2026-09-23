import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, HardDrive, Plus, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { formatBytes, seatsHolding, toLocalModelEntries, type LocalModelEntry } from '../../../shared/local-models';
import { TEAM_ROLE_LABEL, type TeamRole } from '../../../shared/ai-team';
import { groupProviders, isProviderChoosable } from '../../../shared/provider-vendors';
import { formatPrice } from '../../lib/format';

interface InventoryResponse {
  answers: Array<{ providerId: string; models: Array<{ id?: string; name?: string; sizeBytes?: number; detail?: string }> }>;
  fetchedAt: number;
}

/**
 * The "my local models" card — one place that answers "what do I have on this
 * machine, how big is it, and who on the AI team is using it". Sitting inside
 * the provider hub keeps it next to the runtime cards it reports on; the team
 * seats it writes are the same `provider:model` strings the usage card edits.
 */
export const LocalModelsCard: React.FC = () => {
  const { t } = useTranslation();
  const { settings, providers, updateSettings } = useSettingsStore();
  const [entries, setEntries] = useState<LocalModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const lang: 'th' | 'en' = settings?.language === 'en' ? 'en' : 'th';
  const aiTeam = settings?.aiTeam;
  // Depend on the seat strings, not the settings object: some update paths
  // mutate the existing object, and a memo keyed on the reference never
  // re-runs (the same trap the seat-audit fell into once).
  const teamKey = `${aiTeam?.planner ?? ''}|${aiTeam?.analyst ?? ''}|${aiTeam?.executor ?? ''}`;

  // The "add another model" row draws from the full picker pool — the same
  // groups the composer's model menu shows — because the machine's own runtime
  // list is short but the team is not limited to it.
  const activeIds = useMemo(() => providers.filter((p) => p.enabled).map((p) => p.id), [providers]);
  const pickerGroups = useMemo(
    () =>
      groupProviders(
        providers.filter((p) => isProviderChoosable(p, activeIds, { localProvidersEnabled: settings?.localProvidersEnabled })),
        { activeProviderIds: activeIds }
      ),
    [providers, activeIds, settings?.localProvidersEnabled]
  );
  const [addSeat, setAddSeat] = useState<TeamRole>('planner');
  const [addValue, setAddValue] = useState('');

  const load = useCallback(async () => {
    if (!window.electronAPI?.listLocalModels) return;
    setLoading(true);
    try {
      const inventory = (await window.electronAPI.listLocalModels()) as InventoryResponse;
      setEntries(toLocalModelEntries(inventory.answers));
      setFetchedAt(inventory.fetchedAt ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  // The card answers when it is seen, and again on the visible refresh button.
  useEffect(() => {
    void load();
  }, [load]);

  const holding = useMemo(() => {
    const team = aiTeam ?? { planner: '', analyst: '', executor: '' };
    const map = new Map<string, TeamRole[]>();
    for (const entry of entries) map.set(entry.seat, seatsHolding(team, entry.seat));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, teamKey]);

  const assign = async (entry: LocalModelEntry, role: TeamRole) => {
    const current = settings?.aiTeam ?? { planner: '', analyst: '', executor: '' };
    const next = { ...current, [role]: current[role] === entry.seat ? '' : entry.seat };
    await updateSettings({ aiTeam: next });
    toast.success(
      current[role] === entry.seat
        ? t('localModels.seatCleared', { role: TEAM_ROLE_LABEL[role][lang] })
        : t('localModels.seatSet', { role: TEAM_ROLE_LABEL[role][lang], model: entry.modelId })
    );
  };

  return (
    <div className="border border-d4-border rounded-md bg-d4-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-d4-border-subtle">
        <div className="flex items-center gap-1.5 min-w-0">
          <HardDrive className="w-3.5 h-3.5 text-d4-muted shrink-0" />
          <span className="text-[12px] font-medium text-d4-text">{t('localModels.title')}</span>
          {entries.length > 0 && <span className="text-[11px] text-d4-dimmed">{entries.length}</span>}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-d4-muted hover:text-d4-text hover:bg-d4-hover transition-colors disabled:opacity-50"
          title={t('localModels.refresh')}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t('localModels.refresh')}
        </button>
      </div>

      {failed ? (
        <div className="px-3 py-3 text-[11px] text-red-400">{t('localModels.loadFailed')}</div>
      ) : loaded && entries.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-d4-muted">
          <div>{t('localModels.empty')}</div>
          {/* The empty state is where a first-time local-LLM user actually is:
              they downloaded a .gguf and nothing answered. The import paths
              belong right here, not in docs. */}
          <details className="mt-2 group">
            <summary className="cursor-pointer select-none text-[11px] text-d4-text hover:text-d4-bright transition-colors">
              {t('localModels.ggufTitle')}
            </summary>
            <div className="mt-1.5 space-y-1.5 pl-3 border-l border-d4-border-subtle">
              <p className="text-d4-muted">{t('localModels.ggufOllama')}</p>
              <p className="text-d4-muted">{t('localModels.ggufLmstudio')}</p>
              <p className="text-d4-dimmed">{t('localModels.ggufNote')}</p>
            </div>
          </details>
        </div>
      ) : (
        <div className="divide-y divide-d4-border-subtle">
          {entries.map((entry) => {
            const roles = holding.get(entry.seat) ?? [];
            const size = formatBytes(entry.sizeBytes);
            return (
              <div key={entry.seat} className="px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[12px] text-d4-text font-mono truncate">{entry.modelId}</span>
                  {entry.detail && <span className="text-[10px] text-d4-dimmed truncate hidden sm:inline">{entry.detail}</span>}
                  <span className="flex-1" />
                  <span className="text-[11px] text-d4-dimmed whitespace-nowrap">
                    {size ?? <span className="text-d4-faint">{t('localModels.sizeUnknown')}</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {(['planner', 'analyst', 'executor'] as TeamRole[]).map((role) => {
                    const active = roles.includes(role);
                    return (
                      <button
                        key={role}
                        onClick={() => void assign(entry, role)}
                        title={t('localModels.seatToggleHint', { role: TEAM_ROLE_LABEL[role][lang] })}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                          active
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400'
                            : 'border-d4-border text-d4-muted hover:text-d4-text hover:border-d4-dimmed'
                        }`}
                      >
                        {active && <Check className="w-2.5 h-2.5" />}
                        {TEAM_ROLE_LABEL[role][lang]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add any pickable model to a seat — the machine's runtime list is
          what answered, but the team is not limited to it. */}
      {pickerGroups.length > 0 && (
        <div className="px-3 py-2 border-t border-d4-border-subtle">
          <div className="flex items-center gap-1.5">
            <Plus className="w-3 h-3 text-d4-muted shrink-0" />
            <select
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="flex-1 min-w-0 bg-d4-bg border border-d4-border rounded px-1.5 py-1 text-[11px] text-d4-text focus:outline-none focus:border-d4-accent"
            >
              <option value="">{t('localModels.addPlaceholder')}</option>
              {pickerGroups.map((group) =>
                group.models.length > 0 ? (
                  <optgroup key={group.id} label={group.name}>
                    {group.models.map(({ model }) => (
                      <option key={`${group.id}:${model.id}`} value={`${group.id}:${model.id}`}>
                        {model.name || model.id}
                        {(model.inputPricePerMillion ?? model.outputPricePerMillion ?? 0) > 0
                          ? ` — ${formatPrice(model.inputPricePerMillion)}/${formatPrice(model.outputPricePerMillion)}/1M`
                          : ' — local'}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              )}
            </select>
            <select
              value={addSeat}
              onChange={(e) => setAddSeat(e.target.value as TeamRole)}
              className="bg-d4-bg border border-d4-border rounded px-1.5 py-1 text-[11px] text-d4-text focus:outline-none focus:border-d4-accent"
            >
              {(['planner', 'analyst', 'executor'] as TeamRole[]).map((role) => (
                <option key={role} value={role}>
                  {TEAM_ROLE_LABEL[role][lang]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addValue}
              onClick={() => {
                const current = settings?.aiTeam ?? { planner: '', analyst: '', executor: '' };
                void updateSettings({ aiTeam: { ...current, [addSeat]: addValue } }).then(() => {
                  toast.success(t('localModels.seatSet', { role: TEAM_ROLE_LABEL[addSeat][lang], model: addValue.split(':').slice(1).join(':') }));
                  setAddValue('');
                });
              }}
              className="px-2 py-1 rounded text-[11px] font-medium bg-d4-accent text-black hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {t('localModels.addApply')}
            </button>
          </div>
        </div>
      )}

      {fetchedAt !== null && entries.length > 0 && (
        <div className="px-3 py-1.5 border-t border-d4-border-subtle text-[10px] text-d4-faint">
          {t('localModels.checkedAt', { time: new Date(fetchedAt).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US') })}
        </div>
      )}
    </div>
  );
};
