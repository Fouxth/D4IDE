import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-events';

export const electronAPI = {
  // Window
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  beginWindowDrag: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_DRAG_START),
  endWindowDrag: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_DRAG_END),
  maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),

  // Project
  openProjectDialog: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN_DIALOG),
  openProjectPath: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN_PATH, projectPath),
  getProjectTree: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET_TREE, projectPath),
  /** What database the project uses, read from the project's own files. */
  projectDatabase: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DATABASE, projectPath),
  getRecentProjects: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_RECENT_LIST),
  /** The folders on the rail: kept until the user takes one off it. */
  getSpaces: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SPACES_LIST),
  forgetSpace: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SPACE_FORGET, projectPath),
  /** Conversation starters built from the project's real state; [] when there is none. */
  getProjectSuggestions: (projectPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SUGGESTIONS, projectPath) as Promise<
      { id: string; label: string; prompt: string }[]
    >,

  // Files
  readFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
  createFile: (filePath: string, content = '') => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE, filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, filePath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_RENAME, oldPath, newPath),
  searchFiles: (rootDir: string, query: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SEARCH, rootDir, query),
  grep: (rootDir: string, query: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GREP, rootDir, query),
  readImageDataUrl: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_DATA_URL, projectPath, relativePath),
  startFileWatcher: (rootDir: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WATCH_START, rootDir),
  stopFileWatcher: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_WATCH_STOP),
  onFileChanged: (callback: (events: { relativePath: string; kind: string; timestamp: number }[]) => void) => {
    const handler = (_event: any, events: any) => callback(events);
    ipcRenderer.on(IPC_CHANNELS.FILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_CHANGED, handler);
  },

  // Git
  gitStatus: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, cwd),
  gitDiff: (cwd: string, filePath?: string, staged?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, cwd, filePath, staged),
  gitLog: (cwd: string, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, cwd, limit),
  gitBranches: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCHES, cwd),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, cwd, message),

  // Terminal
  terminalCreate: (id: string, cwd: string, shellType?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, id, cwd, shellType),
  terminalWrite: (id: string, data: string) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, id, data),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, id, cols, rows),
  terminalKill: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_KILL, id),
  /** Tells main whether this terminal is on screen, so it knows to send output. */
  terminalWatch: (id: string, watching: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WATCH, id, watching),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const handler = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, handler);
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),

  // Providers — responses are always sanitized (no plaintext keys).
  getProviders: () => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_GET),
  saveProviders: (providers: any) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_SAVE, providers),
  testProvider: (providerId: string, apiKey?: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST, providerId, apiKey, baseUrl, model),
  /** One verdict per vendor, ready to be shown as the summary table. */
  testAllProviders: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST_ALL) as Promise<
      import('../shared/types').ProviderTestAllResult
    >,
  /** Ask for a health verdict on the active provider right now. */
  probeProviderHealth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROVIDER_HEALTH_PROBE) as Promise<
      import('../shared/types').ProviderHealthStatus
    >,
  /** Live health pushes from the periodic watch (also fired by probes). */
  onProviderHealthStatus: (handler: (status: import('../shared/types').ProviderHealthStatus) => void) => {
    const listener = (_event: unknown, status: import('../shared/types').ProviderHealthStatus) => handler(status);
    ipcRenderer.on(IPC_CHANNELS.PROVIDER_HEALTH_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PROVIDER_HEALTH_STATUS, listener);
  },
  refreshProviderModels: (providerId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_REFRESH_MODELS, providerId),
  setProviderKey: (providerId: string, apiKey: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_SET_KEY, providerId, apiKey),
  deleteProvider: (providerId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_DELETE, providerId),
  resolveAutoModel: (profile: 'quality' | 'balanced' | 'cost' | 'fast') =>
    ipcRenderer.invoke(IPC_CHANNELS.MODELS_RESOLVE_AUTO, profile),

  // Usage & budgets
  getUsage: () => ipcRenderer.invoke(IPC_CHANNELS.USAGE_GET),
  resetUsage: (fromTimestamp?: number) => ipcRenderer.invoke(IPC_CHANNELS.USAGE_RESET, fromTimestamp),
  onUsageEvent: (callback: (summary: any) => void) => {
    const handler = (_event: any, summary: any) => callback(summary);
    ipcRenderer.on(IPC_CHANNELS.USAGE_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.USAGE_EVENT, handler);
  },

  // Sessions
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_LIST),
  upsertSession: (session: any) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_UPSERT, session),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId),
  getSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_TRANSCRIPT_GET, sessionId),

  // Checkpoints & audit
  listCheckpoints: () => ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINTS_LIST),
  createCheckpoint: (description: string, files: any[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_CREATE, description, files),
  restoreCheckpoint: (id: string, projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_RESTORE, id, projectPath),
  deleteCheckpoint: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_DELETE, id),
  listToolAudit: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.TOOL_AUDIT_LIST, limit),

  // Agent
  startAgent: (args: {
    prompt: string;
    mode: string;
    projectPath: string;
    conversationHistory?: any[];
    sessionId?: string;
    images?: any[];
  }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_START, args),
  cancelAgent: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CANCEL),
  approvePlan: (scope: 'full' | 'step' | 'first' = 'full') =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVE_PLAN, scope),
  rejectPlan: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_REJECT_PLAN),
  revisePlan: (feedback: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_REVISE_PLAN, feedback),
  chooseDesignStyle: (style: 'minimal' | 'modern-saas' | 'dark-premium' | 'bold') =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHOOSE_DESIGN, style),

  planStepDecision: (decision: 'continue' | 'runAll' | 'stop') =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_PLAN_STEP, decision),
  answerQuestions: (answer: any) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_ANSWER_QUESTIONS, answer),
  resolveApproval: (id: string, decision: 'approved' | 'approved_for_session' | 'rejected', toolName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVAL_RESOLVE, id, decision, toolName),
  getAgentSessionState: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_STATE),
  onApprovalRequest: (callback: (request: any) => void) => {
    // `null` is a real message: the main process answered the dialog itself
    // (the user switched to Full, or the run was cancelled) and the modal has
    // to come down even though nobody clicked it.
    const handler = (_event: any, request: any) => callback(request ?? null);
    ipcRenderer.on(IPC_CHANNELS.AGENT_APPROVAL_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_APPROVAL_REQUEST, handler);
  },
  onPreviewDiscovered: (callback: (payload: { url: string; source?: string } | null) => void) => {
    const handler = (_event: any, payload: any) => callback(payload ?? null);
    ipcRenderer.on(IPC_CHANNELS.PREVIEW_DISCOVERED, handler);
    // Returns a plain unsubscribe so it can be handed straight to useEffect.
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.PREVIEW_DISCOVERED, handler);
    };
  },
  onAgentEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, handler);
  },

  // Skills & MCP
  listSkills: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST, projectPath),
  saveSkill: (skill: any, projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_SAVE, skill, projectPath),
  deleteSkill: (skillId: string, projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_DELETE, skillId, projectPath),
  // Rules: the standing laws are read straight from `shared/rules`; these two
  // calls only carry the user's own files.
  getRules: (projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RULES_GET, projectPath) as Promise<{
      global: string;
      project: string;
      globalPath: string;
      projectFile: string;
    }>,
  saveRules: (scope: 'global' | 'project', content: string, projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RULES_SAVE, scope, content, projectPath) as Promise<{
      success: boolean;
      path?: string;
      scope?: 'global' | 'project';
      error?: string;
    }>,
  revealRules: (scope: 'global' | 'project', projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RULES_REVEAL, scope, projectPath) as Promise<{ success: boolean; error?: string }>,

  listMcp: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST, projectPath),
  startMcp: (config: any, cwd?: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_START, config, cwd),
  stopMcp: (serverId: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_STOP, serverId),
  callMcp: (serverId: string, toolName: string, args: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_CALL, serverId, toolName, args),
  discoveredMcpTools: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_DISCOVERED),
  mcpHealth: (serverId: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_HEALTH, serverId),
  refreshMcpTools: (serverId: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_REFRESH_TOOLS, serverId),

  // Preview
  capturePreview: () => ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_CAPTURE),
  detectPreviewUrls: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_DETECT, projectPath),
  /**
   * The command a typed line should become, so a dev server started by hand
   * serves from this project's own port instead of whatever the tool defaults to.
   * Null when the line is not a dev command or there is no project.
   */
  planTerminalCommand: (command: string, projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_PLAN, command, projectPath) as Promise<{
      command: string;
      port: number | null;
      kind: 'client' | 'server';
      strategy: 'flag' | 'env' | 'none';
    } | null>,
  launchPreview: (projectPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_LAUNCH, projectPath) as Promise<{
      started: boolean;
      command?: string;
      script?: string;
      packageManager?: string;
      /** The port the app chose, and the address it belongs to, when it chose one. */
      port?: number | null;
      url?: string | null;
      error?: string;
      /**
       * This project's server was already up, so nothing was started: the panel
       * points at `url` instead of spawning a twin that would fight it.
       */
      alreadyRunning?: boolean;
    }>,

  // Mission (session-scoped context)
  getMission: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET, sessionId),
  setMission: (sessionId: string, mission: any) => ipcRenderer.invoke(IPC_CHANNELS.MISSION_SET, sessionId, mission),
  getProjectMemory: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_MEMORY_GET, projectPath),
  saveProjectMemory: (projectPath: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_MEMORY_SAVE, projectPath, content),
  getProjectDesign: (projectPath: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DESIGN_GET, projectPath),
  saveProjectDesign: (projectPath: string, update: { style?: string; notes?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DESIGN_SAVE, projectPath, update),

  // Structured logs
  readLogs: (options?: { channel?: string; level?: string; limit?: number; search?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOGS_READ, options),
  logCounts: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_COUNTS),
  clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_CLEAR),
  setLogLevel: (level: string) => ipcRenderer.invoke(IPC_CHANNELS.LOGS_SET_LEVEL, level),
  openLogDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_OPEN_DIR),

  // Desktop notifications
  notify: (request: { title: string; body?: string; kind?: string; silent?: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_NOTIFY, request),

  // Unsaved buffers (crash recovery)
  getBuffers: () => ipcRenderer.invoke(IPC_CHANNELS.BUFFERS_GET),
  saveBuffers: (buffers: any[]) => ipcRenderer.invoke(IPC_CHANNELS.BUFFERS_SAVE, buffers),
  clearBuffers: () => ipcRenderer.invoke(IPC_CHANNELS.BUFFERS_CLEAR),

  // Settings import/export
  exportSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_EXPORT),
  importSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_IMPORT),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  skipUpdateVersion: (version: string) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SKIP, version),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_STATUS),
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler);
  },

  // Local LLM nudge: main pushes when a keyless runtime answers on this machine.
  onLocalLlmFound: (callback: (offer: { vendor: string; modelCount: number }) => void) => {
    const handler = (_event: any, offer: any) => callback(offer);
    ipcRenderer.on(IPC_CHANNELS.LOCAL_LLM_FOUND, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LOCAL_LLM_FOUND, handler);
  },
  enableLocalLlm: () => ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLM_ENABLE),

  // Model catalogue: check stages what providers report, apply is a click
  getCatalogStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CATALOG_STATUS),
  checkCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.CATALOG_CHECK),
  applyCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.CATALOG_APPLY),
  discardCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.CATALOG_DISCARD),
  undoCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.CATALOG_UNDO),
  onCatalogStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.CATALOG_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CATALOG_STATUS, handler);
  },

  // Storage diagnostics
  getStorageInfo: () => ipcRenderer.invoke('storage:info'),

  // Database upkeep (Settings → Database)
  dbInfo: () => ipcRenderer.invoke('db:info'),
  dbCheck: (full = false) => ipcRenderer.invoke('db:check', full),
  dbBackup: () => ipcRenderer.invoke('db:backup'),
  dbVacuum: () => ipcRenderer.invoke('db:vacuum'),
  dbOpenFolder: (which: 'data' | 'backups' = 'data') => ipcRenderer.invoke('db:open-folder', which),

  // Sign-in (GitHub device flow / Google PKCE)
  authStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_STATUS),
  authSignIn: (provider: 'github' | 'google') => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_IN, provider),
  authSignOut: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_OUT),
  onAuthPrompt: (callback: (prompt: any) => void) => {
    const handler = (_event: any, prompt: any) => callback(prompt);
    ipcRenderer.on(IPC_CHANNELS.AUTH_DEVICE_PROMPT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUTH_DEVICE_PROMPT, handler);
    };
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
