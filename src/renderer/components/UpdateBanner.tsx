import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, RotateCcw, X, Sparkles, ExternalLink } from 'lucide-react';
import { releaseSummary } from '../../shared/update-policy';
import { RELEASES_URL } from '../../shared/version';
import { useUpdateStore } from '../stores/updateStore';
import { useAgentStore } from '../stores/agentStore';
import { toast } from '../stores/toastStore';

/**
 * Says a newer build exists, and then waits.
 *
 * The whole design is in what is *not* here: no countdown, no automatic
 * download, no "restart now" that happens on its own. Two steps on purpose —
 * download, then the user decides again whether to restart, because restarting
 * is the moment that loses whatever is on screen.
 *
 * It hides itself once the user closes it or skips the version, and comes back
 * for the next version: skipping must not mean never being told again.
 */
export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, busy, dismissedVersion, download, install, skipVersion, dismiss } = useUpdateStore();
  const { status: agentStatus } = useAgentStore();
  const [expanded, setExpanded] = useState(false);

  if (!status.version) return null;
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'ready') return null;
  if (dismissedVersion === status.version) return null;

  const agentBusy = agentStatus === 'running' || agentStatus === 'planning' || agentStatus === 'waiting_approval';
  const summary = releaseSummary(status.notes);

  return (
    <div className="shrink-0 mx-3 mt-2 border border-d4-accent/40 bg-d4-accent/5 rounded-md overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2">
        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-d4-accent" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[12px] text-d4-text">
            <span className="font-semibold">{t('update.bannerTitle', { version: status.version })}</span>
            {status.state === 'available' && <span className="text-d4-dimmed">{t('update.step1Hint')}</span>}
            {status.state === 'ready' && <span className="text-d4-dimmed">{t('update.step2Hint')}</span>}
          </div>

          {status.state === 'downloading' ? (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-d4-border overflow-hidden">
                <div
                  className="h-full bg-d4-accent transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, status.percent ?? 0))}%` }}
                />
              </div>
              <span className="text-[11px] text-d4-muted font-mono shrink-0">{status.percent ?? 0}%</span>
            </div>
          ) : summary ? (
            <div className="text-[11px] text-d4-muted mt-0.5 truncate" title={summary}>
              {summary}
            </div>
          ) : null}

          {expanded && status.notes ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-d4-muted border-l-2 border-d4-border pl-2">
              {status.notes}
            </pre>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status.state === 'available' && (
            <button
              disabled={busy}
              onClick={() => void download()}
              className="flex items-center gap-1 px-2 py-1 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
            >
              <Download className="w-3 h-3" />
              {t('update.download')}
            </button>
          )}

          {status.state === 'ready' && (
            <button
              disabled={busy || agentBusy}
              title={agentBusy ? t('update.agentBusy') : undefined}
              onClick={() => void install()}
              className="flex items-center gap-1 px-2 py-1 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              {t('update.install')}
            </button>
          )}

          {status.notes ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              title={t('update.notesTitle')}
              className="flex items-center gap-1 px-2 py-1 rounded-sm border border-d4-border text-[11px] text-d4-muted hover:text-d4-text"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {t('update.details')}
            </button>
          ) : null}

          <button
            onClick={() => window.electronAPI?.openExternal(RELEASES_URL)}
            title={t('update.openReleases')}
            aria-label={t('update.openReleases')}
            className="p-1 rounded-sm text-d4-dimmed hover:text-d4-text"
          >
            <ExternalLink className="w-3 h-3" />
          </button>

          {status.state === 'available' ? (
            <button
              onClick={() => {
                void skipVersion(status.version!);
                toast.info(t('update.skipped', { version: status.version }));
              }}
              className="px-2 py-1 rounded-sm border border-d4-border text-[11px] text-d4-dimmed hover:text-d4-text"
            >
              {t('update.skipThis')}
            </button>
          ) : null}

          <button
            onClick={() => {
              // Closing is "not now", not "never": the version is not skipped, so
              // Settings still reports it and the next interval still checks.
              dismiss(status.version!);
              toast.info(t('update.dismissedHint'));
            }}
            title={t('update.dismiss')}
            aria-label={t('update.dismiss')}
            className="p-1 rounded-sm text-d4-dimmed hover:text-d4-text"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
