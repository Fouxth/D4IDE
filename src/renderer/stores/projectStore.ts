import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { BufferSnapshot, FileNode } from '../../shared/types';
import { samePath } from '../lib/paths';

/**
 * Unsaved editor buffers are written to disk on a debounce (spec §84). A crash
 * then costs nothing: the next launch offers the text back instead of a file
 * that silently reverted to the last save.
 */
let bufferFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBufferFlush(openFiles: { path: string; name: string; content: string; isDirty?: boolean }[], projectPath: string | null) {
  if (!window.electronAPI || !projectPath) return;
  if (bufferFlushTimer) clearTimeout(bufferFlushTimer);
  bufferFlushTimer = setTimeout(() => {
    bufferFlushTimer = null;
    const snapshots: BufferSnapshot[] = openFiles
      .filter((file) => file.isDirty)
      .map((file) => ({
        path: file.path,
        relativePath: file.path.startsWith(projectPath) ? file.path.slice(projectPath.length + 1) : file.name,
        content: file.content,
        dirty: !!file.isDirty,
        savedAt: Date.now()
      }));
    void window.electronAPI?.saveBuffers(snapshots).catch(() => undefined);
  }, 800);
}

/**
 * Subscribe to this store **field by field**.
 *
 * `const { a, b } = useProjectStore()` hands a component the whole state, so it
 * re-renders on every change to any part of it — including `activeFileContent`,
 * which changes on every keystroke. Measured on the dev renderer, one such write
 * cost the renderer ~5.2 ms of task time with a 2 KB file and ~6 ms with a
 * 100 KB one, because typing re-rendered App and everything under it: the file
 * tree, the right panel, the terminal panel, none of which had changed.
 *
 * `useShallow` keeps the previous result when the selected fields are unchanged,
 * so a component re-renders only when something it actually reads has moved.
 * Use `useProjectStore.getState()` for action-only or click-time reads.
 */
export const useProject = <T extends object>(selector: (state: ProjectState) => T): T =>
  useProjectStore(useShallow(selector));

interface ProjectState {
  projectPath: string | null;
  fileTree: FileNode | null;
  openFiles: { path: string; name: string; content: string; isDirty?: boolean }[];
  activeFilePath: string | null;
  activeFileContent: string;
  isOpeningProject: boolean;
  /** Files changed by another tool while this app is open (spec §48). */
  externallyChanged: string[];

