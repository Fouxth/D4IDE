import { create } from 'zustand';
import { WorkspaceMode } from '../../shared/types';

/**
 * Cross-cutting view state (spec §4/§60).
 *
 * `workspaceMode` and the panel switches live here rather than inside `App` so
 * that any feature — an inline editor action, the command palette, a toast —
 * can move the user to the right view without prop drilling.
 *
 * Panel geometry lives here too because "hide the sidebar" is a global command
 * (§61 shortcuts, §62 palette): the shell that renders the panels is not the
 * only thing that needs to change them.
 */
interface UiState {
  workspaceMode: WorkspaceMode;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  /** Which right-hand panel is showing; 'queue' | 'mission' | 'changes' | … */
  rightPanelTab: string;
  /** The code-view file tree, resizable and hideable like the other panels. */
  explorerOpen: boolean;
  explorerWidth: number;
  /** The conversation outline strip beside the transcript (spec §6). */
  outlineOpen: boolean;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  showRightPanel: (tab: string) => void;
  toggleExplorer: () => void;
  setExplorerWidth: (width: number) => void;
  toggleOutline: () => void;
}

export const EXPLORER_MIN_WIDTH = 160;
export const EXPLORER_MAX_WIDTH = 460;

export const useUiStore = create<UiState>((set) => ({
  workspaceMode: 'agent',
  leftPanelOpen: true,
  rightPanelOpen: true,
  // Opens on Preview: the panel's job is "show me the thing I just built", and
  // the queue is empty until the agent starts working.
  rightPanelTab: 'preview',
  explorerOpen: true,
  explorerWidth: 240,
  outlineOpen: true,

  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  showRightPanel: (rightPanelTab) => set({ rightPanelTab, rightPanelOpen: true }),
  toggleExplorer: () => set((state) => ({ explorerOpen: !state.explorerOpen })),
  setExplorerWidth: (explorerWidth) =>
    set({ explorerWidth: Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, explorerWidth)) }),
  toggleOutline: () => set((state) => ({ outlineOpen: !state.outlineOpen }))
}));
