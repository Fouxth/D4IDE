import React, { useEffect, useRef, useState } from 'react';
import {
  Minus,
  Square,
  X,
  Plus,
  PanelLeft,
  PanelRight,
  MoreHorizontal,
  Search,
  Command,
  History,
  Settings,
  Bot,
  Code2,
  Columns3,
  Terminal as TerminalIcon,
  Trash2,
  Pencil
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../stores/projectStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useAgentStore } from '../stores/agentStore';
import { presenceFor, presenceDotClass } from '../lib/session-presence';
import { WorkspaceMode } from '../../shared/types';

interface TitleBarProps {
  workspaceMode: WorkspaceMode;
  onToggleMode: (mode: WorkspaceMode) => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onNewSession: () => void;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  onToggleTerminal: () => void;
  terminalOpen: boolean;
}

/**
 * The header is a session tab strip, not a toolbar (spec §58).
 *
 * Each open conversation gets a tab with its own close button, the way a
 * browser or an editor works, so switching between two tasks never costs the
 * context of the other. Everything that is not a session — search, palette,
 * history, settings, panel toggles — lives behind the overflow menu, which
 * keeps the strip quiet and the chat surface loud.
 */
export const TitleBar: React.FC<TitleBarProps> = ({
  workspaceMode,
  onToggleMode,
  rightPanelOpen,
  onToggleRightPanel,
  leftPanelOpen,
  onToggleLeftPanel,
  outlineOpen,
  onToggleOutline,
  onNewSession,
  onOpenSearch,
  onOpenPalette,
  onOpenSessions,
  onOpenSettings,
  onToggleTerminal,
  terminalOpen
}) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const { tabs, activeId, select, close, rename } = useSessionsStore();
  const agentStatus = useAgentStore((st) => st.status);
  const liveSessionId = useAgentStore((st) => st.sessionId);
  // A dot is shown only on the tab whose conversation is actually running —
  // the renderer knows no other session's live state, and must not guess.
  const presence = presenceFor(agentStatus) && liveSessionId ? presenceFor(agentStatus) : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The + menu mirrors the Freebuff pattern: a new space, a rename of the
  // space that is open, and closing it. Rename runs in a small dialog so a
  // long name is typed and edited comfortably.
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const spaceMenuRef = useRef<HTMLDivElement>(null);
  // Double-click a tab to rename it in place — the dialog stays for the menu
  // item, but the direct gesture is faster and is what Freebuff uses.
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTab, setRenameTab] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!spaceMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!spaceMenuRef.current?.contains(event.target as Node)) setSpaceMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpaceMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [spaceMenuOpen]);

  const openRenameDialog = () => {
    setSpaceMenuOpen(false);
    const tab = tabs.find((item) => item.id === activeId);
    if (!tab) return;
    setRenameTab({ id: tab.id, title: tab.title });
    setRenameValue(tab.title);
    setRenameOpen(true);
  };

  const commitRename = () => {
    const tab = renameTab;
    const name = renameValue.trim();
    setRenameOpen(false);
    if (!tab || !name || name === tab.title) return;
    void rename(tab.id, name);
  };

  const commitInlineRename = () => {
    const id = inlineEditId;
    const name = inlineValue.trim();
    setInlineEditId(null);
    if (!id || !name) return;
    const tab = tabs.find((item) => item.id === id);
    if (!tab || name === tab.title) return;
    void rename(id, name);
  };

  const menuItem = (
    key: string,
    Icon: React.ComponentType<{ className?: string }>,
    text: string,
    hint: string | undefined,
    action: () => void
  ) => (
    <button
      key={key}
      onClick={() => {
        setMenuOpen(false);
        action();
      }}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-d4-muted hover:text-d4-text hover:bg-d4-surface rounded-sm transition-colors"
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 truncate">{text}</span>
      {hint && <span className="text-[10px] text-d4-dimmed font-mono">{hint}</span>}
    </button>
  );

  const divider = (key: string) => <div key={key} className="my-1 h-px bg-d4-border-subtle" />;

  return (
    <header
      className="h-10 shrink-0 bg-d4-bg border-b border-d4-border-subtle flex items-stretch pl-1.5 pr-0 text-xs text-d4-muted z-50 select-none"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={onToggleLeftPanel}
          title={t('nav.toggleLeftPanel')}
          className={`d4-icon-button w-7 h-7 ${leftPanelOpen ? '' : 'text-d4-dimmed'}`}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ------------------------------------------------------- session tabs */}
      <div
        className="flex-1 min-w-0 flex items-end gap-1 overflow-x-auto pl-1 pt-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {tabs.length === 0 && (
          <div className="px-2 pb-1.5 text-[12px] text-d4-dimmed truncate">
            {t('app.name')}
            {projectName ? ` · ${projectName}` : ''}
          </div>
        )}

        {tabs.map((tab) => {
          const isActive = activeId === tab.id;
          const editing = inlineEditId === tab.id;
          // Only the tab whose conversation is live carries a dot; every other
          // tab's state is unknown to this renderer and must not be guessed.
          const tabPresence = tab.id === liveSessionId ? presence : null;
          return (
            <div
              key={tab.id}
              onClick={() => {
                if (!editing) void select(tab.id);
              }}
              onDoubleClick={(e) => {
                // Only the label area starts an edit, not the close button.
                if ((e.target as HTMLElement).closest('button')) return;
                setInlineEditId(tab.id);
                setInlineValue(tab.title);
              }}
              title={tab.title}
              className={`group relative flex items-center gap-1.5 pl-2 pr-1 h-7 max-w-[210px] min-w-[120px] cursor-pointer rounded-t-md border border-b-0 transition-colors ${
                isActive
                  ? 'bg-d4-panel border-d4-border text-d4-text'
                  : 'bg-transparent border-transparent text-d4-muted hover:bg-d4-panel/50 hover:text-d4-text'
              }`}
            >
              <span className="relative shrink-0">
                <span
                  className={`w-3.5 h-3.5 rounded-[3px] flex items-center justify-center text-[7px] font-bold ${
                    isActive ? 'bg-d4-accent text-black' : 'bg-d4-surface text-d4-dimmed'
                  }`}
                >
                  D4
                </span>
                {tabPresence && (
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-d4-bg ${presenceDotClass[tabPresence]}`}
                    title={t(`nav.presence_${tabPresence}`)}
                  />
                )}
              </span>
              {editing ? (
                <input
                  autoFocus
                  value={inlineValue}
                  onChange={(e) => setInlineValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitInlineRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitInlineRename();
                    if (e.key === 'Escape') setInlineEditId(null);
                  }}
                  className="flex-1 min-w-0 bg-d4-surface border border-d4-accent rounded-sm px-1 py-0.5 text-[11px] text-d4-text outline-none"
                />
              ) : (
                <span className="flex-1 truncate text-[11px]">{tab.title}</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                title={t('nav.closeTab')}
                className="shrink-0 p-0.5 rounded-sm text-d4-dimmed opacity-0 group-hover:opacity-100 hover:text-d4-error hover:bg-d4-surface transition-all"
              >
                <X className="w-3 h-3" />
              </button>
              {isActive && <span className="absolute inset-x-0 -bottom-px h-px bg-d4-panel" />}
            </div>
          );
        })}

      </div>

      {/*
       * The + lives outside the scrollable tab strip on purpose. Inside it, the
       * button scrolled out of view once the open tabs were wider than the strip —
       * which happens at the window's minimum width (1024px) — and a button nobody
       * can see is a button nobody can press.
       */}
      <div className="relative shrink-0 self-end mb-1 ml-0.5" ref={spaceMenuRef}>
        <button
          onClick={() => setSpaceMenuOpen((open) => !open)}
          title={t('nav.newSession')}
          className={`w-6 h-6 flex items-center justify-center rounded-sm text-d4-dimmed hover:text-d4-text hover:bg-d4-panel transition-colors ${spaceMenuOpen ? 'text-d4-text bg-d4-panel' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {spaceMenuOpen && (
          <div className="absolute left-0 top-8 w-56 bg-d4-panel border border-d4-border rounded-md shadow-2xl p-1 z-50">
            <button
              onClick={() => {
                setSpaceMenuOpen(false);
                onNewSession();
              }}
              className="w-full px-2.5 py-2 text-left text-[12px] text-d4-text hover:bg-d4-surface rounded-sm transition-colors"
            >
              {projectName ? t('nav.spaceNewIn', { project: projectName }) : t('nav.spaceNew')}
            </button>
            <button
              onClick={openRenameDialog}
              disabled={!activeId || activeId.startsWith('__')}
              className="w-full px-2.5 py-2 text-left text-[12px] text-d4-text hover:bg-d4-surface rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {t('nav.spaceRename')}
            </button>
            <div className="my-1 h-px bg-d4-border-subtle" />
            <button
              onClick={() => {
                setSpaceMenuOpen(false);
                if (activeId) close(activeId);
              }}
              disabled={!activeId}
              className="w-full px-2.5 py-2 text-left text-[12px] text-d4-text hover:bg-d4-surface rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {t('nav.spaceClose')}
            </button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- right cluster */}
      <div
        className="flex items-center gap-0.5 pl-2 pr-1 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          onClick={onToggleRightPanel}
          title={t('nav.toggleRightPanel')}
          className={`d4-icon-button w-7 h-7 ${rightPanelOpen ? 'text-d4-text bg-d4-surface' : ''}`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            title={t('nav.moreActions')}
            className={`d4-icon-button w-7 h-7 ${menuOpen ? 'text-d4-text bg-d4-surface' : ''}`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-8 w-64 bg-d4-panel border border-d4-border rounded-md shadow-2xl p-1 z-50">
              {workspaceMode === 'agent'
                ? menuItem('code', Code2, t('nav.codeView'), 'Ctrl+B', () => onToggleMode('code'))
                : menuItem('agent', Bot, t('nav.agentView'), 'Ctrl+B', () => onToggleMode('agent'))}
              {menuItem('outline', Columns3, t('outline.toggle'), undefined, onToggleOutline)}
              {menuItem('terminal', TerminalIcon, t('nav.terminal'), 'Ctrl+`', onToggleTerminal)}
              {divider('d1')}
              {menuItem('search', Search, t('nav.search'), 'Ctrl+P', onOpenSearch)}
              {menuItem('palette', Command, t('nav.commandPalette'), 'Ctrl+Shift+P', onOpenPalette)}
              {menuItem('history', History, t('nav.sessions'), undefined, onOpenSessions)}
              {divider('d2')}
              {menuItem('settings', Settings, t('nav.settings'), 'Ctrl+,', onOpenSettings)}
              {activeId &&
                menuItem('close', Trash2, t('nav.clearSession'), undefined, () => {
                  useSessionsStore.getState().select(null);
                })}
              {terminalOpen && <span className="sr-only">{t('nav.terminal')}</span>}
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-d4-border-subtle mx-1" />

        <button onClick={() => window.electronAPI?.minimize()} className="d4-icon-button w-7 h-7">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => window.electronAPI?.maximize()} className="d4-icon-button w-7 h-7">
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-d4-muted hover:text-white hover:bg-d4-error transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {renameOpen && renameTab && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameOpen(false);
          }}
        >
          <div className="w-[380px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Pencil className="w-4 h-4 text-d4-muted" />
              <span className="text-sm text-d4-text">{t('nav.spaceRenamePrompt')}</span>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenameOpen(false);
              }}
              placeholder={t('nav.spaceRenamePlaceholder')}
              className="w-full bg-d4-surface border border-d4-border rounded-md px-3 py-2 text-sm text-d4-text placeholder:text-d4-dimmed outline-none focus:border-d4-accent"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenameOpen(false)}
                className="px-3 py-1.5 text-xs rounded-md text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={commitRename}
                className="px-3 py-1.5 text-xs rounded-md bg-d4-accent text-black hover:opacity-90 transition-opacity"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
