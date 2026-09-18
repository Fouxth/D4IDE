import React from 'react';
import { FileWarning, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../stores/projectStore';

/**
 * Crash recovery for unsaved editor buffers (spec §84).
 *
 * The alternative — silently reopening the file from disk — is how people lose
 * an hour of work, so this asks first and always shows which files are involved.
 */
export const BufferRecoveryBanner: React.FC = () => {
  const { t } = useTranslation();
  const { recoveredBuffers, restoreRecoveredBuffers, dismissRecoveredBuffers } = useProject((s) => ({
    recoveredBuffers: s.recoveredBuffers,
    restoreRecoveredBuffers: s.restoreRecoveredBuffers,
    dismissRecoveredBuffers: s.dismissRecoveredBuffers
  }));

  if (recoveredBuffers.length === 0) return null;

  return (
    <div className="shrink-0 flex items-start gap-3 px-3 py-2 bg-d4-warning/10 border-b border-d4-warning/30 text-[11px]">
      <FileWarning className="w-4 h-4 text-d4-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-semibold text-d4-warning">{t('recovery.buffersTitle')}</div>
        <div className="text-d4-muted">
          {t('recovery.buffersBody', { count: recoveredBuffers.length })}
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-d4-dimmed">
          {recoveredBuffers.slice(0, 6).map((buffer) => (
            <span key={buffer.path} className="px-1.5 py-0.5 rounded-sm bg-d4-surface border border-d4-border">
              {buffer.relativePath}
            </span>
          ))}
          {recoveredBuffers.length > 6 && <span className="self-center">+{recoveredBuffers.length - 6}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => void restoreRecoveredBuffers()}
          className="px-2.5 py-1 rounded-sm bg-d4-accent text-black font-semibold text-[11px]"
        >
          {t('recovery.restore')}
        </button>
        <button
          onClick={() => void dismissRecoveredBuffers()}
          title={t('recovery.discard')}
          className="p-1 text-d4-dimmed hover:text-d4-text"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
