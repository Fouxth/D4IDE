import { create } from 'zustand';
import { forgetSpace, rememberSpace } from '../../shared/spaces';

/**
 * The folders on the rail.
 *
 * The list itself is owned by the main process (it is written whenever a folder
 * is opened, and it is what survives a restart), so this store is a cache with
 * two jobs: read it back for the rail, and hand a removal up. It is deliberately
 * not derived from the sessions in the database — a folder that was opened and
 * never prompted in would otherwise vanish from the rail, and the rail is meant
 * to be the place that stays put.
 */
interface SpacesState {
  spaces: string[];
  /** True once the list has been read, so the rail does not flash empty. */
  isLoaded: boolean;

  load: () => Promise<void>;
  /** Local echo of a folder the user just opened, before the next read. */
  add: (path: string) => void;
  /** Takes a folder off the rail. The project on disk is not touched. */
  forget: (path: string) => Promise<void>;
}

export const useSpacesStore = create<SpacesState>((set, get) => ({
  spaces: [],
  isLoaded: false,

  load: async () => {
    if (!window.electronAPI) {
      // Renderer-only preview: no main process, so nothing is remembered.
      set({ spaces: [], isLoaded: true });
      return;
    }
    try {
      const spaces = (await window.electronAPI.getSpaces()) ?? [];
      set({ spaces, isLoaded: true });
    } catch {
      set({ isLoaded: true });
    }
  },

  add: (path) => set({ spaces: rememberSpace(get().spaces, path) }),

  forget: async (path) => {
    // Optimistic: a rail entry the user asked to remove should go immediately,
    // and the reply is the same list the main process now holds.
    set({ spaces: forgetSpace(get().spaces, path) });
    if (!window.electronAPI) return;
    try {
      const spaces = (await window.electronAPI.forgetSpace(path)) ?? get().spaces;
      set({ spaces });
    } catch {
      // Leaving the optimistic list in place beats restoring an entry the user
      // just deleted; the next read of settings will settle it.
    }
  }
}));
