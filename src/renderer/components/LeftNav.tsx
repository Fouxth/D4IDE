import React, { useState } from 'react';
import { FolderOpen, Plus, GitBranch, Settings, Command, History, PanelLeftClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../stores/projectStore';
import { useAgentStore } from '../stores/agentStore';
import { useSessionsStore } from '../stores/sessionsStore';

interface LeftNavProps {
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onOpenSessions: () => void;
  onNewSession: () => void;
  onOpenGit: () => void;
  onHide: () => void;
}

/**
 * The rail answers one question — "which conversation am I in?" (spec §5).
 *
 * Every open session gets a square badge, the active one is lit, and everything
 * else (projects, git, settings) is a single quiet column underneath. The rail
 * stays 48px wide so the chat keeps the rest of the window.
 *
 * There is deliberately no search badge: the palette already reaches files,
 * commands and sessions, so a second magnifier in the rail was a duplicate entry
 * point taking up the scarcest space in the app. Ctrl+P still opens file search.
 */
export const LeftNav: React.FC<LeftNavProps> = ({
  onOpenSettings,
  onOpenPalette,
  onOpenSessions,
  onNewSession,
  onOpenGit,
  onHide
}) => {
  const { t } = useTranslation();
  const { setProjectPath, projectPath } = useProject((s) => ({
    setProjectPath: s.setProjectPath,
    projectPath: s.projectPath
  }));
  const { status } = useAgentStore();
  // `tabs` comes from the store already in its stable order; a drag reorders it
  // and that order is saved, so a restart does not undo it.
  const { tabs, activeId, select, reorder } = useSessionsStore();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const isBusy = status === 'running' || status === 'planning' || status === 'waiting_approval';

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.openProjectDialog();
    if (dir) setProjectPath(dir);
  };

  const icon = (
    key: string,
    Icon: typeof Plus,
    label: string,
    onClick: () => void,
    options: { active?: boolean } = {}
  ) => (
    <button
      key={key}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
        options.active
          ? 'bg-d4-surface text-d4-text'
          : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <aside className="w-12 shrink-0 bg-d4-bg border-r border-d4-border-subtle flex flex-col items-center gap-1 py-2 z-40">
      <button
        onClick={onHide}
        title={t('nav.toggleLeftPanel')}
        className="w-6 h-6 mb-0.5 flex items-center justify-center rounded-sm text-d4-dimmed hover:text-d4-text transition-colors"
      >
        <PanelLeftClose className="w-3.5 h-3.5" />
      </button>

      {/* --------------------------------------------------- open sessions */}
      <div className="flex-1 w-full min-h-0 flex flex-col items-center gap-1.5 overflow-y-auto d4-scroll-none">
        {tabs.map((tab) => {
          const isActive = activeId === tab.id;
          const isDropTarget = dropTargetId === tab.id && draggingId !== tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => void select(tab.id)}
              title={`${tab.title}${tab.id.startsWith('__') ? '' : '  ·  ลากเพื่อจัดลำดับ'}`}
              draggable
              onDragStart={(event) => {
                setDraggingId(tab.id);
                // Firefox and Chromium refuse to start a drag without payload.
                event.dataTransfer.setData('text/plain', tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!draggingId || draggingId === tab.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTargetId(tab.id);
              }}
              onDragLeave={() => setDropTargetId((current) => (current === tab.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const moving = draggingId || event.dataTransfer.getData('text/plain');
                if (moving && moving !== tab.id) reorder(moving, tab.id);
                setDraggingId(null);
                setDropTargetId(null);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
              className={`relative w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold transition-all ${
                isActive
                  ? 'bg-d4-accent/20 text-d4-accent ring-1 ring-d4-accent/50'
                  : 'bg-d4-surface text-d4-muted hover:text-d4-text'
              } ${draggingId === tab.id ? 'opacity-40' : ''} ${
                isDropTarget ? 'ring-1 ring-d4-text/60' : ''
              }`}
            >
              D4
              {isActive && isBusy && (
                <span className="absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-d4-accent animate-d4-pulse-soft" />
              )}
            </button>
          );
        })}

        <button
          onClick={onNewSession}
          title={t('nav.newSession')}
          className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center border border-dashed border-d4-border text-d4-dimmed hover:text-d4-text hover:border-d4-muted transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* ------------------------------------------------------ quiet column */}
      <div className="flex flex-col items-center gap-0.5 pt-1 border-t border-d4-border-subtle w-full">
        {icon('project', FolderOpen, projectPath || t('nav.projects'), handleOpenProject, {
          active: !!projectPath
        })}
        {icon('palette', Command, `${t('nav.commandPalette')}  ·  Ctrl+Shift+P`, onOpenPalette)}
        {icon('history', History, t('nav.sessions'), onOpenSessions)}
        {icon('git', GitBranch, t('nav.git'), onOpenGit)}
        {icon('settings', Settings, `${t('nav.settings')}  ·  Ctrl+,`, onOpenSettings)}
      </div>
    </aside>
  );
};
