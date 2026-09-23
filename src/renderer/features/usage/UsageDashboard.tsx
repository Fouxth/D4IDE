import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUsageStore } from '../../stores/usageStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { formatTokens, formatUsd, formatRelativeTime, formatDuration } from '../../lib/format';
import { UsageBucket } from '../../../shared/types';
import {
  auditTeamSeats,
  buildTeamFromPreset,
  isTeamConfigured,
  TEAM_PRESETS,
  TEAM_ROLES,
  TEAM_ROLE_LABEL,
  TEAM_ROLE_DESC,
  parseAssignment,
  type SeatCandidate,
  type TeamPresetId,
  type TeamRole
} from '../../../shared/ai-team';
import { RunReports } from './RunReports';

const BucketTable: React.FC<{ title: string; buckets: UsageBucket[] }> = ({ title, buckets }) => {
  const { t } = useTranslation();
  if (buckets.length === 0) return null;

  const maxCost = Math.max(...buckets.map((b) => b.cost), 0.000001);

  return (
    <div className="space-y-1.5">
      <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{title}</div>
      <div className="bg-d4-surface border border-d4-border rounded overflow-hidden">
        {buckets.slice(0, 10).map((bucket, index) => (
          <div
            key={bucket.key}
            className={`flex items-center justify-between px-3 py-1.5 text-[11px] ${
              index % 2 === 0 ? 'bg-transparent' : 'bg-d4-panel/40'
            }`}
          >
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              <span className="text-d4-text truncate max-w-[260px]">{bucket.label}</span>
              <div className="flex-1 h-1 bg-d4-subtle rounded-full overflow-hidden max-w-[120px]">
                <div className="h-full bg-d4-accent/60" style={{ width: `${(bucket.cost / maxCost) * 100}%` }} />
              </div>
            </div>
            <div className="flex items-center space-x-3 shrink-0 font-mono text-d4-muted">
              <span>{bucket.requests} req</span>
              <span>{formatTokens(bucket.totalTokens)}</span>
              <span className="text-d4-text">{formatUsd(bucket.cost)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-d4-dimmed">{t('usage.scopeNote')}</p>
    </div>
  );
};

export const UsageDashboard: React.FC<{
  /** True when the page above already carries this heading (Settings → General). */
  embedded?: boolean;
}> = ({ embedded }) => {
  const { t } = useTranslation();
  const { summary, load, reset, isLoading } = useUsageStore();
  const { settings, updateSettings, providers } = useSettingsStore();
  const [exporting, setExporting] = useState(false);
  // Team-seat labels follow the app language, not the browser.
  const lang: 'th' | 'en' = settings?.language === 'en' ? 'en' : 'th';

  useEffect(() => {
    load();
  }, [load]);

  /** Every model the user's *enabled* providers expose — the pool a preset may fill seats from. */
  const seatCandidates = useMemo<SeatCandidate[]>(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, modelId: model.id, model }))),
    [providers]
  );

  /** Stale-seat audit: seats pointing at disabled providers, dropped models, typos.
   * Depends on the seat *strings*, not the settings object — some update paths
   * (the demo bridge) mutate settings in place, and an object-identity memo
   * would keep showing a stale audit. */
  const aiTeam = settings?.aiTeam;
  const seatAudit = useMemo(
    () => auditTeamSeats(aiTeam, providers),
    [aiTeam?.planner, aiTeam?.analyst, aiTeam?.executor, providers]
  );

  if (!summary || !settings) {
    return <div className="text-center py-10 text-d4-dimmed text-xs">{t('usage.loading')}</div>;
  }

  const applyPreset = (preset: TeamPresetId) => {
    const team = buildTeamFromPreset(preset, seatCandidates);
    if (!team) {
      toast.info(t('usage.aiTeamNoCandidates'));
      return;
    }
    updateSettings({ aiTeam: team });
    if (isTeamConfigured(team)) toast.success(t('usage.aiTeamApplied'));
  };

  const applySuggestion = (role: TeamRole, suggestion: { providerId: string; modelId: string }) => {
    const current = settings?.aiTeam ?? { planner: '', analyst: '', executor: '' };
    updateSettings({ aiTeam: { ...current, [role]: `${suggestion.providerId}:${suggestion.modelId}` } });
    toast.success(t('usage.aiTeamApplied'));
  };

  const totals = [
    { label: t('usage.today'), value: summary.today },
    { label: t('usage.month'), value: summary.month },
    { label: t('usage.allTime'), value: summary.allTime }
  ];

  const handleExport = async () => {
    setExporting(true);
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        summary,
        settings: {
          thriftMode: settings.thriftMode,
          contextTokenBudget: settings.contextTokenBudget,
          runTokenBudget: settings.runTokenBudget
        }
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `d4ide-usage-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t('usage.exported'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 select-text">
      <div className="flex items-center justify-between">
        <div>
          {!embedded && (
            <>
              <h3 className="text-sm font-semibold text-d4-text">{t('usage.title')}</h3>
              <p className="text-[11px] text-d4-dimmed mt-0.5">{t('usage.subtitle')}</p>
            </>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => load()}
            className="flex items-center space-x-1 px-2 py-1 bg-d4-surface border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t('usage.refresh')}</span>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center space-x-1 px-2 py-1 bg-d4-surface border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('usage.export')}</span>
          </button>
          <button
            onClick={async () => {
              await reset();
              toast.info(t('usage.resetDone'));
            }}
            className="flex items-center space-x-1 px-2 py-1 bg-d4-surface border border-d4-border rounded text-[11px] text-red-400/80 hover:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('usage.reset')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {totals.map((item) => (
          <div key={item.label} className="bg-d4-surface border border-d4-border rounded-md p-3 space-y-1">
            <div className="text-[10px] uppercase text-d4-dimmed">{item.label}</div>
            <div className="text-lg font-semibold font-mono text-d4-text">{formatUsd(item.value.cost)}</div>
            <div className="text-[10px] text-d4-muted font-mono">
              {item.value.requests} req · {formatTokens(item.value.inputTokens + item.value.outputTokens)} tok
            </div>
            <div className="text-[10px] text-d4-dimmed font-mono">
              in {formatTokens(item.value.inputTokens)} · out {formatTokens(item.value.outputTokens)} · cached{' '}
              {formatTokens(item.value.cachedInputTokens)}
            </div>
          </div>
        ))}
      </div>

      {/* Token economy: the dials `/thrift` actually moves. */}
      <div className="bg-d4-surface border border-d4-border rounded-md p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase font-semibold text-d4-dimmed">{t('usage.tokenEconomy')}</div>
          <label className="flex items-center space-x-1.5 text-[11px] text-d4-muted cursor-pointer">
            <input
              type="checkbox"
              checked={!!settings.thriftMode}
              onChange={(e) => updateSettings({ thriftMode: e.target.checked })}
              className="accent-teal-500 w-3 h-3"
            />
            <span>{t('usage.thriftMode')}</span>
          </label>
        </div>
        <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('usage.thriftHint')}</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-d4-dimmed uppercase">{t('usage.contextBudget')}</span>
            <input
              type="number"
              step="4000"
              min={4000}
              value={settings.contextTokenBudget || 48000}
              onChange={(e) => updateSettings({ contextTokenBudget: parseInt(e.target.value, 10) || 48000 })}
              className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none"
            />
            <span className="text-[10px] text-d4-dimmed">{t('usage.contextBudgetHint')}</span>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-d4-dimmed uppercase">{t('usage.runBudget')}</span>
            <input
              type="number"
              step="50000"
              min={0}
              value={settings.runTokenBudget || 0}
              onChange={(e) => updateSettings({ runTokenBudget: parseInt(e.target.value, 10) || 0 })}
              className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none"
            />
            <span className="text-[10px] text-d4-dimmed">{t('usage.runBudgetHint')}</span>
          </label>
        </div>

        <label className="flex items-center space-x-1.5 text-[11px] text-d4-muted cursor-pointer">
          <input
            type="checkbox"
            checked={!!settings.cheaperModelForSmallTasks}
            onChange={(e) => updateSettings({ cheaperModelForSmallTasks: e.target.checked })}
            className="accent-teal-500 w-3 h-3"
          />
          <span>{t('usage.cheapModel')}</span>
        </label>
        <input
          type="text"
          value={settings.cheapModelId || ''}
          onChange={(e) => updateSettings({ cheapModelId: e.target.value })}
          placeholder={t('usage.cheapModelPlaceholder')}
          className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none focus:border-d4-accent"
        />
      </div>

      {/* The AI team: one job, three seats. A seat left empty keeps the main
          model, so the whole card is inert until someone types in it. */}
      <div className="bg-d4-surface border border-d4-border rounded-md p-3 space-y-3">
        <div className="text-[11px] uppercase font-semibold text-d4-dimmed">{t('usage.aiTeam')}</div>
        <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('usage.aiTeamHint')}</p>

        {/* Presets: one click, all three seats. The picker reads the user's own
            provider catalogue, so a preset can only ever fill seats the user
            actually has — and with no tool-capable model, there is nothing
            honest to fill in, so the row goes inert instead of guessing. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase text-d4-dimmed mr-0.5">{t('usage.aiTeamPresets')}</span>
          {TEAM_PRESETS.map((preset) => {
            const isClear = preset === 'clear';
            const disabled = !isClear && seatCandidates.length === 0;
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                title={t(`usage.aiTeamPreset${preset[0].toUpperCase()}${preset.slice(1)}Desc`)}
                onClick={() => applyPreset(preset)}
                className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                  isClear
                    ? 'border-d4-border text-d4-dimmed hover:text-d4-text hover:border-d4-dimmed'
                    : 'border-d4-accent/40 text-d4-accent hover:bg-d4-accent/10'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {t(`usage.aiTeamPreset${preset[0].toUpperCase()}${preset.slice(1)}`)}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {TEAM_ROLES.map((role) => {
            const value = settings.aiTeam?.[role] ?? '';
            const issue = seatAudit.find((i) => i.role === role);
            const invalid = issue && issue.kind !== 'empty' && issue.kind !== 'ok';
            return (
              <div key={role} className="grid grid-cols-[110px_1fr] gap-2 items-center">
                <div title={TEAM_ROLE_DESC[role][lang]} className="text-[11px] text-d4-muted truncate">
                  {TEAM_ROLE_LABEL[role][lang]}
                </div>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      updateSettings({ aiTeam: { ...(settings.aiTeam ?? { planner: '', analyst: '', executor: '' }), [role]: e.target.value } })
                    }
                    placeholder={t('usage.aiTeamPlaceholder')}
                    className={`w-full bg-d4-panel border rounded px-2 py-1.5 text-xs font-mono text-d4-text outline-none ${
                      invalid ? 'border-red-500/70 focus:border-red-500' : 'border-d4-border focus:border-d4-accent'
                    }`}
                  />
                  {issue && invalid && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90">
                      <span className="min-w-0 truncate">
                        {issue.suggestion
                          ? t(`usage.aiTeamIssue${issue.kind[0].toUpperCase()}${issue.kind.slice(1)}`, { seat: issue.value })
                          : t('usage.aiTeamIssueNoFix')}
                      </span>
                      {issue.suggestion && (
                        <button
                          type="button"
                          onClick={() => applySuggestion(role, issue.suggestion!)}
                          title={`${issue.suggestion.providerId}:${issue.suggestion.modelId}`}
                          className="px-1.5 py-px rounded-full border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 shrink-0 transition-colors"
                        >
                          {t('usage.aiTeamFixTo', { model: `${issue.suggestion.providerId}:${issue.suggestion.modelId}` })}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {seatCandidates.length === 0 && (
          <p className="text-[10px] text-amber-400/90">{t('usage.aiTeamNoCandidates')}</p>
        )}
        <p className="text-[10px] text-d4-dimmed">{t('usage.aiTeamFallbackNote')}</p>
      </div>

      <RunReports records={summary.recent} />

      <BucketTable title={t('usage.byProvider')} buckets={summary.byProvider} />
      <BucketTable title={t('usage.byModel')} buckets={summary.byModel} />
      <BucketTable title={t('usage.byProject')} buckets={summary.byProject} />

      <div className="space-y-1.5">
        <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('usage.recent')}</div>
        {summary.recent.length === 0 ? (
          <div className="text-center py-6 text-d4-dimmed text-xs">{t('usage.noRequests')}</div>
        ) : (
          <div className="bg-d4-surface border border-d4-border rounded overflow-hidden">
            <div className="grid grid-cols-[1fr_90px_80px_80px_70px] gap-2 px-3 py-1.5 text-[10px] uppercase text-d4-dimmed border-b border-d4-border">
              <span>{t('usage.model')}</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Cached</span>
              <span className="text-right">Cost</span>
              <span className="text-right">When</span>
            </div>
            {summary.recent.map((record) => (
              <div
                key={record.id}
                className="grid grid-cols-[1fr_90px_80px_80px_70px] gap-2 px-3 py-1.5 text-[11px] border-b border-d4-border/40 last:border-0"
              >
                <span className="truncate text-d4-text">
                  {record.modelName || record.modelId}
                  <span className="text-d4-dimmed"> · {record.providerName || record.providerId}</span>
                  {record.mode && <span className="text-d4-dimmed"> · {record.mode}</span>}
                  {record.status !== 'completed' && <span className="text-amber-400"> · {record.status}</span>}
                  {record.durationMs ? <span className="text-d4-dimmed"> · {formatDuration(record.durationMs)}</span> : null}
                </span>
                <span className="text-right font-mono text-d4-muted">
                  {formatTokens(record.inputTokens)}/{formatTokens(record.outputTokens)}
                </span>
                <span className="text-right font-mono text-d4-dimmed">{formatTokens(record.cachedInputTokens || 0)}</span>
                <span className="text-right font-mono text-d4-text">{formatUsd(record.estimatedCost)}</span>
                <span className="text-right text-d4-dimmed">{formatRelativeTime(record.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
