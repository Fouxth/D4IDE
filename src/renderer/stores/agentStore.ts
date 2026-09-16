import { create } from 'zustand';
import { AgentMode, AgentStatus, AgentTimelineItem, AgentTodo, PlanData } from '../../shared/types';
import { useProjectStore } from './projectStore';

interface AgentState {
  mode: AgentMode;
  status: AgentStatus;
  prompt: string;
  timeline: AgentTimelineItem[];
  todos: AgentTodo[];
  currentPlan: PlanData | null;

  setMode: (mode: AgentMode) => void;
  setPrompt: (text: string) => void;
  startAgent: (customPrompt?: string) => Promise<void>;
  cancelAgent: () => Promise<void>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => Promise<void>;
  addTimelineItem: (item: AgentTimelineItem) => void;
  updateStatus: (status: AgentStatus) => void;
  setTodos: (todos: AgentTodo[]) => void;
  clearSession: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: 'build',
  status: 'idle',
  prompt: '',
  timeline: [],
  todos: [],
  currentPlan: null,

  setMode: (mode: AgentMode) => set({ mode }),
  setPrompt: (prompt: string) => set({ prompt }),

  startAgent: async (customPrompt?: string) => {
    const text = customPrompt ?? get().prompt;
    if (!text.trim() || !window.electronAPI) return;

    const projectPath = useProjectStore.getState().projectPath;
    if (!projectPath) {
      alert('Please open a project folder first.');
      return;
    }

    const { mode, timeline } = get();

    // Add user prompt to timeline
    const userItem: AgentTimelineItem = {
      id: `user_${Date.now()}`,
      type: 'message',
      title: 'User Prompt',
      content: text,
      timestamp: Date.now()
    };

    set({
      timeline: [...timeline, userItem],
      prompt: '',
      status: mode === 'plan' ? 'planning' : 'running'
    });

    try {
      await window.electronAPI.startAgent({
        prompt: text,
        mode,
        projectPath
      });
    } catch (e) {
      console.error('Failed to start agent:', e);
      set({ status: 'failed' });
    }
  },

  cancelAgent: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.cancelAgent();
    set({ status: 'cancelled' });
  },

  approvePlan: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.approvePlan();
    set({ status: 'running', mode: 'build' });
  },

  rejectPlan: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.rejectPlan();
    set({ status: 'cancelled' });
  },

  addTimelineItem: (item: AgentTimelineItem) => {
    set((state) => ({
      timeline: [...state.timeline, item],
      currentPlan: item.type === 'plan' && item.details ? item.details : state.currentPlan
    }));
  },

  updateStatus: (status: AgentStatus) => set({ status }),
  setTodos: (todos: AgentTodo[]) => set({ todos }),
  clearSession: () => set({ timeline: [], todos: [], currentPlan: null, status: 'idle' })
}));
