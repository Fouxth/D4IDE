import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UsageRecord } from '../../../shared/types';
import { formatRelativeTime, formatTokens, formatUsd } from '../../lib/format';

/**
 * The report each finished request left behind.
 *
 * "What did that run do, and what did it cost" is one question, so the answer
 * belongs beside the cost — not as a card in the middle of the conversation the
 * user is reading. The request is the headline, the model's report is the body,
 * and both live on the same usage row, which is why this takes records rather
 * than reading a store of its own. Collapsed by default: several long reports
 * unfolded at once would bury the numbers above them.
 *
 * Shared by the right-sidebar panel and Settings → Usage, so the two views can
 * never disagree about what a request reported.
 */
export const RunReports: React.FC<{ records: UsageRecord[] }> = ({ records }) => {
  const { t } = useTranslation();
  const reported = records.filter((record) => !!record.summary);
  if (reported.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center space-x-1.5 text-d4-dimmed text-[11px] uppercase font-semibold">
        <ClipboardCheck className="w-3.5 h-3.5" />
        <span>{t('usage.runSummaries')}</span>
      </div>
      <div className="text-[10px] text-d4-dimmed leading-snug">{t('usage.runSummariesHint')}</div>
      {reported.slice(0, 5).map((record) => (
        <details key={record.id} className="bg-d4-surface border border-d4-border/70 rounded px-2.5 py-2">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-d4-text truncate">
                {record.summaryRequest || record.modelName || record.modelId}
              </span>
              <span className="font-mono text-d4-dimmed shrink-0">{formatUsd(record.estimatedCost)}</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-d4-dimmed mt-0.5">
              <span>
                {formatRelativeTime(record.timestamp)} · {record.modelName || record.modelId}
              </span>
              <span className="font-mono">
                {formatTokens(record.inputTokens)}/{formatTokens(record.outputTokens)}
              </span>
            </div>
          </summary>
          <pre className="mt-2 pt-2 border-t border-d4-border/60 text-[11px] leading-relaxed text-d4-muted whitespace-pre-wrap font-sans">
            {record.summary}
          </pre>
        </details>
      ))}
    </div>
  );
};
