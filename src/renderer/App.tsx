import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { LeftNav } from './components/LeftNav';
import { StatusBar } from './components/StatusBar';
import { ToastHost } from './components/ToastHost';
import { UpdateBanner } from './components/UpdateBanner';
import { AgentTimeline } from './features/agent/AgentTimeline';
import { ConversationMap } from './features/agent/ConversationMap';
import { Composer } from './features/agent/Composer';
import { SessionRecoveryBanner } from './features/agent/SessionRecoveryBanner';
import { ApprovalDialog } from './features/agent/ApprovalDialog';
import { FileExplorer } from './features/explorer/FileExplorer';
import { RightSidebar, RightPanelTab } from './features/right-sidebar/RightSidebar';
import { BufferRecoveryBanner } from './features/editor/BufferRecoveryBanner';
import type { SettingsTabId } from './features/settings/SettingsModal';
import { LockScreen } from './features/auth/LockScreen';
import { LazyOverlay, LazyPanel } from './components/LazyPanel';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAgentStore } from './stores/agentStore';
import { useChangesStore } from './stores/changesStore';
import { useProject } from './stores/projectStore';
import { useUsageStore } from './stores/usageStore';
import { useQueueStore } from './stores/queueStore';
import { useSessionsStore } from './stores/sessionsStore';
import { useUiStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';
import { useCatalogStore } from './stores/catalogStore';
import { toast } from './stores/toastStore';
import { notify } from './lib/notify';
import { useTranslation } from 'react-i18next';
import { WorkspaceMode, GitStatusSummary, ApprovalRequest } from '../shared/types';

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
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('providers');
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [showTerminal, setShowTerminal] = useState(true);

  // Panels are resizable and hideable (spec §60).
  const [rightWidth, setRightWidth] = useState(360);
  const dragRef = useRef<{ edge: 'right' | 'explorer'; startX: number; startWidth: number } | null>(null);

  const { settings, providers, loadSettings } = useSettingsStore();
  const { state: authState, loading: authLoading, load: loadAuth } = useAuthStore();
  const isLocked = !!authState && authState.required && !authState.signedIn;
  const { status, updateStatus, addTimelineItem, setTodos, pendingSend } = useAgentStore();
  const { addChange } = useChangesStore();
  const { projectPath, markExternallyChanged, checkForRecoveredBuffers, cycleActiveFile, closeFile, activeFilePath } =
    useProject((s) => ({
      projectPath: s.projectPath,
      markExternallyChanged: s.markExternallyChanged,
      checkForRecoveredBuffers: s.checkForRecoveredBuffers,
      cycleActiveFile: s.cycleActiveFile,
      closeFile: s.closeFile,
      activeFilePath: s.activeFilePath
    }));
  const { load: loadUsage, setSummary, setTokenStats, lastWarning, clearWarning } = useUsageStore();
  const { runNext, settleRunning, items: queueItems } = useQueueStore();
  const { refresh: refreshSessions, setActive: setActiveSession } = useSessionsStore();
  const startUpdateWatch = useUpdateStore((s) => s.start);
  const startCatalogWatch = useCatalogStore((s) => s.start);

  const openSettings = useCallback((tab: SettingsTabId = 'providers') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  }, []);

  const { sessionId } = useAgentStore();

  /**"New session" from the tab strip: a fresh conversation, nothing deleted. */
  const handleNewSession = useCallback(() => {
    useAgentStore.getState().clearSession();
    setActiveSession(null);
    // The strip effect only reruns when the session id changes, so clearing an
    // already-empty view would leave it stale — refresh it explicitly so the
    // placeholder tab exists and is the one highlighted.
    void refreshSessions(null, t('nav.newSession'));
    // Say so out loud: clearing an already-empty view looks like a dead button,
    // and this is the button people press when they think the app is stuck.
    toast.info(t('palette.newSessionDone'));
  }, [setActiveSession, refreshSessions, t]);

  // The tab strip mirrors the stored sessions, plus whatever is live right now.
  useEffect(() => {
    void refreshSessions(sessionId, t('nav.newSession'));
  }, [sessionId, refreshSessions, t]);

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

    if (!window.electronAPI) return;

    const unsubscribeAgent = window.electronAPI.onAgentEvent((data) => {
      if (data.type === 'timeline') addTimelineItem(data.item);
      else if (data.type === 'status') updateStatus(data.status);
      else if (data.type === 'todos') setTodos(data.todos);
      else if (data.type === 'file_change') addChange(data.change);
      else if (data.type === 'stats') setTokenStats(data.stats);
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

  // Appearance (spec §74): D4 Dark is the default, D4 Light is a class on the root.
  useEffect(() => {
    const light = settings?.theme === 'd4-light';
    document.documentElement.classList.toggle('d4-light', light);
    document.documentElement.classList.toggle('dark', !light);
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
        notify(t('notify.taskCompleted'), t('notify.taskCompletedBody'));
      } else if (status === 'failed') {
        notify(t('notify.taskFailed'), t('notify.taskFailedBody'));
      }
      // Close out the queued task that just ran before starting the next one.
      settleRunning(status);
      if (status === 'completed' && queueItems.some((i) => i.status === 'queued')) runNext();
    }
  }, [status]);

  // A pending approval is the one thing that must never be missed.
  useEffect(() => {
    if (approvalRequest) notify(t('notify.approvalNeeded'), approvalRequest.toolCall.name);
  }, [approvalRequest]);

  useEffect(() => {
    if (lastWarning) {
      if (lastWarning.level === 'exceeded') {
        // One toast, not a toast plus a desktop notification for the same fact.
        // The run also leaves a stop note in the timeline, so the warning is not
        // the only record of why work stopped.
        toast.error(t('usage.budgetExceeded'), lastWarning.message);
      } else {
        toast.warning(t('usage.budgetWarning'), lastWarning.message);
      }
      clearWarning();
    }
  }, [lastWarning, clearWarning, t]);

  useEffect(() => {
    if (projectPath && window.electronAPI) {
      window.electronAPI.gitStatus(projectPath).then(setGitStatus).catch(() => setGitStatus(null));
    }
  }, [projectPath]);

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
        openSettings('providers');
      } else if (key === '`') {
        e.preventDefault();
        setShowTerminal((v) => !v);
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
    toggleExplorer
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
        onNewSession={handleNewSession}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenPalette={() => setIsPaletteOpen(true)}
        onOpenSessions={() => openSettings('sessions')}
        onOpenSettings={() => openSettings('providers')}
        onToggleTerminal={() => setShowTerminal((v) => !v)}
        terminalOpen={showTerminal}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {leftPanelOpen && (
          <LeftNav
            onOpenSettings={() => openSettings('providers')}
            onOpenPalette={() => setIsPaletteOpen(true)}
            onOpenSessions={() => openSettings('sessions')}
            onNewSession={handleNewSession}
            onOpenGit={() => showRightPanel('git')}
            onHide={toggleLeftPanel}
          />
        )}

        <main className="flex-1 flex flex-col bg-d4-bg overflow-hidden min-w-0">
          {workspaceMode === 'agent' ? (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <UpdateBanner />
                <SessionRecoveryBanner />
                <AgentTimeline />
                <Composer
                  onOpenSettings={(tab) => openSettings((tab as SettingsTabId) || 'providers')}
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
          <SettingsModal isOpen initialTab={settingsTab} onClose={() => setIsSettingsOpen(false)} />
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
            onOpenSettings={() => openSettings('providers')}
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
            onOpenSettings={(tab) => openSettings((tab as SettingsTabId) || 'providers')}
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenPanel={showRightPanel}
            onSetWorkspaceMode={setWorkspaceMode}
            onToggleExplorer={toggleExplorer}
            onToggleTerminal={() => setShowTerminal((v) => !v)}
          />
        </LazyOverlay>
      )}
      <ApprovalDialog request={approvalRequest} onResolve={handleResolveApproval} />
      <ToastHost />
    </div>
  );
};

export default App;
