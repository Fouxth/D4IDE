import { create } from 'zustand';
import { TaskQueueItem, AgentMode } from '../../shared/types';
import { useAgentStore } from './agentStore';

interface QueueState {
  items: TaskQueueItem[];
  addItem: (prompt: string, mode: AgentMode) => void;
  removeItem: (id: string) => void;
  reorderItems: (startIndex: number, endIndex: number) => void;
  runNext: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],

  addItem: (prompt: string, mode: AgentMode) => {
    const newItem: TaskQueueItem = {
      id: `queue_${Date.now()}`,
      prompt,
      mode,
      status: 'queued',
      createdAt: Date.now()
    };
    set((state) => ({ items: [...state.items, newItem] }));
  },

  removeItem: (id: string) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },

  reorderItems: (startIndex: number, endIndex: number) => {
    set((state) => {
      const result = Array.from(state.items);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return { items: result };
    });
  },

  runNext: () => {
    const { items } = get();
    const nextItem = items.find((i) => i.status === 'queued');
    if (!nextItem) return;

    set((state) => ({
      items: state.items.map((i) => (i.id === nextItem.id ? { ...i, status: 'running', startedAt: Date.now() } : i))
    }));

    useAgentStore.getState().setMode(nextItem.mode);
    useAgentStore.getState().startAgent(nextItem.prompt);
  }
}));
