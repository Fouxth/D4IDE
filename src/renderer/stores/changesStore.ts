import { create } from 'zustand';
import { FileChange } from '../../shared/types';

interface ChangesState {
  changes: FileChange[];
  activeDiffFile: FileChange | null;

  addChange: (change: FileChange) => void;
  setActiveDiff: (change: FileChange | null) => void;
  revertChange: (change: FileChange) => Promise<void>;
  clearChanges: () => void;
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  changes: [],
  activeDiffFile: null,

  addChange: (change: FileChange) => {
    set((state) => {
      const filtered = state.changes.filter((c) => c.path !== change.path);
      return { changes: [...filtered, change] };
    });
  },

  setActiveDiff: (change: FileChange | null) => {
    set({ activeDiffFile: change });
  },

  revertChange: async (change: FileChange) => {
    if (!window.electronAPI) return;
    try {
      if (change.type === 'created') {
        await window.electronAPI.deleteFile(change.path);
      } else if (change.type === 'modified' && change.previousContent !== undefined) {
        await window.electronAPI.writeFile(change.path, change.previousContent);
      }
      set((state) => ({
        changes: state.changes.filter((c) => c.path !== change.path),
        activeDiffFile: state.activeDiffFile?.path === change.path ? null : state.activeDiffFile
      }));
    } catch (e) {
      console.error('Failed to revert change:', e);
    }
  },

  clearChanges: () => set({ changes: [], activeDiffFile: null })
}));
