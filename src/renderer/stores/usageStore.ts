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
  thrift: boolean;
  /** True when the engine engaged the cheaper limits by itself, near the budget. */
  autoThrift?: boolean;
}

interface UsageState {
  summary: UsageSummary | null;
  isLoading: boolean;
  /** Set when a provider call pushes the session/day/month past a threshold. */
  lastWarning: { level: 'warn' | 'exceeded'; message: string } | null;
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
  clearWarning: () => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  isLoading: false,
  lastWarning: null,
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
    set({ summary, lastWarning: null });
  },

  setSummary: (summary) => {
    const previous = get().summary;
    const budget = summary.budget;
    let warning: UsageState['lastWarning'] = null;

    // Both thresholds are edge-triggered. Usage is re-read after every run and
    // the store is updated from several places, so a level-triggered warning
    // fired a fresh pair of popups on every refresh — four identical "budget
    // exceeded" cards stacked on screen for one crossing.
    if (budget.exceeded && !previous?.budget.exceeded) {
      warning = {
        level: 'exceeded',
        message: `Budget exceeded — today $${budget.dailySpent.toFixed(2)} / $${budget.daily}, month $${budget.monthlySpent.toFixed(2)} / $${budget.monthly}`
      };
    } else if (budget.warn && !previous?.budget.warn) {
      warning = {
        level: 'warn',
        message: `Approaching budget — today $${budget.dailySpent.toFixed(2)} of $${budget.daily} (${Math.round(
          budget.dailyPct * 100
        )}%)`
      };
    }

    set({ summary, lastWarning: warning ?? get().lastWarning });
  },

  setTokenStats: (stats) => set({ tokenStats: stats }),

  clearWarning: () => set({ lastWarning: null })
}));