  markExternallyChanged: (relativePaths: string[]) => void;
  /**
   * Re-reads a file from disk. Unsaved edits win unless the caller is the user
   * explicitly asking to reload (`force`), so no programmatic refresh can throw
   * away a buffer (spec §84).
   */
  reloadFileFromDisk: (filePath: string, options?: { force?: boolean }) => Promise<void>;
  clearExternalChange: (filePath: string) => void;
  setProjectPath: (path: string) => void;
  loadProjectTree: () => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string) => void;
  updateActiveContent: (content: string) => void;
  saveActiveFile: () => Promise<void>;
  /** Ctrl+Tab: moves to the next open tab, wrapping around. */
  cycleActiveFile: (direction?: 1 | -1) => void;
  /** Buffers left behind by a crash, offered for recovery at startup. */
  recoveredBuffers: BufferSnapshot[];
  checkForRecoveredBuffers: () => Promise<void>;
  restoreRecoveredBuffers: () => Promise<void>;
  dismissRecoveredBuffers: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectPath: null,
  fileTree: null,
  openFiles: [],
  activeFilePath: null,
  activeFileContent: '',
  isOpeningProject: false,
  externallyChanged: [],
  recoveredBuffers: [],

  markExternallyChanged: (relativePaths: string[]) => {
    set((state) => ({ externallyChanged: Array.from(new Set([...state.externallyChanged, ...relativePaths])) }));
  },

  clearExternalChange: (filePath: string) => {
    const name = filePath.split(/[/\\]/).pop() || filePath;
    set((state) => ({
      externallyChanged: state.externallyChanged.filter((p) => p !== filePath && !p.endsWith(`/${name}`) && p !== name)
    }));
  },

  reloadFileFromDisk: async (filePath, options = {}) => {
    if (!window.electronAPI) return;
    const buffer = get().openFiles.find((f) => f.path === filePath);
    if (buffer?.isDirty && !options.force) return;
    try {
      const content = await window.electronAPI.readFile(filePath);
      const { openFiles } = get();
      set({
        openFiles: openFiles.map((f) => (f.path === filePath ? { ...f, content, isDirty: false } : f)),
        activeFileContent: get().activeFilePath === filePath ? content : get().activeFileContent
      });
      get().clearExternalChange(filePath);
    } catch (e) {
      console.error('Failed reloading file:', e);
    }
  },

  setProjectPath: (path: string) => {
    set({ projectPath: path, externallyChanged: [] });
    get().loadProjectTree();
  },

  loadProjectTree: async () => {
    const { projectPath } = get();
    if (!projectPath || !window.electronAPI) return;
    try {
      const tree = await window.electronAPI.getProjectTree(projectPath);
      set({ fileTree: tree });
    } catch (e) {
      console.error('Failed to load tree:', e);
    }
  },

  openFile: async (filePath: string) => {
    if (!window.electronAPI) return;
    const { openFiles } = get();
    // One file is one tab, however its path happens to be spelled (spec §84).
    const existing = openFiles.find((f) => samePath(f.path, filePath));
    if (existing) {
      set({ activeFilePath: existing.path, activeFileContent: existing.content });
      return;
    }

    try {
      const content = await window.electronAPI.readFile(filePath);
      const name = filePath.split(/[/\\]/).pop() || 'file';
      set({
        openFiles: [...openFiles, { path: filePath, name, content }],
        activeFilePath: filePath,
        activeFileContent: content
      });
    } catch (e) {
      console.error('Failed reading file:', e);
    }
  },

  closeFile: (filePath: string) => {
    const { openFiles, activeFilePath } = get();
    const filtered = openFiles.filter((f) => !samePath(f.path, filePath));
    let nextActive = activeFilePath;
    if (samePath(activeFilePath || '', filePath)) {
      nextActive = filtered.length > 0 ? filtered[filtered.length - 1].path : null;
    }
    const nextContent = filtered.find((f) => f.path === nextActive)?.content || '';
    set({
      openFiles: filtered,
      activeFilePath: nextActive,
      activeFileContent: nextContent
    });
  },

  setActiveFile: (filePath: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => samePath(f.path, filePath));
    if (file) {
      // Reuse the stored spelling: the tab strip and the exit-check compare paths.
      set({ activeFilePath: file.path, activeFileContent: file.content });
    }
  },

  updateActiveContent: (content: string) => {
    const { activeFilePath, openFiles } = get();
    if (!activeFilePath) return;
    const next = openFiles.map((f) => (f.path === activeFilePath ? { ...f, content, isDirty: true } : f));
    set({ activeFileContent: content, openFiles: next });
    scheduleBufferFlush(next, get().projectPath);
  },

  saveActiveFile: async () => {
    const { activeFilePath, activeFileContent, openFiles } = get();
    if (!activeFilePath || !window.electronAPI) return;
    try {
      await window.electronAPI.writeFile(activeFilePath, activeFileContent);
      const next = openFiles.map((f) => (f.path === activeFilePath ? { ...f, isDirty: false } : f));
      set({ openFiles: next });
      scheduleBufferFlush(next, get().projectPath);
    } catch (e) {
      console.error('Failed saving file:', e);
    }
  },

  cycleActiveFile: (direction = 1) => {
    const { openFiles, activeFilePath } = get();
    if (openFiles.length < 2) return;
    const index = openFiles.findIndex((file) => file.path === activeFilePath);
    const nextIndex = (index + direction + openFiles.length) % openFiles.length;
    get().setActiveFile(openFiles[nextIndex].path);
  },

  checkForRecoveredBuffers: async () => {
    if (!window.electronAPI) return;
    try {
      const buffers = await window.electronAPI.getBuffers();
      // Only offer buffers whose file still exists — a deleted file would
      // otherwise recreate itself from a stale snapshot.
      const existing: BufferSnapshot[] = [];
      for (const buffer of Array.isArray(buffers) ? buffers : []) {
        const content = await window.electronAPI.readFile(buffer.path).catch(() => null);
        if (content !== null && content !== buffer.content) existing.push(buffer);
      }
      set({ recoveredBuffers: existing });
    } catch {
      set({ recoveredBuffers: [] });
    }
  },

  restoreRecoveredBuffers: async () => {
    const { recoveredBuffers, openFiles } = get();
    const restored = [...openFiles];
    for (const buffer of recoveredBuffers) {
      const index = restored.findIndex((file) => file.path === buffer.path);
      const entry = {
        path: buffer.path,
        name: buffer.path.split(/[/\\]/).pop() || 'file',
        content: buffer.content,
        isDirty: true
      };
      if (index >= 0) restored[index] = entry;
      else restored.push(entry);
    }
    const last = recoveredBuffers[recoveredBuffers.length - 1];
    set({
      openFiles: restored,
      activeFilePath: last ? last.path : get().activeFilePath,
      activeFileContent: last ? last.content : get().activeFileContent,
      recoveredBuffers: []
    });
    await window.electronAPI?.clearBuffers();
  },

  dismissRecoveredBuffers: async () => {
    set({ recoveredBuffers: [] });
    await window.electronAPI?.clearBuffers();
  }
}));
