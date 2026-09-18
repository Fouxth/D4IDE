// IPC channels definitions

export const IPC_CHANNELS = {
  // Window & System
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Project & Filesystem
  PROJECT_OPEN_DIALOG: 'project:open-dialog',
  PROJECT_OPEN_PATH: 'project:open-path',
  PROJECT_GET_TREE: 'project:get-tree',
  PROJECT_RECENT_LIST: 'project:recent-list',
  /** What database the open project is built on, read from the project's files. */
  PROJECT_DATABASE: 'project:database',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_DELETE: 'file:delete',
  FILE_CREATE: 'file:create',
  FILE_RENAME: 'file:rename',
  FILE_SEARCH: 'file:search',
  FILE_GREP: 'file:grep',
  FILE_READ_DATA_URL: 'file:read-data-url',
  FILE_WATCH_START: 'file:watch-start',
  FILE_WATCH_STOP: 'file:watch-stop',
  FILE_CHANGED: 'file:changed',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_LOG: 'git:log',
  GIT_BRANCHES: 'git:branches',
  GIT_COMMIT: 'git:commit',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_KILL: 'terminal:kill',
  /**
   * Tells the main process that a panel is on screen and wants this terminal's
   * output. Without it main has no way to know whether anyone is watching, and
   * it used to ship every chunk to a page that had nothing subscribed.
   */
  TERMINAL_WATCH: 'terminal:watch',

  // Settings & Storage
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Providers (spec §26-§30, §29)
  PROVIDERS_GET: 'providers:get',
  PROVIDERS_SAVE: 'providers:save',
  PROVIDERS_TEST: 'providers:test',
  PROVIDERS_REFRESH_MODELS: 'providers:refresh-models',
  PROVIDERS_SET_KEY: 'providers:set-key',
  PROVIDERS_DELETE: 'providers:delete',
  MODELS_RESOLVE_AUTO: 'models:resolve-auto',

  // Usage & budgets (spec §35-§36, §76)
  USAGE_GET: 'usage:get',
  USAGE_RESET: 'usage:reset',
  USAGE_EVENT: 'usage:event',

  // AI & Agent
  AGENT_START: 'agent:start',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_APPROVE_PLAN: 'agent:approve-plan',
  AGENT_REJECT_PLAN: 'agent:reject-plan',
  AGENT_REVISE_PLAN: 'agent:revise-plan',
  AGENT_CHOOSE_DESIGN: 'agent:choose-design',
  /** Answers the step gate between build steps (spec §35). */
  AGENT_PLAN_STEP: 'agent:plan-step',

  // Sign-in (spec §7)
  AUTH_STATUS: 'auth:status',
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  /** Device-flow code the user must enter on github.com. */
  AUTH_DEVICE_PROMPT: 'auth:device-prompt',
  AGENT_APPROVAL_REQUEST: 'agent:approval-request',
  AGENT_APPROVAL_RESOLVE: 'agent:approval-resolve',
  AGENT_EVENT: 'agent:event',
  AGENT_SESSION_STATE: 'agent:session-state',

  // Checkpoints & Changes
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_RESTORE: 'checkpoint:restore',
  CHECKPOINTS_LIST: 'checkpoints:list',
  CHECKPOINT_DELETE: 'checkpoint:delete',
  TOOL_AUDIT_LIST: 'tool-audit:list',

  // Sessions (spec §45, §84)
  SESSIONS_LIST: 'sessions:list',
  SESSION_UPSERT: 'session:upsert',
  SESSION_DELETE: 'session:delete',
  SESSION_TRANSCRIPT_GET: 'session:transcript-get',

  // MCP & Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_SAVE: 'skills:save',
  SKILLS_DELETE: 'skills:delete',
  MCP_LIST: 'mcp:list',
  MCP_CALL: 'mcp:call',
  MCP_START: 'mcp:start',
  MCP_STOP: 'mcp:stop',
  MCP_DISCOVERED: 'mcp:discovered',
  MCP_HEALTH: 'mcp:health',
  MCP_REFRESH_TOOLS: 'mcp:refresh-tools',

  // Preview
  PREVIEW_CAPTURE: 'preview:capture',
  PREVIEW_DETECT: 'preview:detect',
  /** A local server address the app just learned about, pushed to the UI. */
  PREVIEW_DISCOVERED: 'preview:discovered',

  // Mission: session-scoped context (spec §40)
  MISSION_GET: 'mission:get',
  MISSION_SET: 'mission:set',

  // Project memory and the screen style chosen for this project
  PROJECT_MEMORY_GET: 'project:memory:get',
  PROJECT_MEMORY_SAVE: 'project:memory:save',
  PROJECT_DESIGN_GET: 'project:design:get',
  PROJECT_DESIGN_SAVE: 'project:design:save',

  // Structured logs (spec §66)
  LOGS_READ: 'logs:read',
  LOGS_COUNTS: 'logs:counts',
  LOGS_CLEAR: 'logs:clear',
  LOGS_SET_LEVEL: 'logs:set-level',
  LOGS_OPEN_DIR: 'logs:open-dir',

  // Notifications (spec §53)
  APP_NOTIFY: 'app:notify',

  // Unsaved buffers for crash recovery (spec §84)
  BUFFERS_GET: 'buffers:get',
  BUFFERS_SAVE: 'buffers:save',
  BUFFERS_CLEAR: 'buffers:clear',

  // Settings import/export (spec §67 phase 4)
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',

  // Update system (spec §83)
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status'
} as const;
