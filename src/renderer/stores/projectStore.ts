import { create } from 'zustand';
import { FileNode } from '../../shared/types';

interface ProjectState {
  projectPath: string | null;
  fileTree: FileNode | null;
  openFiles: { path: string; name: string; content: string; isDirty?: boolean }[];
  activeFilePath: string | null;
  activeFileContent: string;
  isOpeningProject: boolean;

  setProjectPath: (path: string) => void;
  loadProjectTree: () => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string) => void;
  updateActiveContent: (content: string) => void;
  saveActiveFile: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectPath: null,
  fileTree: null,
  openFiles: [],
  activeFilePath: null,
  activeFileContent: '',
  isOpeningProject: false,

  setProjectPath: (path: string) => {
    set({ projectPath: path });
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
    const existing = openFiles.find((f) => f.path === filePath);
    if (existing) {
      set({ activeFilePath: filePath, activeFileContent: existing.content });
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
    const filtered = openFiles.filter((f) => f.path !== filePath);
    let nextActive = activeFilePath;
    if (activeFilePath === filePath) {
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
    const file = openFiles.find((f) => f.path === filePath);
    if (file) {
      set({ activeFilePath: filePath, activeFileContent: file.content });
    }
  },

  updateActiveContent: (content: string) => {
    const { activeFilePath, openFiles } = get();
    if (!activeFilePath) return;
    set({
      activeFileContent: content,
      openFiles: openFiles.map((f) => (f.path === activeFilePath ? { ...f, content, isDirty: true } : f))
    });
  },

  saveActiveFile: async () => {
    const { activeFilePath, activeFileContent, openFiles } = get();
    if (!activeFilePath || !window.electronAPI) return;
    try {
      await window.electronAPI.writeFile(activeFilePath, activeFileContent);
      set({
        openFiles: openFiles.map((f) => (f.path === activeFilePath ? { ...f, isDirty: false } : f))
      });
    } catch (e) {
      console.error('Failed saving file:', e);
    }
  }
}));
