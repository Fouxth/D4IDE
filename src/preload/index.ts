import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-events';

export const electronAPI = {
  // Window
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),

  // Project
  openProjectDialog: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN_DIALOG),
  getProjectTree: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET_TREE, projectPath),

  // Files
  readFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
  createFile: (filePath: string, content = '') => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE, filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, filePath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_RENAME, oldPath, newPath),
  searchFiles: (rootDir: string, query: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SEARCH, rootDir, query),
  grep: (rootDir: string, query: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GREP, rootDir, query),

  // Git
  gitStatus: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, cwd),
  gitDiff: (cwd: string, filePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, cwd, filePath),
  gitLog: (cwd: string, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, cwd, limit),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, cwd, message),

  // Terminal
  terminalCreate: (id: string, cwd: string, shellType?: string) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, id, cwd, shellType),
  terminalWrite: (id: string, data: string) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, id, data),
  terminalKill: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_KILL, id),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const handler = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, handler);
    };
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),
  getProviders: () => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_GET),
  saveProviders: (providers: any) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_SAVE, providers),
  testProvider: (providerId: string, apiKey?: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST, providerId, apiKey, baseUrl, model),

  // Checkpoints
  listCheckpoints: () => ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINTS_LIST),
  createCheckpoint: (description: string, files: any[]) => ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_CREATE, description, files),
  restoreCheckpoint: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_RESTORE, id),

  // Agent
  startAgent: (args: { prompt: string; mode: string; projectPath: string; conversationHistory?: any[] }) =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_START, args),
  cancelAgent: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CANCEL),
  approvePlan: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVE_PLAN),
  rejectPlan: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_REJECT_PLAN),
  onAgentEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, handler);
    };
  },

  // Skills & MCP
  listSkills: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST, projectPath),
  listMcp: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST, projectPath),

  // Preview
  capturePreview: () => ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_CAPTURE)
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
