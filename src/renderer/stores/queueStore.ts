import { create } from 'zustand';
import { TaskQueueItem, AgentMode, PromptImage } from '../../shared/types';
import { useAgentStore } from './agentStore';

/**
 * Task queue (spec §16).
 *
 * The queue is what lets a user keep working while an agent is busy: tasks wait
 * their turn, and the next one starts automatically when the current run
 * finishes. Pausing exists for the same reason — a long line of tasks must be
 * interruptible without losing it.
 */
interface QueueState {
  items: TaskQueueItem[];
  /** True while the queue is allowed to advance automatically. */
  autoRun: boolean;
  addItem: (prompt: string, mode: AgentMode, images?: PromptImage[]) => TaskQueueItem;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<TaskQueueItem>) => void;
  reorderItems: (startIndex: number, endIndex: number) => void;
  moveItem: (id: string, direction: -1 | 1) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  markDone: (id: string) => void;
  retryItem: (id: string) => void;
  runItem: (id: string) => void;
  runNext: () => void;
  /** Marks the item that was running as finished, mirroring the agent status. */
  settleRunning: (status: 'completed' | 'failed' | 'cancelled') => void;
  clearFinished: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  autoRun: true,

  addItem: (prompt, mode, images) => {
    const item: TaskQueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      prompt,
      mode,
      ...(images && images.length > 0 ? { images } : {}),
      status: 'queued',
      createdAt: Date.now()
    };
    set((state) => ({ items: [...state.items, item] }));
    return item;
  },

  removeItem: (id) => set((state) => ({ items: state.items.filter((entry) => entry.id !== id) })),

  updateItem: (id, patch) =>
    set((state) => ({ items: state.items.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) })),

  reorderItems: (startIndex, endIndex) =>
    set((state) => {
      const result = Array.from(state.items);
      if (startIndex < 0 || startIndex >= result.length) return { items: result };
      const [removed] = result.splice(startIndex, 1);
      result.splice(Math.max(0, Math.min(endIndex, result.length)), 0, removed);
      return { items: result };
    }),

  /** One-step move, used by the up/down controls (a drag is not always handy). */
  moveItem: (id, direction) =>
    set((state) => {
      const index = state.items.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= state.items.length) return { items: state.items };
      const result = Array.from(state.items);
      const [moved] = result.splice(index, 1);
      result.splice(target, 0, moved);
      return { items: result };
    }),

  pauseAll: () => {
    set((state) => ({
      autoRun: false,
      items: state.items.map((entry) =>
        entry.status === 'queued' ? { ...entry, status: 'paused' as const } : entry
      )
    }));
  },

  resumeAll: () => {
    set((state) => ({
      autoRun: true,
      items: state.items.map((entry) => (entry.status === 'paused' ? { ...entry, status: 'queued' as const } : entry))
    }));
    // Nothing is running: pick the queue back up immediately.
    const status = useAgentStore.getState().status;
    if (status === 'idle' || status === 'completed' || status === 'failed' || status === 'cancelled') get().runNext();
  },

  markDone: (id) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) return;
    set((state) => ({
      items: state.items.map((entry) =>
        entry.id === id ? { ...entry, status: 'completed' as const, finishedAt: Date.now() } : entry
      )
    }));
    // Finishing the current task is what lets the queue move on.
    if (item.status === 'running') useAgentStore.getState().updateStatus('completed');
  },

  retryItem: (id) => {
    set((state) => ({
      items: state.items.map((entry) =>
        entry.id === id ? { ...entry, status: 'queued' as const, error: undefined, finishedAt: undefined } : entry
      )
    }));
  },

  runItem: (id) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item || item.status === 'running') return;
    set((state) => ({
      items: state.items.map((entry) =>
        entry.id === id ? { ...entry, status: 'running' as const, startedAt: Date.now(), error: undefined } : entry
      )
    }));
    useAgentStore.getState().setMode(item.mode);
    void useAgentStore.getState().startAgent(item.prompt, item.images);
  },

  runNext: () => {
    if (!get().autoRun) return;
    const nextItem = get().items.find((entry) => entry.status === 'queued');
    if (!nextItem) return;

    set((state) => ({
      items: state.items.map((entry) =>
        entry.id === nextItem.id ? { ...entry, status: 'running' as const, startedAt: Date.now() } : entry
      )
    }));

    useAgentStore.getState().setMode(nextItem.mode);
    void useAgentStore.getState().startAgent(nextItem.prompt, nextItem.images);
  },

  settleRunning: (status) =>
    set((state) => ({
      items: state.items.map((entry) =>
        entry.status === 'running' ? { ...entry, status, finishedAt: Date.now() } : entry
      )
    })),

  clearFinished: () =>
    set((state) => ({
      items: state.items.filter((entry) => entry.status !== 'completed' && entry.status !== 'cancelled')
    }))
}));
