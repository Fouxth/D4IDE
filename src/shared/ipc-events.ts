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
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_DELETE: 'file:delete',
  FILE_CREATE: 'file:create',
  FILE_RENAME: 'file:rename',
  FILE_SEARCH: 'file:search',
  FILE_GREP: 'file:grep',

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

  // Settings & Storage
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  PROVIDERS_GET: 'providers:get',
  PROVIDERS_SAVE: 'providers:save',
  PROVIDERS_TEST: 'providers:test',

  // AI & Agent
  AGENT_START: 'agent:start',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_APPROVE_PLAN: 'agent:approve-plan',
  AGENT_REJECT_PLAN: 'agent:reject-plan',
  AGENT_EVENT: 'agent:event',

  // Checkpoints & Changes
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_RESTORE: 'checkpoint:restore',
  CHECKPOINTS_LIST: 'checkpoints:list',

  // MCP & Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_SAVE: 'skills:save',
  MCP_LIST: 'mcp:list',
  MCP_CALL: 'mcp:call',

  // Preview
  PREVIEW_CAPTURE: 'preview:capture',
} as const;
