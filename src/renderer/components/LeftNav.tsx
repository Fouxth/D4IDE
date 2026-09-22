import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Command,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MinusCircle,
  PanelLeftClose,
  Search,
  Settings,
  SquarePen
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SessionSummary } from '../../shared/types';
import { useProject } from '../stores/projectStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useAgentStore } from '../stores/agentStore';
import { projectName, projectInitials } from '../lib/session-badge';
import { samePath } from '../lib/paths';
import { ContextMenu, useContextMenu } from './ContextMenu';

interface LeftNavProps {
  /** The folders kept on the rail, most recently opened first. */
  spaces: string[];
  /** Switches to one of them — the folder is already known, so there is no dialog. */
  onSelectSpace: (path: string) => void;
  /** Takes a folder off the rail. Nothing on disk is deleted. */
  onForgetSpace: (path: string) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  /** A new space: pick a project folder. */
  onNewSpace: () => void;
  /** A new thread in the project that is open. */
  onNewThread: () => void;
  /** Opens a thread — switching project first when it belongs to another one. */
  onSelectThread: (sessionId: string, projectPath?: string) => void;
  onOpenGit: () => void;
  onHide: () => void;
}

/**
 * The sidebar answers "where am I, and what was I doing there?".
 *
 * Written in words rather than icons, like the reference client: a rail of eight
 * unlabelled glyphs is a memory test, and the two things a user does here most —
 * start a conversation, find an old one — deserve their own names on screen.
 *
 * A project is a folder that stays until the user removes it, and its threads are
 * listed underneath it, so opening a conversation from three projects ago is one
 * click instead of "switch project, then look in the tab strip". Thread colours
 * are deliberately absent; the only marks are the one that is open and the one
 * that is still running.
 *
 * "Search threads" filters that list in place rather than opening a separate
 * chooser: the list is already the index of every conversation, and a second
 * window showing the same rows would only add a place to get lost in.
 */
