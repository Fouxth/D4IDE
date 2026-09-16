import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { LeftNav } from './components/LeftNav';
import { AgentTimeline } from './features/agent/AgentTimeline';
import { Composer } from './features/agent/Composer';
import { FileExplorer } from './features/explorer/FileExplorer';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { RightSidebar } from './features/right-sidebar/RightSidebar';
import { SettingsModal } from './features/settings/SettingsModal';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { SearchModal } from './features/search/SearchModal';
import { useSettingsStore } from './stores/settingsStore';
import { useAgentStore } from './stores/agentStore';
import { useChangesStore } from './stores/changesStore';
import { useProjectStore } from './stores/projectStore';
import { WorkspaceMode, GitStatusSummary } from '../shared/types';
import { GitBranch, Shield, Sparkles, AlertTriangle } from 'lucide-react';

export const App: React.FC = () => {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('agent');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);

  const { settings, loadSettings } = useSettingsStore();
  const { addTimelineItem, updateStatus, setTodos } = useAgentStore();
  const { addChange } = useChangesStore();
  const { projectPath } = useProjectStore();

  // Initialize settings and listeners
  useEffect(() => {
    loadSettings();

    // Listen to agent backend events
    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onAgentEvent((data) => {
        if (data.type === 'timeline') {
          addTimelineItem(data.item);
        } else if (data.type === 'status') {
          updateStatus(data.status);
        } else if (data.type === 'todos') {
          setTodos(data.todos);
        } else if (data.type === 'file_change') {
          addChange(data.change);
        }
      });
      return () => {
        unsubscribe();
      };
    }
  }, [loadSettings, addTimelineItem, updateStatus, setTodos, addChange]);

  // Check first-run onboarding
  useEffect(() => {
    if (settings && !settings.firstRunComplete) {
      setIsOnboardingOpen(true);
    }
  }, [settings]);

  // Poll git status
  useEffect(() => {
    if (projectPath && window.electronAPI) {
      window.electronAPI.gitStatus(projectPath).then(setGitStatus).catch(() => setGitStatus(null));
    }
  }, [projectPath]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-d4-bg text-d4-text font-sans select-none overflow-hidden">
      {/* 1. Window Title Bar */}
      <TitleBar workspaceMode={workspaceMode} onToggleMode={setWorkspaceMode} />

      {/* 2. Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* 2.1 Left Navigation */}
        <LeftNav
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSearch={() => setIsSearchOpen(true)}
        />

        {/* 2.2 Central Workspace (Agent View vs Code View) */}
        <main className="flex-1 flex flex-col bg-d4-panel overflow-hidden">
          {workspaceMode === 'agent' ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <AgentTimeline />
              <Composer />
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="flex-1 flex overflow-hidden">
                <FileExplorer />
                <EditorWorkspace />
              </div>
              <TerminalPanel />
            </div>
          )}
        </main>

        {/* 2.3 Right Sidebar */}
        <RightSidebar />
      </div>

      {/* 3. Bottom Status Bar */}
      <footer className="h-6 bg-d4-bg border-t border-d4-border flex items-center justify-between px-3 text-[11px] text-d4-dimmed select-none z-30">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 hover:text-d4-text cursor-pointer">
            <GitBranch className="w-3 h-3 text-d4-muted" />
            <span>{gitStatus?.branch || 'main'}</span>
          </div>
          <div className="flex items-center space-x-1">
            <Shield className="w-3 h-3 text-emerald-400" />
            <span className="capitalize">{settings?.permissionMode || 'safe'} mode</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <Sparkles className="w-3 h-3 text-d4-accent" />
            <span className="font-mono text-d4-muted">{settings?.activeModelId || 'DeepSeek V3'}</span>
          </div>
          <span>Language: {settings?.language === 'th' ? 'ภาษาไทย' : 'English'}</span>
        </div>
      </footer>

      {/* Modals */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};
export default App;
