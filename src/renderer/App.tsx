import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { LeftNav } from './components/LeftNav';
import { StatusBar } from './components/StatusBar';
import { ToastHost } from './components/ToastHost';
import { UpdatePrompt } from './components/UpdatePrompt';
import { LocalLlmPrompt } from './components/LocalLlmPrompt';
import { ProviderDialog } from './components/ProviderDialog';
import { AgentTimeline } from './features/agent/AgentTimeline';
import { ConversationMap } from './features/agent/ConversationMap';
import { Composer } from './features/agent/Composer';
import { SessionRecoveryBanner } from './features/agent/SessionRecoveryBanner';
import { ApprovalDialog } from './features/agent/ApprovalDialog';
import { FileExplorer } from './features/explorer/FileExplorer';
import { ProjectEmptyState } from './features/project/ProjectEmptyState';
import { RightSidebar, RightPanelTab } from './features/right-sidebar/RightSidebar';
import { BufferRecoveryBanner } from './features/editor/BufferRecoveryBanner';
import type { SettingsTabId } from './features/settings/SettingsModal';
import { LockScreen } from './features/auth/LockScreen';
import { LazyOverlay, LazyPanel } from './components/LazyPanel';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAgentStore } from './stores/agentStore';
import { useChangesStore } from './stores/changesStore';
import { useProject, useProjectStore } from './stores/projectStore';
import { useUsageStore } from './stores/usageStore';
import { useLocalLlmStore } from './stores/localLlmStore';
import { useQueueStore } from './stores/queueStore';
import { useSessionsStore } from './stores/sessionsStore';
import { useSpacesStore } from './stores/spacesStore';
import { useFollowUpStore } from './stores/followupStore';
import { useHealthStore } from './stores/healthStore';
import { ProviderHealthBanner } from './components/ProviderHealthBanner';
import { projectName } from './lib/session-badge';
import { samePath } from './lib/paths';
import { useUiStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { useCatalogStore } from './stores/catalogStore';
import { toast } from './stores/toastStore';
import { notify } from './lib/notify';
import { insideTerminal } from './lib/keyboard';
import { useTranslation } from 'react-i18next';
import { WorkspaceMode, GitStatusSummary, ApprovalRequest } from '../shared/types';
import { THEME_CLASSES, themeClasses } from '../shared/theme';

/**
 * Screens that are only ever looked at on demand are fetched on demand.
 *
 * The interface used to pull in every screen at launch: xterm's terminal, the
 * Monaco wrapper, the whole settings tree with its provider catalogue, the
 * search and palette modals. None of that is on the first screen in agent mode,
 * yet all of it had to be parsed and compiled before the app could paint — cost
 * that a low-end machine pays on every launch and never gets back. Each of these
 * is now a separate chunk fetched the moment its screen is first shown.
 *
 * `LockScreen` and the approval dialog deliberately stay in the initial bundle:
 * both are on the critical path of a launch and a permission prompt, where a
 * network-free disk read is still a delay the user would feel.
 */
const EditorWorkspace = React.lazy(() =>
  import('./features/editor/EditorWorkspace').then((m) => ({ default: m.EditorWorkspace }))
);
const TerminalPanel = React.lazy(() =>
  import('./features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel }))
);
const SettingsModal = React.lazy(() =>
  import('./features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ProjectPickerDialog = React.lazy(() =>
  import('./features/project/ProjectPickerDialog').then((m) => ({ default: m.ProjectPickerDialog }))
);
const OnboardingModal = React.lazy(() =>
  import('./features/onboarding/OnboardingModal').then((m) => ({ default: m.OnboardingModal }))
);
const SearchModal = React.lazy(() =>
  import('./features/search/SearchModal').then((m) => ({ default: m.SearchModal }))
);
const CommandPalette = React.lazy(() =>
  import('./features/search/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);

/** Sidebar bounds, so a drag cannot collapse the chat surface entirely. */
const RIGHT_PANEL_MIN = 260;
const RIGHT_PANEL_MAX = 620;

const App: React.FC = () => {
  const { t } = useTranslation();
  const {
    workspaceMode,
    setWorkspaceMode,
    leftPanelOpen,
    toggleLeftPanel,
    rightPanelOpen,
    toggleRightPanel,
    rightPanelTab,
    showRightPanel,
    explorerOpen,
    explorerWidth,
    toggleExplorer,
    setExplorerWidth,
    outlineOpen,
    toggleOutline
  } = useUiStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('account');
  /** Provider keys live in their own dialog now — see `ProviderDialog`. */
  const [providerView, setProviderView] = useState<'list' | 'add' | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  /** True while the folder picker is on screen, so its button cannot be doubled. */
  const [openingProject, setOpeningProject] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [showTerminal, setShowTerminal] = useState(true);

  // Panels are resizable and hideable (spec §60).
  const [rightWidth, setRightWidth] = useState(360);
  const dragRef = useRef<{ edge: 'right' | 'explorer'; startX: number; startWidth: number } | null>(null);

  const { settings, providers, loadSettings } = useSettingsStore();
  const { state: authState, loading: authLoading, load: loadAuth } = useAuthStore();
  const isLocked = !!authState && authState.required && !authState.signedIn;
  const { status, updateStatus, addTimelineItem, setTodos, pendingSend, timeline } = useAgentStore();
  const { addChange } = useChangesStore();
  const {
    projectPath,
    setProjectPath,
    markExternallyChanged,
    checkForRecoveredBuffers,
    cycleActiveFile,
    closeFile,
    activeFilePath
  } = useProject((s) => ({
    projectPath: s.projectPath,
    setProjectPath: s.setProjectPath,
    markExternallyChanged: s.markExternallyChanged,
    checkForRecoveredBuffers: s.checkForRecoveredBuffers,
    cycleActiveFile: s.cycleActiveFile,
    closeFile: s.closeFile,
    activeFilePath: s.activeFilePath
  }));
  const { load: loadUsage, setSummary, setTokenStats } = useUsageStore();
  const { runNext, settleRunning, items: queueItems } = useQueueStore();
  const { refresh: refreshSessions, setActive: setActiveSession } = useSessionsStore();
  const startUpdateWatch = useUpdateStore((s) => s.start);
  const startCatalogWatch = useCatalogStore((s) => s.start);
  const startHealthWatch = useHealthStore((s) => s.start);

  const openSettings = useCallback((tab?: SettingsTabId) => {
    if (tab) setSettingsTab(tab);
    setIsSettingsOpen(true);
  }, []);

  /**
   * `'providers'` used to be a Settings tab. Every caller that asked for it now
   * opens the provider dialog instead, so no entry point loses its destination.
   */
  const openSettingsOrProviders = useCallback(
    (tab?: string) => {
      if (tab === 'providers') setProviderView('list');
      else openSettings(tab as SettingsTabId | undefined);
    },
    [openSettings]
  );

  const openProviders = useCallback((view?: 'list' | 'add') => setProviderView(view ?? 'list'), []);

  const { sessionId } = useAgentStore();
  const spaces = useSpacesStore((state) => state.spaces);

  /**
   * Moves the app into another space.
   *
   * The path is already known, so there is no dialog — that is the whole point of
   * keeping spaces on the rail. The folder is still checked before the switch: a
   * space outlives the folder it names (the user may move or delete it), and
   * landing in a workspace whose tree cannot be read would look like a broken
   * app. The conversation is cleared because it belongs to a thread in the space
   * that is being left; this space's own threads are listed in the strip.
   */
  const switchToSpace = useCallback(
    async (dir: string) => {
      if (!window.electronAPI) return;
      const opened = await window.electronAPI.openProjectPath(dir).catch(() => false);
      if (!opened) {
        toast.error(t('project.missing'), dir);
        return;
      }
      useProjectStore.getState().setProjectPath(dir);
      useAgentStore.getState().clearSession();
      setActiveSession(null);
      // The main process has just recorded it; this keeps the rail instant.
      useSpacesStore.getState().add(dir);
      await refreshSessions(null, projectName(dir) || t('nav.sessionDefault'));
    },
    [refreshSessions, setActiveSession, t]
  );

  /**
   * A space is a project folder, so opening one starts by asking for the folder.
   *
   * Cancelling is a no-op: a space with no folder behind it would be a tab whose
   * files cannot be listed. Opening it clears the conversation and re-scopes the
   * strip to that project's sessions — no tab is invented for the empty room.
   *
   * The chosen folder is remembered by the main process the moment it is opened,
   * which is what puts it on the rail — including for entry points that never go
   * through this function (a prompt that needed a folder, a restored workspace).
   */
  const handleNewSpace = useCallback(async () => {
    if (!window.electronAPI) return;
    // The dialog is modal but the button behind it is not, and a second click
    // while the folder picker is open would open a second picker.
    setOpeningProject(true);
    try {
      const dir = await window.electronAPI.openProjectDialog();
      if (!dir) return;
      await switchToSpace(dir);
      toast.success(t('palette.newSpaceOpened', { project: projectName(dir) || dir }));
    } finally {
      setOpeningProject(false);
    }
  }, [switchToSpace, t]);

  /**
   * "New thread" from the tab strip (and Ctrl+T): the + opens a tab, the way a
   * browser does.
   *
   * The conversation that was on screen keeps its own tab and its own transcript,
   * and the new one sits beside it, empty, until the first prompt gives it a
   * session. It used to clear the view in place instead: nothing was added, so
   * the + looked like it had thrown the current conversation away and put nothing
   * in its place.
   *
   * A *space* is the other +: the one on the rail picks a project folder. Two
   * icons, two jobs — a thread is something you type in, a space is somewhere
   * those threads live.
   */
  const handleNewThread = useCallback(() => {
    useSessionsStore.getState().newTab();
  }, []);

  /**
   * Opens a thread from the sidebar, switching project first when it belongs to
   * another folder.
   *
   * A session is replayed from the database and keeps writing into the folder it
   * was created in, so resuming one while a different project is open would leave
   * the view and the folder disagreeing about where the work is.
   */
  const handleOpenThread = useCallback(
    async (sessionId: string, path?: string) => {
      if (path && projectPath && !samePath(path, projectPath)) {
        await switchToSpace(path);
      }
      await useSessionsStore.getState().select(sessionId);
    },
    [projectPath, switchToSpace]
  );

  /**
   * Takes a folder off the rail. The project stays exactly where it is — the
   * sessions, the files and the history are untouched — and if it happens to be
   * the open one, the workspace is not disturbed either: the user said "stop
   * showing me this", not "close it".
   */
  const handleForgetSpace = useCallback(
    async (path: string) => {
      await useSpacesStore.getState().forget(path);
      toast.info(t('nav.spaceForgotten', { name: projectName(path) || path }));
    },
    [t]
  );

  /**
   * The tab strip mirrors the stored sessions, plus whatever is live right now.
   *
   * `projectPath` is a dependency because the strip is *one project's*
   * conversations: the folder that was open last is restored after the first
   * render, and without this the strip kept listing every other project's
   * sessions until something else happened to move.
   */
  useEffect(() => {
    void refreshSessions(sessionId, t('nav.newSession'));
  }, [sessionId, projectPath, refreshSessions, t]);

  /**
   * The rail's spaces come from the main process, which records a folder the
   * moment it is opened. Read once at launch, and again whenever the open
   * project moves — which is exactly when the list can have changed.
   */
  const loadSpaces = useSpacesStore((state) => state.load);
  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces, projectPath]);

  // The suggested-prompt chips belong to the conversation that just finished:
  // a different session id is a different conversation, and its old offer would
  // be answering a question nobody asked here.
  useEffect(() => {
    useFollowUpStore.getState().clear();
  }, [sessionId]);

  // The sign-in gate is checked before anything else is loaded: while it is on,
  // nothing the app would fetch should be put on screen behind it.
  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    loadSettings();
    loadUsage();
    // Offer back anything a crash left unsaved (spec §84).
    void checkForRecoveredBuffers();
    // Listening only: the schedules that decide *when* to look live in the main
    // process, so reloading this window cannot restart them or lose them.
    startUpdateWatch();
    startCatalogWatch();
    startHealthWatch();
    // The one-time local-LLM nudge listens here; the main process decides
    // whether an offer is ever pushed.
    useLocalLlmStore.getState().start();

    if (!window.electronAPI) return;

    const unsubscribeAgent = window.electronAPI.onAgentEvent((data) => {
      if (data.type === 'timeline') addTimelineItem(data.item);
      else if (data.type === 'status') updateStatus(data.status);
      else if (data.type === 'todos') setTodos(data.todos);
      else if (data.type === 'file_change') addChange(data.change);
      else if (data.type === 'stats') setTokenStats(data.stats);
      // Next-move chips for the run that just ended; see `followupStore`.
      else if (data.type === 'suggestions') useFollowUpStore.getState().setSuggestions(data.suggestions ?? []);
    });

    const unsubscribeUsage = window.electronAPI.onUsageEvent((summary) => setSummary(summary));
    // `null` means the main process answered the request itself — the user
    // switched to Full or the run was cancelled — so the dialog comes down.
    const unsubscribeApproval = window.electronAPI.onApprovalRequest((request) =>
      setApprovalRequest(request ?? null)
    );

    // A request sent while this window was reloading never reached anyone, and
    // the run would wait on it forever. Ask main whether one is still open.
    void window.electronAPI
      .getAgentSessionState?.()
      .then((state: { pendingApproval?: ApprovalRequest | null } | null) => {
        if (state?.pendingApproval) setApprovalRequest(state.pendingApproval);
      })
      .catch(() => undefined);

    // A bridge that answers `undefined` here must not take the whole app down
    // with it: cleanup is the one place where an exception is unrecoverable.
    return () => {
      for (const unsubscribe of [unsubscribeAgent, unsubscribeUsage, unsubscribeApproval]) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, [
    loadSettings,
    loadUsage,
    startUpdateWatch,
    startCatalogWatch,
    addTimelineItem,
    updateStatus,
    setTodos,
    addChange,
    setSummary,
    setTokenStats
  ]);

  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);

  useEffect(() => {
    if (settings && !settings.firstRunComplete) setIsOnboardingOpen(true);
  }, [settings]);

  // Appearance (spec §74): a theme is a class on the root element, and every
  // class a theme could carry is cleared first — a leftover class from the
  // previous theme would mix two palettes together.
  useEffect(() => {
    const root = document.documentElement;
    for (const name of THEME_CLASSES) root.classList.remove(name);
    for (const name of themeClasses(settings?.theme)) root.classList.add(name);
    document.body.style.fontSize = settings?.fontSize ? `${settings.fontSize}px` : '';
  }, [settings?.theme, settings?.fontSize]);

  // Surface a finished task the way the spec asks for: one compact notification,
  // and never a wall of popups (§53).
  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      loadUsage();
      if (projectPath && window.electronAPI) {
        window.electronAPI.gitStatus(projectPath).then(setGitStatus).catch(() => setGitStatus(null));
      }
      if (status === 'completed') {
        notify(t('notify.taskCompleted'), t('notify.taskCompletedBody'), 'task');
      } else if (status === 'failed') {
        notify(t('notify.taskFailed'), t('notify.taskFailedBody'), 'error');
      } else if (status === 'cancelled') {
        // A session that stopped is one of the four things worth a popup: the
        // run ended without finishing, and by then the user has usually looked
        // away from a job they believed was still going.
        notify(t('notify.sessionStopped'), t('notify.sessionStoppedBody'), 'session');
      }
      // Close out the queued task that just ran before starting the next one.
      settleRunning(status);
      if (status === 'completed' && queueItems.some((i) => i.status === 'queued')) runNext();
    }
  }, [status]);

  // A pending approval is the one thing that must never be missed.
  useEffect(() => {
    if (approvalRequest) notify(t('notify.approvalNeeded'), approvalRequest.toolCall.name, 'approval');
  }, [approvalRequest]);

  /**
   * The newest thing the run is parked on: a question, a plan or a design.
   *
   * Answering cannot happen from a notification, so its whole job is to bring the
   * user back to the card — which means it may be raised once per ask, not on
   * every timeline item that arrives while the run waits.
   */
  const lastAsk = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const type = timeline[i].type;
      if (type === 'plan' || type === 'design' || type === 'question') return timeline[i];
    }
    return null;
  }, [timeline]);
  const notifiedAsk = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'waiting_approval' || !lastAsk || notifiedAsk.current === lastAsk.id) return;
    notifiedAsk.current = lastAsk.id;
    // A question is the agent stopping to think *with* the user instead of for
    // them — the one pause that is wasted time if nobody notices it.
    if (lastAsk.type === 'question') {
      notify(t('notify.questionAsked'), t('notify.questionAskedBody'), 'question');
    } else if (lastAsk.type === 'plan') {
      notify(t('notify.planReady'), t('notify.planReadyBody'), 'approval');
    }
  }, [status, lastAsk, t]);

  useEffect(() => {
    if (projectPath && window.electronAPI) {
      window.electronAPI.gitStatus(projectPath).then(setGitStatus).catch(() => setGitStatus(null));
    }
  }, [projectPath]);

  /**
   * Reopens the project that was open when the app last closed.
   *
   * An IDE that forgets its folder is not resumable: after a reload or a restart
   * the strip has no project to belong to, so it falls back to listing every
   * session in the database, the file tree is empty and git has nothing to
   * report. The most recently opened folder is already recorded, so this simply
   * does what the user would have done first.
   *
   * Skipped during onboarding, which asks for a folder itself, and never over a
   * project the user opened while this was in flight.
   */
  const restoredProject = useRef(false);
  useEffect(() => {
    if (restoredProject.current) return;
    if (!settings || !settings.firstRunComplete || projectPath) return;
    const last = settings.recentProjects?.[0];
    if (!last || !window.electronAPI) return;
    restoredProject.current = true;
    void window.electronAPI
      .openProjectPath(last)
      .then((opened: boolean) => {
        // Never over a folder the user opened while this was in flight.
        if (opened && !useProjectStore.getState().projectPath) setProjectPath(last);
      })
      .catch(() => undefined);
  }, [settings, projectPath, setProjectPath]);

  // Watch the project for changes made outside the app (spec §48).
  useEffect(() => {
    if (!window.electronAPI) return;
    if (!projectPath) {
      window.electronAPI.stopFileWatcher();
      return;
    }

    window.electronAPI.startFileWatcher(projectPath);
    const unsubscribe = window.electronAPI.onFileChanged((events) => {
      markExternallyChanged(events.map((event) => event.relativePath));
    });

    return () => {
      unsubscribe();
      window.electronAPI?.stopFileWatcher();
    };
  }, [projectPath, markExternallyChanged]);

  // Global shortcuts (spec §61).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (e.shiftKey && key === 'p') {
        e.preventDefault();
        setIsPaletteOpen(true);
      } else if (e.shiftKey && key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (key === 'p') {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (key === ',') {
        e.preventDefault();
        openSettings();
      } else if (key === '`') {
        e.preventDefault();
        setShowTerminal((v) => !v);
      } else if (key === 't' && !insideTerminal(e.target)) {
        // Ctrl+T opens a thread, the way a browser opens a tab. Inside the
        // terminal the keystroke belongs to the shell — bash reads Ctrl+T as
        // transpose-chars — so there it is left alone.
        e.preventDefault();
        handleNewThread();
      } else if (e.shiftKey && key === 'b') {
        e.preventDefault();
        toggleRightPanel();
      } else if (e.shiftKey && key === 'e') {
        e.preventDefault();
        toggleExplorer();
      } else if (key === 'tab') {
        // Ctrl+Tab / Ctrl+Shift+Tab move between open editor tabs (spec §61).
        e.preventDefault();
        cycleActiveFile(e.shiftKey ? -1 : 1);
      } else if (key === 'w' && activeFilePath && workspaceMode === 'code') {
        e.preventDefault();
        closeFile(activeFilePath);
      } else if (key === 'b') {
        e.preventDefault();
        setWorkspaceMode(workspaceMode === 'agent' ? 'code' : 'agent');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    openSettings,
    cycleActiveFile,
    closeFile,
    activeFilePath,
    workspaceMode,
    setWorkspaceMode,
    toggleRightPanel,
    toggleExplorer,
    handleNewThread
  ]);

  // Drag-to-resize for the side panels.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      if (drag.edge === 'right') {
        setRightWidth(Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, drag.startWidth - delta)));
      } else {
        setExplorerWidth(drag.startWidth + delta);
      }
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [setExplorerWidth]);

  const startDrag = (edge: 'right' | 'explorer') => (e: React.MouseEvent) => {
    dragRef.current = { edge, startX: e.clientX, startWidth: edge === 'right' ? rightWidth : explorerWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResolveApproval = async (
    id: string,
    decision: 'approved' | 'approved_for_session' | 'rejected',
    toolName?: string
  ) => {
    const answered = approvalRequest;
    setApprovalRequest(null);
    try {
      const accepted = await window.electronAPI?.resolveApproval(id, decision, toolName);
      // `false` means the run had already moved on (cancelled, or answered on
      // another screen). Saying so beats a dialog that closed and did nothing.
      if (accepted === false) toast.info(t('approval.alreadyAnswered'));
    } catch (e) {
      // Putting the dialog back is the only honest recovery: without it the
      // agent waits for an answer nobody can see a way to give.
      console.error('Approval could not be delivered:', e);
      toast.error(t('approval.notDelivered'));
      if (answered) setApprovalRequest(answered);
    }
  };

  const activeProvider = providers.find((p) => p.id === settings?.activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === settings?.activeModelId);
  const modelLabel =
    settings?.activeProviderId === 'auto'
      ? `${t('agent.auto')} · ${t(`settings.routing_${settings.routingProfile}`)}`
      : activeModel?.name || settings?.activeModelId || '—';

  // Locked: the IDE is not rendered at all, so nothing behind the gate can be
  // clicked, focused or reached with a keyboard shortcut.
  if (authLoading || isLocked) {
    return (
      <div className="w-screen h-screen flex flex-col bg-d4-bg text-d4-text font-sans overflow-hidden">
        {isLocked ? <LockScreen /> : <div className="flex-1" />}
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-d4-bg text-d4-text font-sans overflow-hidden">
      <TitleBar
        workspaceMode={workspaceMode}
        onToggleMode={setWorkspaceMode}
        leftPanelOpen={leftPanelOpen}
        onToggleLeftPanel={toggleLeftPanel}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={toggleRightPanel}
        outlineOpen={outlineOpen}
        onToggleOutline={toggleOutline}
        onNewThread={handleNewThread}
        onNewSpace={() => void handleNewSpace()}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenPalette={() => setIsPaletteOpen(true)}
        onOpenSessions={() => openSettings('sessions')}
        onOpenSettings={() => openSettings()}
        onToggleTerminal={() => setShowTerminal((v) => !v)}
        terminalOpen={showTerminal}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {!projectPath ? (
          /*
           * Nothing is open yet. The workspace — rail, tree, timeline, panel —
           * is all furniture for a project that is not there, so it is not
           * drawn at all: an empty shell of it is indistinguishable from a
           * broken one.
           */
          <ProjectEmptyState onOpen={() => void handleNewSpace()} busy={openingProject} />
        ) : (
          <>
        {leftPanelOpen && (
          <LeftNav
            spaces={spaces}
            onSelectSpace={(path) => void switchToSpace(path)}
            onForgetSpace={(path) => void handleForgetSpace(path)}
            onOpenSettings={() => openSettings()}
            onOpenPalette={() => setIsPaletteOpen(true)}
            onNewSpace={() => void handleNewSpace()}
            onNewThread={handleNewThread}
            onSelectThread={(id, path) => void handleOpenThread(id, path)}
            onOpenGit={() => showRightPanel('git')}
            onHide={toggleLeftPanel}
          />
        )}

        <main className="flex-1 flex flex-col bg-d4-bg overflow-hidden min-w-0">
          {workspaceMode === 'agent' ? (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <SessionRecoveryBanner />
                <ProviderHealthBanner />
                <AgentTimeline />
                <Composer
                  onOpenSettings={(tab) => openSettingsOrProviders(tab)}
                  onOpenProviders={openProviders}
                  onOpenDesign={() => openSettings('project')}
                />
              </div>
              {outlineOpen && <ConversationMap onClose={toggleOutline} />}
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <BufferRecoveryBanner />
              <div className="flex-1 flex overflow-hidden min-h-0">
                {explorerOpen && (
                  <>
                    <FileExplorer width={explorerWidth} onClose={toggleExplorer} />
                    <div
                      onMouseDown={startDrag('explorer')}
                      className="w-1 shrink-0 cursor-col-resize bg-d4-border-subtle hover:bg-d4-accent/50 transition-colors"
                    />
                  </>
                )}
                <LazyPanel label={t('editor.loadingEditor')}>
                  <EditorWorkspace />
                </LazyPanel>
              </div>
              {showTerminal && (
                <LazyPanel label={t('terminal.loading')} height="10rem">
                  <TerminalPanel onClose={() => setShowTerminal(false)} />
                </LazyPanel>
              )}
            </div>
          )}
        </main>

        {rightPanelOpen && (
          <>
            <div
              onMouseDown={startDrag('right')}
              className="w-1 shrink-0 cursor-col-resize bg-d4-border-subtle hover:bg-d4-accent/50 transition-colors"
            />
            <RightSidebar
              width={rightWidth}
              activeTab={rightPanelTab as RightPanelTab}
              onTabChange={(tab) => showRightPanel(tab)}
              onClose={toggleRightPanel}
              onOpenSettings={(tab) => openSettings(tab as SettingsTabId)}
            />
          </>
        )}
          </>
        )}
      </div>

      <StatusBar
        gitStatus={gitStatus}
        onOpenSettings={openSettings}
        onOpenGit={() => showRightPanel('git')}
        onToggleTerminal={() => setShowTerminal((v) => !v)}
        onToggleExplorer={toggleExplorer}
        workspaceMode={workspaceMode}
        onSetWorkspaceMode={setWorkspaceMode}
      />

      {/*
        Each dialog is mounted only while it is open. Keeping them mounted with
        `isOpen={false}` still fetched and parsed their chunks at launch, which is
        the cost this is meant to avoid; their own open/close state lives in App
        or in a store, so nothing is lost when they unmount.
      */}
      {isSettingsOpen && (
        <LazyOverlay>
          <SettingsModal
            isOpen
            initialTab={settingsTab}
            onClose={() => setIsSettingsOpen(false)}
            /* Keys and models live in the provider dialog; the settings page
               only points at it, so there is one place that edits them. */
            onOpenProviders={openProviders}
            onOpenProject={(path) => void switchToSpace(path)}
          />
        </LazyOverlay>
      )}
      {providerView && (
        <LazyOverlay>
          <ProviderDialog initialView={providerView} onClose={() => setProviderView(null)} />
        </LazyOverlay>
      )}
      {pendingSend && (
        <LazyOverlay>
          <ProjectPickerDialog />
        </LazyOverlay>
      )}
      {isOnboardingOpen && (
        <LazyOverlay>
          <OnboardingModal
            isOpen
            onClose={() => setIsOnboardingOpen(false)}
            onOpenSettings={() => openProviders('list')}
          />
        </LazyOverlay>
      )}
      {isSearchOpen && (
        <LazyOverlay>
          <SearchModal isOpen onClose={() => setIsSearchOpen(false)} />
        </LazyOverlay>
      )}
      {isPaletteOpen && (
        <LazyOverlay>
          <CommandPalette
            isOpen
            onClose={() => setIsPaletteOpen(false)}
            onOpenSettings={(tab) => openSettingsOrProviders(tab)}
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenPanel={showRightPanel}
            onSetWorkspaceMode={setWorkspaceMode}
            onToggleExplorer={toggleExplorer}
            onToggleTerminal={() => setShowTerminal((v) => !v)}
          />
        </LazyOverlay>
      )}
      <ApprovalDialog request={approvalRequest} onResolve={handleResolveApproval} />
      <UpdatePrompt />
      <LocalLlmPrompt />
      <ToastHost />
    </div>
  );
};

export default App;
