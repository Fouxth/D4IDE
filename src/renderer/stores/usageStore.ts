import { create } from 'zustand';
import { UsageSummary } from '../../shared/types';

export interface TokenStats {
  /** Tokens this run has paid for so far, cached ones included. */
  runTokens: number;
  /** The ceiling for this run, 0 when there is none. */
  cap: number;
  /** Tokens not spent because calls were reused or the prompt was compressed. */
  saved: number;
  /** Size of the last request that was actually sent. */
  promptTokens: number;
  /** True while the run is using the cheaper limits `/thrift` switches to. */
  thrift: boolean;
}

interface UsageState {
  summary: UsageSummary | null;
  isLoading: boolean;
  /**
   * Live token accounting for the run in flight.
   *
   * "Cheap mode" was previously unverifiable: nothing on screen said what the
   * run had spent or what it had avoided spending, so the only feedback was the
   * bill at the end. This is that feedback, while it still matters.
   */
  tokenStats: TokenStats | null;

  load: () => Promise<void>;
  reset: (fromTimestamp?: number) => Promise<void>;
  setSummary: (summary: UsageSummary) => void;
  setTokenStats: (stats: TokenStats) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  summary: null,
  isLoading: false,
  tokenStats: null,

  load: async () => {
    if (!window.electronAPI) return;
    set({ isLoading: true });
    try {
      const summary = await window.electronAPI.getUsage();
      set({ summary, isLoading: false });
    } catch (e) {
      console.error('Failed loading usage:', e);
      set({ isLoading: false });
    }
  },

  reset: async (fromTimestamp?: number) => {
    if (!window.electronAPI) return;
    const summary = await window.electronAPI.resetUsage(fromTimestamp);
    set({ summary });
  },

  // Usage is a report, so it is stored as one: no thresholds, no warnings and no
  // popups of its own. Spending is shown where it happened, and the user is the
  // one who decides what it means.
  setSummary: (summary) => set({ summary }),

  setTokenStats: (stats) => set({ tokenStats: stats })
}));
