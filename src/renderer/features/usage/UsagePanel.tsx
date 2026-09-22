import React, { useEffect } from 'react';
import { RefreshCw, DollarSign } from 'lucide-react';
import { RunReports } from './RunReports';
import { useTranslation } from 'react-i18next';
import { useUsageStore } from '../../stores/usageStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatTokens, formatUsd, formatRelativeTime } from '../../lib/format';
import { UsageAggregate } from '../../../shared/types';

const AggregateRow: React.FC<{ label: string; value: UsageAggregate }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1 border-b border-d4-border/40 text-[11px]">
    <span className="text-d4-muted">{label}</span>
    <span className="font-mono text-d4-text">
      {formatTokens(value.inputTokens + value.outputTokens)} tok · {formatUsd(value.cost)}
    </span>
  </div>
);

export const UsagePanel: React.FC = () => {
  const { t } = useTranslation();
  const { summary, load, isLoading } = useUsageStore();

  useEffect(() => {
    load();
  }, [load]);

  if (!summary) {
    return <div className="text-center py-10 text-d4-dimmed text-xs">{t('usage.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
        <span className="flex items-center space-x-1.5">
          <DollarSign className="w-3.5 h-3.5" />
          <span>{t('usage.session')}</span>
        </span>
        <button onClick={() => load()} className="text-d4-dimmed hover:text-d4-text" title={t('usage.refresh')}>
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold text-d4-text font-mono">{formatUsd(summary.session.cost)}</span>
          <span className="text-[10px] text-d4-dimmed">{t('usage.estimated')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          {[
            { label: t('usage.input'), value: summary.session.inputTokens },
            { label: t('usage.output'), value: summary.session.outputTokens },
            { label: t('usage.cached'), value: summary.session.cachedInputTokens }
          ].map((item) => (
            <div key={item.label} className="text-center bg-d4-panel rounded py-1.5 border border-d4-border/60">
              <div className="text-[10px] text-d4-dimmed">{item.label}</div>
              <div className="font-mono text-xs text-d4-text">{formatTokens(item.value)}</div>
            </div>
          ))}
        </div>
      </div>

      <RunReports records={summary.recent} />

      <div className="space-y-0.5">
        <AggregateRow label={t('usage.today')} value={summary.today} />
        <AggregateRow label={t('usage.month')} value={summary.month} />
        <AggregateRow label={t('usage.allTime')} value={summary.allTime} />
      </div>

      {summary.byModel.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('usage.byModel')}</div>
          {summary.byModel.slice(0, 5).map((bucket) => (
            <div key={bucket.key} className="flex items-center justify-between text-[11px]">
              <span className="text-d4-text truncate max-w-[150px]">{bucket.label}</span>
              <span className="font-mono text-d4-muted">
                {formatUsd(bucket.cost)} · {formatTokens(bucket.totalTokens)}
              </span>
            </div>
          ))}
        </div>
      )}

      {summary.recent.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('usage.recent')}</div>
          {summary.recent.slice(0, 6).map((record) => (
            <div key={record.id} className="bg-d4-surface/60 border border-d4-border/60 rounded px-2 py-1.5 space-y-0.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-d4-text truncate max-w-[140px]">{record.modelName || record.modelId}</span>
                <span className="font-mono text-d4-muted">{formatUsd(record.estimatedCost)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-d4-dimmed">
                <span>{formatRelativeTime(record.timestamp)}</span>
                <span className="font-mono">
                  {formatTokens(record.inputTokens)}/{formatTokens(record.outputTokens)}
                  {record.cachedInputTokens ? ` · ${formatTokens(record.cachedInputTokens)} cached` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
