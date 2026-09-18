import React, { useEffect, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';

/**
 * Crash recovery (spec §84). When the app restarts after being closed mid-run,
 * the last session never marked itself finished, so it is offered back instead
 * of being silently abandoned.
 */
export const SessionRecoveryBanner: React.FC = () => {
  const { t } = useTranslation();
  const { recoverableSession, resumeSession, dismissRecovery } = useAgentStore();
  const [busy, setBusy] = useState(false);

  // Checked once per app start, after the stores are ready.
  const checkForRecovery = useAgentStore((state) => state.checkForRecovery);
  useEffect(() => {
    void checkForRecovery();
  }, [checkForRecovery]);

  if (!recoverableSession) return null;

  const { session, events } = recoverableSession;

  return (
    <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs select-none">
      <div className="flex items-center space-x-2 min-w-0">
        <History className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="min-w-0">
          <div className="text-amber-300 font-semibold truncate">{t('agent.recoveryTitle')}</div>
          <div className="text-d4-muted truncate">
            {session.title} · {t('agent.recoveryMeta', { events })}
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await resumeSession(session.id);
            setBusy(false);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-sm bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors disabled:opacity-50"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>{t('agent.recoveryResume')}</span>
        </button>
        <button
          onClick={dismissRecovery}
          title={t('agent.recoveryDismiss')}
          className="p-1.5 rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-subtle/60 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
