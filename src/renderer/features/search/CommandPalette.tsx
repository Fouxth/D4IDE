import React, { useEffect, useMemo, useState } from 'react';
import { Search, Command, CornerDownLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEscapeToClose } from '../../lib/use-escape';
import { useAgentStore } from '../../stores/agentStore';
import { useProject } from '../../stores/projectStore';
import { useUsageStore } from '../../stores/usageStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { toast } from '../../stores/toastStore';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opening a settings page directly keeps the palette to one keystroke. */
  onOpenSettings: (tab?: string) => void;
  onOpenSearch: () => void;
  /** Reveal a right-hand panel (changes, checkpoints, preview…). */
  onOpenPanel: (tab: string) => void;
  onSetWorkspaceMode: (mode: 'agent' | 'code') => void;
  /** Panel visibility is a global command too (spec §60/§62). */
  onToggleExplorer: () => void;
  onToggleTerminal: () => void;
}

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenSearch,
  onOpenPanel,
  onSetWorkspaceMode,
  onToggleExplorer,
  onToggleTerminal
}) => {
  const { t } = useTranslation();
  const { startAgent, setMode, cancelAgent, approvePlan, rejectPlan, status } = useAgentStore();
  const { projectPath, saveActiveFile } = useProject((s) => ({
    projectPath: s.projectPath,
    saveActiveFile: s.saveActiveFile
  }));
  const { load: loadUsage } = useUsageStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  useEscapeToClose(isOpen, onClose);

  const commands: PaletteCommand[] = useMemo(
    () => [
      {
        id: 'new-thread',
        label: `${t('nav.newThread')}  ·  Ctrl+T`,
        run: () => {
          // The same act as the + on the strip: a tab appears beside the others
          // rather than the current conversation being cleared in place, which
          // looked like the command had deleted it.
          useSessionsStore.getState().newTab();
          toast.info(t('palette.newThreadStarted'));
        }
      },
      { id: 'open-settings', label: t('palette.openSettings'), run: () => onOpenSettings('providers') },
      { id: 'open-search', label: t('palette.searchFiles'), run: onOpenSearch },
      { id: 'switch-model', label: t('palette.switchModel'), run: () => onOpenSettings('providers') },
      { id: 'open-preview', label: t('palette.openPreview'), run: () => onOpenPanel('preview') },
      { id: 'restore-checkpoint', label: t('palette.restoreCheckpoint'), run: () => onOpenPanel('checkpoints') },
      { id: 'open-mission', label: t('palette.openMission'), run: () => onOpenPanel('mission') },
      { id: 'open-changes', label: t('palette.openChanges'), run: () => onOpenPanel('changes') },
      { id: 'open-session-log', label: t('palette.openLogs'), run: () => onOpenSettings('logs') },
      { id: 'open-agent-view', label: t('palette.agentView'), run: () => onSetWorkspaceMode('agent') },
      { id: 'open-code-view', label: t('palette.codeView'), run: () => onSetWorkspaceMode('code') },
      { id: 'toggle-explorer', label: t('panel.toggleExplorer'), run: onToggleExplorer },
      { id: 'toggle-terminal', label: t('panel.toggleTerminal'), run: onToggleTerminal },
      {
        id: 'plan-task',
        label: t('palette.planTask'),
        run: () => {
          setMode('plan');
          toast.info(t('palette.planModeHint'));
        }
      },
      {
        id: 'build-mode',
        label: t('palette.buildMode'),
        run: () => setMode('build')
      },
      {
        id: 'run-tests',
        label: t('palette.runTests'),
        run: async () => {
          setMode('build');
          await startAgent(t('palette.runTestsPrompt'));
        }
      },
      {
        id: 'run-build',
        label: t('palette.runBuild'),
        run: async () => {
          setMode('build');
          await startAgent(t('palette.runBuildPrompt'));
        }
      },
      {
        id: 'review',
        label: t('palette.reviewChanges'),
        run: async () => {
          setMode('plan');
          await startAgent(t('palette.reviewPrompt'));
        }
      },
      {
        id: 'stop',
        label: t('palette.cancelAgent'),
        run: () => {
          if (status === 'running' || status === 'planning') cancelAgent();
        }
      },
      { id: 'approve', label: t('palette.approvePlan'), run: () => approvePlan() },
      { id: 'reject', label: t('palette.rejectPlan'), run: () => rejectPlan() },
      {
        id: 'checkpoint',
        label: t('palette.createCheckpoint'),
        run: async () => {
          if (!window.electronAPI || !projectPath) {
            toast.error(t('palette.needProject'));
            return;
          }
          const res = await window.electronAPI.createCheckpoint(t('palette.manualCheckpoint'), []);
          toast.info(t('palette.checkpointCreated'), res.id);
        }
      },
      { id: 'save-file', label: t('palette.saveFile'), run: () => saveActiveFile() },
      { id: 'refresh-usage', label: t('palette.refreshUsage'), run: () => loadUsage() }
    ],
    [
      t,
      onOpenSettings,
      onOpenSearch,
      setMode,
      startAgent,
      cancelAgent,
      approvePlan,
      rejectPlan,
      status,
      projectPath,
      saveActiveFile,
      loadUsage,
      onToggleExplorer,
      onToggleTerminal
    ]
  );

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-32" onClick={onClose}>
      <div
        className="w-[560px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-2 px-3 py-2.5 border-b border-d4-border">
          <Search className="w-4 h-4 text-d4-dimmed" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered[0]) {
                onClose();
                await filtered[0].run();
              }
            }}
            placeholder={t('palette.placeholder')}
            className="flex-1 bg-transparent text-sm text-d4-text outline-none placeholder-d4-dimmed"
          />
          <Command className="w-3.5 h-3.5 text-d4-dimmed" />
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-d4-dimmed text-xs">{t('palette.noCommand')}</div>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                onClick={async () => {
                  onClose();
                  await command.run();
                }}
                className={`w-full text-left px-3 py-2 rounded-sm text-xs flex items-center justify-between ${
                  index === 0 ? 'bg-d4-accent/15 text-d4-text' : 'text-d4-muted hover:bg-d4-surface hover:text-d4-text'
                }`}
              >
                <span>{command.label}</span>
                {index === 0 && <CornerDownLeft className="w-3 h-3 text-d4-dimmed" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