export const LeftNav: React.FC<LeftNavProps> = ({
  spaces,
  onSelectSpace,
  onForgetSpace,
  onOpenSettings,
  onOpenPalette,
  onNewSpace,
  onNewThread,
  onSelectThread,
  onOpenGit,
  onHide
}) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const activeSessionId = useAgentStore((state) => state.sessionId);
  const status = useAgentStore((state) => state.status);
  const closedIds = useSessionsStore((state) => state.closedIds);
  const spaceMenu = useContextMenu();

  /** Every stored session, grouped by the project it belongs to. */
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  /** Which projects are unfolded. The open one starts open. */
  const [expanded, setExpanded] = useState<string[]>([projectPath || '']);
  /** The thread filter: empty and closed until "Search threads" is clicked. */
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');

  const needle = filterOpen ? query.trim().toLowerCase() : '';

  const matchesFilter = useCallback(
    (session: SessionSummary) =>
      !needle ||
      (session.title || '').toLowerCase().includes(needle) ||
      session.id.toLowerCase().includes(needle),
    [needle]
  );

  const load = useCallback(async () => {
    if (!window.electronAPI?.listSessions) {
      setSessions([]);
      return;
    }
    try {
      const list = (await window.electronAPI.listSessions()) ?? [];
      setSessions(list as SessionSummary[]);
    } catch {
      setSessions([]);
    }
  }, []);

  // Reloaded when the set of projects changes, when a new session is minted
  // (`sessionId` moves), and when a run settles — the list is short, and a stale
  // sidebar that hides the conversation you just finished is a navigation bug.
  useEffect(() => {
    void load();
  }, [load, spaces.length, activeSessionId, status, projectPath]);

  // The open project is always unfolded: a collapsed row hiding the title of the
  // conversation on screen reads as "the conversation is gone".
  useEffect(() => {
    if (!projectPath) return;
    setExpanded((list) => (list.includes(projectPath) ? list : [...list, projectPath]));
  }, [projectPath]);

  const threadsByProject = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const key = session.projectPath || '';
      if (closedIds.includes(session.id)) continue;
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return map;
  }, [sessions, closedIds]);

  const toggleProject = (path: string) =>
    setExpanded((list) => (list.includes(path) ? list.filter((entry) => entry !== path) : [...list, path]));

  const openSpaceMenu = (event: React.MouseEvent, path: string) => {
    spaceMenu.open(
      event,
      [
        {
          id: 'forget',
          label: t('nav.spaceForget'),
          icon: MinusCircle,
          danger: true,
          onSelect: () => onForgetSpace(path)
        }
      ],
      t('nav.spaceMenu')
    );
  };

  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12.5px] transition-colors ${
      active ? 'bg-d4-surface text-d4-text' : 'text-d4-muted hover:text-d4-text hover:bg-d4-surface/60'
    }`;

  const action = (key: string, Icon: typeof Search, label: string, onClick: () => void, hint?: string) => (
    <button key={key} type="button" onClick={onClick} className={rowClass(false)} title={hint}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <aside className="w-60 shrink-0 bg-d4-bg border-r border-d4-border-subtle flex flex-col select-none">
      {/* ----------------------------------------------------------- brand */}
      <div className="flex items-center gap-2 px-4 pt-5 pb-4">
        <span className="text-[17px] font-semibold text-d4-text tracking-tight">{t('app.name')}</span>
        <button
          type="button"
          onClick={onHide}
          title={t('nav.toggleLeftPanel')}
          className="ml-auto d4-icon-button w-6 h-6"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* --------------------------------------------------------- actions */}
      <div className="px-2 space-y-0.5">
        {action('new-chat', SquarePen, t('nav.newChat'), onNewThread, t('nav.newThread'))}
        {action('search-threads', Search, t('nav.searchThreads'), () => {
          setFilterOpen((open) => {
            if (open) setQuery('');
            return !open;
          });
        })}
      </div>

      {filterOpen && (
        <div className="px-3 pt-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              setQuery('');
              setFilterOpen(false);
            }}
            placeholder={t('nav.searchThreads')}
            aria-label={t('nav.searchThreads')}
            className="w-full bg-d4-surface border border-d4-border rounded-md px-2 py-1 text-[12px] text-d4-text placeholder:text-d4-dimmed focus:outline-none focus:border-d4-accent/60"
          />
        </div>
      )}

      {/* -------------------------------------------------------- projects */}
      <div className="mt-4 flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <div className="px-2 pb-1 d4-label">{t('nav.projects')}</div>

        {spaces.map((space) => {
          const isActive = samePath(space, projectPath);
          const threads = (threadsByProject.get(space) ?? []).filter(matchesFilter);
          // While filtering, every project with a hit is unfolded — a match behind
          // a collapsed row is a conversation the user cannot see.
          const isOpen = needle ? true : expanded.includes(space);
          const name = projectName(space) || space;
          if (needle && threads.length === 0) return null;
          return (
            <div key={space} className="mb-0.5">
              <div className={`flex items-center rounded-md ${isActive ? 'bg-d4-surface' : 'hover:bg-d4-surface/60'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded((list) => (list.includes(space) ? list : [...list, space]));
                    if (!isActive) onSelectSpace(space);
                  }}
                  onContextMenu={(event) => openSpaceMenu(event, space)}
                  title={`${name}\n${space}`}
                  className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12.5px] ${
                    isActive ? 'text-d4-text font-medium' : 'text-d4-muted hover:text-d4-text'
                  }`}
                >
                  <span className="w-4 h-4 shrink-0 rounded-[4px] bg-d4-surface text-[8px] font-bold flex items-center justify-center text-d4-muted">
                    {projectInitials(space) || <FolderOpen className="w-3 h-3" />}
                  </span>
                  <span className="truncate">{name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleProject(space)}
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? 'settings.collapseGroup' : 'settings.expandGroup')}
                  className="px-1.5 py-1.5 text-d4-dimmed hover:text-d4-text"
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              </div>

              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {threads.length === 0 && !needle && (
                    <div className="pl-8 pr-2 py-1 text-[11px] text-d4-dimmed">{t('nav.noThreads')}</div>
                  )}
                  {threads.map((thread) => {
                    const open = thread.id === activeSessionId;
                    const running = open && (status === 'running' || status === 'planning');
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => onSelectThread(thread.id, thread.projectPath)}
                        title={thread.title || thread.id}
                        className={`w-full flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-md text-left text-[12px] transition-colors ${
                          open ? 'bg-d4-surface text-d4-text' : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface/50'
                        }`}
                      >
                        <span className="truncate flex-1">{thread.title || t('nav.sessionDefault')}</span>
                        {running && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-d4-accent animate-pulse shrink-0"
                            title={t('nav.presence_working')}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onNewSpace}
          title={t('nav.spaceNewFolder')}
          className="mt-1 w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-dashed border-d4-border text-[12.5px] text-d4-dimmed hover:text-d4-text hover:border-d4-muted transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t('nav.spaceNew')}</span>
        </button>
      </div>

      <ContextMenu request={spaceMenu.request} onClose={spaceMenu.close} />

      {/* ---------------------------------------------------------- footer */}
      <div className="border-t border-d4-border-subtle p-2 space-y-0.5">
        {action('palette', Command, t('nav.commandPalette'), onOpenPalette, 'Ctrl+Shift+P')}
        {action('git', GitBranch, t('nav.git'), onOpenGit)}
        {action('settings', Settings, t('nav.settings'), onOpenSettings, 'Ctrl+,')}
      </div>
    </aside>
  );
};
