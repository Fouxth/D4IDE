import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, GitBranch, RefreshCw, TriangleAlert } from 'lucide-react';
import { GitStatusSummary } from '../../../shared/types';
import { useProject } from '../../stores/projectStore';
import { toast } from '../../stores/toastStore';

/**
 * Git panel for the right sidebar.
 *
 * The main process already spoke git — status, diff, log, branches and commit had
 * IPC handlers and preload bindings — but nothing in the interface called them, so
 * the branch icon in the left rail did nothing at all. A button that silently does
 * nothing is worse than a missing one: it reads as a broken app. This gives the
 * action something real to open.
 */

/** Single-letter badge per porcelain path, the way `git status -s` reads. */
const badge = (kind: 'staged' | 'unstaged' | 'untracked'): { letter: string; className: string } => {
  if (kind === 'staged') return { letter: 'A', className: 'bg-emerald-500/20 text-emerald-400' };
  if (kind === 'unstaged') return { letter: 'M', className: 'bg-amber-500/20 text-amber-400' };
  return { letter: 'U', className: 'bg-d4-surface text-d4-dimmed' };
};

export const GitTab: React.FC = () => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));

  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [notRepo, setNotRepo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.gitStatus || !projectPath) {
      setStatus(null);
      setNotRepo(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api.gitStatus(projectPath);
      setStatus(next && next.branch ? next : null);
      setNotRepo(!next || !next.branch);
    } catch {
      // A folder that is not a repository is a normal state, not an error.
      setStatus(null);
      setNotRepo(true);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDiff = useCallback(
    async (filePath: string) => {
      const api = window.electronAPI;
      if (!api?.gitDiff || !projectPath) return;
      setSelected(filePath);
      try {
        const text = await api.gitDiff(projectPath, filePath, false);
        setDiff(text || t('git.noDiff'));
      } catch (e: any) {
        setDiff(String(e?.message || t('git.diffFailed')));
      }
    },
    [projectPath, t]
  );

  const commit = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.gitCommit || !projectPath || !message.trim()) return;
    setCommitting(true);
    try {
      const output = await api.gitCommit(projectPath, message.trim());
      toast.success(t('git.committed'), String(output || '').split('\n')[0]);
      setMessage('');
      setDiff('');
      setSelected(null);
      await refresh();
    } catch (e: any) {
      toast.error(t('git.commitFailed'), String(e?.message || '').slice(0, 160));
    } finally {
      setCommitting(false);
    }
  }, [message, projectPath, refresh, t]);

  if (!projectPath) {
    return <p className="text-[11px] text-d4-dimmed py-2">{t('git.noProject')}</p>;
  }

  if (!status) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-d4-dimmed text-[11px] uppercase font-semibold">
          <GitBranch className="w-3.5 h-3.5" />
          <span>{t('rightSidebar.git')}</span>
        </div>
        <p className="text-[11px] text-d4-dimmed py-2 flex items-start gap-1.5">
          {notRepo ? <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> : null}
          <span>{notRepo ? t('git.notARepo') : t('git.loading')}</span>
        </p>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-d4-border text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t('git.refresh')}
        </button>
      </div>
    );
  }

  const rows: { path: string; kind: 'staged' | 'unstaged' | 'untracked' }[] = [
    ...status.staged.map((path) => ({ path, kind: 'staged' as const })),
    ...status.unstaged.map((path) => ({ path, kind: 'unstaged' as const })),
    ...status.untracked.map((path) => ({ path, kind: 'untracked' as const }))
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <GitBranch className="w-3.5 h-3.5 text-d4-accent shrink-0" />
          <span className="text-[12px] font-medium truncate">{status.branch}</span>
          {status.isClean && <span className="text-[10px] text-emerald-400 shrink-0">{t('git.clean')}</span>}
        </div>
        <button
          onClick={() => void refresh()}
          title={t('git.refresh')}
          className="d4-icon-button w-6 h-6 shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-d4-dimmed py-2">{t('git.nothingToCommit')}</p>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => {
            const b = badge(row.kind);
            return (
              <button
                key={`${row.kind}-${row.path}`}
                onClick={() => void openDiff(row.path)}
                title={t(`git.${row.kind}`)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded border text-left transition-colors ${
                  selected === row.path
                    ? 'border-d4-accent bg-d4-surface'
                    : 'border-d4-border hover:border-d4-muted bg-d4-surface/50'
                }`}
              >
                <span className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center shrink-0 ${b.className}`}>
                  {b.letter}
                </span>
                <span className="text-[11px] truncate font-mono">{row.path}</span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase font-semibold text-d4-dimmed">
            {t('git.diff')} · {selected}
          </div>
          <pre className="max-h-64 overflow-auto text-[10px] font-mono bg-black/40 border border-d4-border rounded p-2 whitespace-pre">
            {diff.split('\n').map((line, index) => (
              <div
                key={index}
                className={
                  line.startsWith('+') && !line.startsWith('+++')
                    ? 'text-emerald-400'
                    : line.startsWith('-') && !line.startsWith('---')
                      ? 'text-red-400'
                      : line.startsWith('@@')
                        ? 'text-d4-accent'
                        : 'text-d4-muted'
                }
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}

      <div className="space-y-1.5 border-t border-d4-border-subtle pt-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder={t('git.commitMessage')}
          className="w-full px-2 py-1.5 rounded border border-d4-border bg-d4-surface text-[11px] resize-none focus:outline-none focus:border-d4-accent"
        />
        <button
          onClick={() => void commit()}
          disabled={!message.trim() || committing || rows.length === 0}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-d4-accent text-black text-[11px] font-medium transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-3 h-3" />
          {t('git.commit')}
        </button>
        <p className="text-[10px] text-d4-dimmed">{t('git.commitNote')}</p>
      </div>
    </div>
  );
};
