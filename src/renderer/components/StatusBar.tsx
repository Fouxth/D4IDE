import React from 'react';
import { GitBranch, AlertTriangle, Terminal, PanelLeft, Bot, Code2, Loader2, Zap, Leaf } from 'lucide-react';
import { formatTokens } from '../lib/format';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agentStore';
import { useProject } from '../stores/projectStore';
import { useUsageStore } from '../stores/usageStore';
import { useSettingsStore } from '../stores/settingsStore';
import { GitStatusSummary, WorkspaceMode } from '../../shared/types';

interface StatusBarProps {
  gitStatus: GitStatusSummary | null;
  onOpenSettings: (tab?: any) => void;
  /** The branch and its changed-file count open the Git panel, not Settings. */
  onOpenGit: () => void;
  onToggleTerminal: () => void;
  onToggleExplorer: () => void;
  workspaceMode: WorkspaceMode;
  onSetWorkspaceMode: (mode: WorkspaceMode) => void;
}

/**
 * One quiet row at the bottom (spec §4).
 *
 * Identity, project, git and agent state on the left; the two things that are
 * genuinely modal — which workspace you are in, and the language — on the
 * right. Model, cost and permissions deliberately live in the composer footer,
 * where they are chosen, instead of being repeated down here.
 */
export const StatusBar: React.FC<StatusBarProps> = ({
  gitStatus,
  onOpenSettings,
  onOpenGit,
  onToggleTerminal,
  onToggleExplorer,
  workspaceMode,
  onSetWorkspaceMode
}) => {
  const { t } = useTranslation();
  const { status } = useAgentStore();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const { summary, tokenStats } = useUsageStore();
  const { settings } = useSettingsStore();

  const changed = gitStatus ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length : 0;
  const busy = status === 'running' || status === 'planning' || status === 'waiting_approval';

  const cell = 'flex items-center gap-1 px-2 h-6 rounded-sm hover:bg-d4-surface transition-colors';

  return (
    <footer className="h-7 shrink-0 bg-d4-bg border-t border-d4-border-subtle flex items-center justify-between px-2 text-[11px] text-d4-dimmed select-none z-30">
      <div className="flex items-center gap-0.5 min-w-0">
        <span className="px-2 font-semibold text-d4-muted">{t('app.name')}</span>

        <button onClick={() => onOpenSettings('sessions')} className={cell} title={projectPath || t('nav.noProject')}>
          <span className="truncate max-w-[180px] text-d4-muted">
            {projectPath ? projectPath.split(/[/\\]/).pop() : t('nav.noProject')}
          </span>
        </button>

        <button onClick={onOpenGit} className={cell} title={t('status.git')}>
          <GitBranch className="w-3 h-3" />
          <span>{gitStatus?.branch || '—'}</span>
          {changed > 0 && <span className="text-d4-warning">+{changed}</span>}
        </button>

        <span className={`${cell} cursor-default`}>
          {busy ? (
            <Loader2 className="w-3 h-3 text-d4-accent animate-spin" />
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full ${status === 'failed' ? 'bg-d4-error' : 'bg-d4-success'}`} />
          )}
          <span>{t(`agent.status_${status}` as any, { defaultValue: status })}</span>
        </span>

        {summary?.budget.warn && (
          <button onClick={() => onOpenSettings('usage')} className={`${cell} text-d4-warning`}>
            <AlertTriangle className="w-3 h-3" />
            <span>{t('usage.budgets')}</span>
          </button>
        )}

        {/* The token meter: what this run has spent, what it avoided spending,
            and the ceiling it is running against. */}
        {tokenStats && (
          <button
            onClick={() => onOpenSettings('usage')}
            className={cell}
            title={`${t('tokenMeter.title')} — ${t('tokenMeter.saved')} ${formatTokens(tokenStats.saved)}`}
          >
            <Zap className="w-3 h-3 text-d4-accent" />
            <span className="font-mono">{formatTokens(tokenStats.runTokens)}</span>
            {tokenStats.cap > 0 && (
              <span className="text-d4-dimmed">{t('tokenMeter.ofCap', { cap: formatTokens(tokenStats.cap) })}</span>
            )}
            {tokenStats.saved > 0 && (
              <span className="text-emerald-400">
                −{formatTokens(tokenStats.saved)} {t('tokenMeter.saved')}
              </span>
            )}
          </button>
        )}

        {(tokenStats?.thrift || settings?.thriftMode) && (
          <button
            onClick={() => onOpenSettings('usage')}
            className={`${cell} text-emerald-400`}
            title={tokenStats?.autoThrift ? t('tokenMeter.autoThriftHint') : undefined}
          >
            <Leaf className="w-3 h-3" />
            <span>{tokenStats?.autoThrift ? t('tokenMeter.autoThriftOn') : t('tokenMeter.thriftOn')}</span>
          </button>
        )}

      </div>

      <div className="flex items-center gap-0.5 min-w-0">
        {workspaceMode === 'code' && (
          <>
            <button
              onClick={onToggleExplorer}
              className={cell}
              title={`${t('panel.toggleExplorer')}  ·  Ctrl+Shift+E`}
              aria-label={t('panel.toggleExplorer')}
            >
              <PanelLeft className="w-3 h-3" />
            </button>
            <button
              onClick={onToggleTerminal}
              className={cell}
              title={`${t('nav.terminal')}  ·  Ctrl+\``}
              aria-label={t('nav.terminal')}
            >
              <Terminal className="w-3 h-3" />
            </button>
          </>
        )}

        <div className="flex items-center bg-d4-panel border border-d4-border-subtle rounded-sm p-0.5 mx-1">
          <button
            onClick={() => onSetWorkspaceMode('agent')}
            title={`${t('nav.agentView')}  ·  Ctrl+B`}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-sm transition-colors ${
              workspaceMode === 'agent' ? 'bg-d4-surface text-d4-text' : 'text-d4-dimmed hover:text-d4-muted'
            }`}
          >
            <Bot className="w-3 h-3" />
            <span>{t('nav.agentView')}</span>
          </button>
          <button
            onClick={() => onSetWorkspaceMode('code')}
            title={`${t('nav.codeView')}  ·  Ctrl+B`}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-sm transition-colors ${
              workspaceMode === 'code' ? 'bg-d4-surface text-d4-text' : 'text-d4-dimmed hover:text-d4-muted'
            }`}
          >
            <Code2 className="w-3 h-3" />
            <span>{t('nav.codeView')}</span>
          </button>
        </div>

        <button onClick={() => onOpenSettings('language')} className={cell}>
          <span>{settings?.language === 'th' ? 'ไทย' : 'EN'}</span>
        </button>
      </div>
    </footer>
  );
};
