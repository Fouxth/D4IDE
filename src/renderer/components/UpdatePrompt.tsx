import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, ChevronRight, RefreshCw, Sparkles, X } from 'lucide-react';
import { releaseSummary } from '../../shared/update-policy';
import { updatePromptView, UpdatePromptAction } from '../../shared/update-prompt';
import { RELEASES_URL } from '../../shared/version';
import { useUpdateStore } from '../stores/updateStore';
import { useAgentStore } from '../stores/agentStore';
import { toast } from '../stores/toastStore';

/**
 * The update offer, in the corner, with a progress bar.
 *
 * Bottom-right and dismissible on purpose: an update is never urgent enough to
 * cover the work. Every path through it is a click — the two buttons in the
 * "available" state differ only in what happens *after* the download finishes.
 *
 * When an install is blocked (an agent run is in flight) the reason is shown
 * where the button is, instead of a request going out and failing silently.
 */
export const UpdatePrompt: React.FC = () => {
  const { t } = useTranslation();
  const { status, busy, dismissedVersion, autoInstall, attempted, download, updateAndRestart, install, dismiss } =
    useUpdateStore();
  const { status: agentStatus } = useAgentStore();
  const [expanded, setExpanded] = useState(false);

  const agentBusy = agentStatus === 'running' || agentStatus === 'planning' || agentStatus === 'waiting_approval';
  const view = updatePromptView(status, { dismissedVersion, busy, agentBusy, attempted });
  if (!view.visible) return null;

  const notes = releaseSummary(status.notes);

  /** Closing is "not now": the version stays offered in the status bar. */
  const later = () => {
    if (view.version) dismiss(view.version);
    toast.info(t('update.dismissedHint'));
  };

  const labelFor = (action: UpdatePromptAction): string => {
    if (action === 'update') return t('update.promptUpdate');
    if (action === 'updateAndRestart') return t('update.promptUpdateAndRestart');
    if (action === 'restart') return t('update.promptRestart');
    if (action === 'retry') return t('update.promptRetry');
    return t('update.promptLater');
  };

  const runFor = (action: UpdatePromptAction) => {
    if (action === 'update' || action === 'retry') return void download();
    if (action === 'updateAndRestart') return void updateAndRestart();
    if (action === 'restart') return void install();
    return later();
  };

  const title =
    view.kind === 'available'
      ? t('update.promptTitle', { version: view.version })
      : view.kind === 'downloading'
        ? t('update.promptDownloading', { percent: view.percent })
        : view.kind === 'ready'
          ? t('update.promptReady', { version: view.version })
          : t('update.promptFailed');

  const icon =
    view.kind === 'failed' ? (
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
    ) : view.kind === 'ready' ? (
      <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
    ) : (
      <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-d4-accent" />
    );

  return (
    <div
      role="dialog"
      aria-label={t('update.promptAria')}
      className="fixed bottom-9 right-3 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-md border border-d4-border bg-d4-panel shadow-2xl"
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        {icon}

        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-d4-text font-semibold leading-snug">{title}</div>

          {view.kind === 'downloading' ? (
            <div className="mt-2 flex items-center gap-2">
              <div
                className="flex-1 h-1.5 rounded-full bg-d4-border overflow-hidden"
                role="progressbar"
                aria-valuenow={view.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-d4-accent transition-[width] duration-300" style={{ width: `${view.percent}%` }} />
              </div>
              <span data-testid="update-percent" className="text-[11px] text-d4-muted font-mono shrink-0">
                {view.percent}%
              </span>
            </div>
          ) : notes ? (
            <div className="text-[11px] text-d4-muted mt-0.5 truncate" title={notes}>
              {notes}
            </div>
          ) : null}

          {autoInstall && view.kind === 'downloading' ? (
            <div className="text-[11px] text-d4-dimmed mt-1">{t('update.willRestartWhenDone')}</div>
          ) : null}

          {view.blocked === 'agent' && view.actions.includes('restart') ? (
            <div className="text-[11px] text-amber-400 mt-1">{t('update.agentBusy')}</div>
          ) : null}

          {view.kind === 'failed' && status.error ? (
            <div className="text-[11px] text-red-400/90 mt-1 break-words" title={status.error}>
              {status.error}
            </div>
          ) : null}

          {view.kind === 'available' && status.notes ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 flex items-center gap-1 text-[11px] text-d4-dimmed hover:text-d4-text"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {t('update.details')}
            </button>
          ) : null}

          {expanded && status.notes ? (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-d4-muted border-l-2 border-d4-border pl-2">
              {status.notes}
            </pre>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {view.actions.map((action) => {
              const primary = action === 'update' || action === 'restart' || action === 'retry';
              const needsAgentIdle = action === 'restart' || action === 'updateAndRestart';
              const disabled = busy || (needsAgentIdle && agentBusy);
              const title = needsAgentIdle && agentBusy ? t('update.agentBusy') : undefined;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  title={title}
                  onClick={() => runFor(action)}
                  className={
                    primary
                      ? 'px-2.5 py-1 rounded-sm bg-d4-accent text-black text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed'
                      : 'px-2.5 py-1 rounded-sm border border-d4-border text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-40 disabled:cursor-not-allowed'
                  }
                >
                  {labelFor(action)}
                </button>
              );
            })}

            {view.kind === 'downloading' ? (
              <span className="text-[11px] text-d4-dimmed flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {t('update.downloadingShort')}
              </span>
            ) : null}
          </div>

          {view.kind === 'ready' ? (
            <div className="text-[11px] text-d4-dimmed mt-1">{t('update.laterKeepsUpdate')}</div>
          ) : null}

          <button
            type="button"
            onClick={() => void window.electronAPI?.openExternal(RELEASES_URL)}
            className="mt-1 text-[10px] text-d4-dimmed hover:text-d4-text underline decoration-dotted"
          >
            {t('update.openReleases')}
          </button>
        </div>

        <button
          type="button"
          onClick={later}
          title={t('update.dismiss')}
          aria-label={t('update.dismiss')}
          className="p-1 rounded-sm text-d4-dimmed hover:text-d4-text shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
