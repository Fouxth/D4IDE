import { create } from 'zustand';
import { FollowUpSuggestion } from '../../shared/followup-suggestions';

/**
 * The next-move chips under a finished run.
 *
 * Main process decides *what* to offer, grounded in what the run did; this store
 * only remembers the latest offer and puts it on screen. A new run replaces the
 * list the moment it starts (the chips describe a finished run, so they would be
 * lies while one is in flight), and the user can dismiss them — clicking a chip
 * clears it too, because an action already taken is not offered again.
 */
interface FollowUpState {
  suggestions: FollowUpSuggestion[];
  /** True once the user has dismissed the current offer, until the next one. */
  dismissed: boolean;

  setSuggestions: (suggestions: FollowUpSuggestion[]) => void;
  clear: () => void;
  dismiss: () => void;
}

export const useFollowUpStore = create<FollowUpState>((set) => ({
  suggestions: [],
  dismissed: false,

  setSuggestions: (suggestions) => set({ suggestions, dismissed: false }),
  clear: () => set({ suggestions: [], dismissed: false }),
  dismiss: () => set({ dismissed: true })
}));
