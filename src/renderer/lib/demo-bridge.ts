import { AppSettings, FileNode, ProviderConfig, SessionSummary, SkillItem, UsageSummary } from '../../shared/types';
import { PROVIDER_PRESETS } from '../../shared/provider-presets';
import { DEMO_TIMELINE } from './demo-session';

/**
 * A stand-in for the Electron bridge, for UI work in a plain browser.
 *
 * The renderer is a separate process from the agent runtime, and most screens
 * are unreadable without it: settings needs stored settings, usage needs
 * numbers, sessions needs transcripts. Opening the dev server with `?demo=1`
 * installs this mock instead, so every page can be opened, clicked and seen
 * without a provider, a key or a project. It is only ever installed when no
 * real bridge is present, and the packaged renderer is loaded from `file://`
 * with no query string, so it cannot run in a shipped build.
 */

const SETTINGS: AppSettings = {
  language: 'th',
  theme: 'd4-dark',
  fontSize: 13,
  permissionMode: 'safe',
  defaultMode: 'build',
  autoRunTests: true,
  autoRunBuild: true,
  maxAgentSteps: 40,
  activeProviderId: 'opencode-go',
  activeModelId: 'glm-5.3',
  routingProfile: 'balanced',
  reasoningEffort: 'medium',
  dailyBudget: 10,
  monthlyBudget: 100,
  perRequestBudget: 1,
  budgetHardStop: false,
  autoThriftOnBudget: true,
  budgetWarnThreshold: 0.8,
  thriftMode: false,
  contextTokenBudget: 48000,
  runTokenBudget: 0,
  cheaperModelForSmallTasks: false,
  cheapModelId: '',
  designStyle: 'minimal',
  askDesignBeforeUiWork: true,
  projectMemoryEnabled: true,
  updateCheckEnabled: true,
  checkUpdatesOnLaunch: true,
  updateCheckIntervalHours: 6,
  lastUpdateCheckAt: 0,
  lastNotifiedVersion: '',
  skippedUpdateVersion: '',
  catalogCheckEnabled: true,
  catalogCheckIntervalHours: 24,
  lastCatalogCheckAt: 0,
  autoFallback: true,
  fallbackChain: [],
  toolTimeoutMs: 120000,
  retryLimit: 2,
  checkpointFrequency: 'write',
  favoriteModels: ['opencode-go::glm-5.3'],
  recentModels: ['opencode-go::kimi-k3', 'anthropic::claude-sonnet-5'],
  recentProjects: ['F:\\D4IDE'],
  sessionOrder: [],
  firstRunComplete: true,
  removedProviderIds: [],
  logLevel: 'info',
  desktopNotifications: true,
  requireLogin: false
};

const now = Date.now();

const zeroAggregate = { requests: 12, inputTokens: 184320, outputTokens: 21450, cachedInputTokens: 96000, totalTokens: 205770, cost: 0.42 };

const USAGE: UsageSummary = {
  session: zeroAggregate,
  today: { ...zeroAggregate, requests: 38, totalTokens: 611240, cost: 1.31 },
  month: { ...zeroAggregate, requests: 402, totalTokens: 7402110, cost: 18.4 },
  allTime: { ...zeroAggregate, requests: 402, totalTokens: 7402110, cost: 18.4 },
  byProvider: [
    { ...zeroAggregate, key: 'opencode-go', label: 'OpenCode Go', cost: 11.2 },
    { ...zeroAggregate, key: 'opencode-zen', label: 'OpenCode Zen', cost: 5.1 },
    { ...zeroAggregate, key: 'anthropic', label: 'Anthropic', cost: 2.1 }
  ],
  byModel: [
    { ...zeroAggregate, key: 'glm-5.3', label: 'GLM 5.3', cost: 9.4 },
    { ...zeroAggregate, key: 'kimi-k3', label: 'Kimi K3', cost: 6.2 },
    { ...zeroAggregate, key: 'claude-sonnet-5', label: 'Claude Sonnet 5', cost: 2.8 }
  ],
  byProject: [{ ...zeroAggregate, key: 'F:\\D4IDE', label: 'D4IDE', cost: 18.4 }],
  recent: [],
  budget: {
    perRequest: 1,
    daily: 10,
    monthly: 100,
    warnThreshold: 0.8,
    hardStop: false,
    dailySpent: 1.31,
    monthlySpent: 18.4,
    dailyPct: 0.131,
    monthlyPct: 0.184,
    warn: false,
    exceeded: false
  }
};

const SESSIONS: SessionSummary[] = [
  {
    id: 'demo_session',
    title: 'opencode go ครับ และใช้เช็คการทำงาน ให้ใช้งานได้ 100%',
    projectPath: 'F:\\D4IDE',
    providerId: 'opencode-go',
    modelId: 'glm-5.3',
    createdAt: now - 3600_000,
    updatedAt: now - 60_000,
    status: 'idle'
  },
  {
    id: 'demo_session_2',
    title: 'ทำให้เหมือน Freebuff Desktop และใช้งานได้ทุกหน้า',
    projectPath: 'F:\\D4IDE',
    providerId: 'opencode-zen',
    modelId: 'deepseek-v4-flash',
    createdAt: now - 86_400_000,
    updatedAt: now - 80_000_000,
    status: 'completed'
  },
  {
    id: 'demo_session_3',
    title: 'ซ่อม pnpm/corepack และตรึงเวอร์ชัน',
    projectPath: 'F:\\D4IDE',
    providerId: 'opencode-zen',
    modelId: 'kimi-k2.7-code',
    createdAt: now - 172_800_000,
    updatedAt: now - 170_000_000,
    status: 'completed'
  }
];

const TREE: FileNode = {
  name: 'D4IDE',
  path: 'F:\\D4IDE',
  relativePath: '',
  isDirectory: true,
  children: [
    {
      name: 'src',
      path: 'F:\\D4IDE\\src',
      relativePath: 'src',
      isDirectory: true,
      children: [
        { name: 'main', path: 'F:\\D4IDE\\src\\main', relativePath: 'src\\main', isDirectory: true, children: [] },
        {
          name: 'renderer',
          path: 'F:\\D4IDE\\src\\renderer',
          relativePath: 'src\\renderer',
          isDirectory: true,
          children: []
        },
        { name: 'shared', path: 'F:\\D4IDE\\src\\shared', relativePath: 'src\\shared', isDirectory: true, children: [] }
      ]
    },
    {
      name: 'package.json',
      path: 'F:\\D4IDE\\package.json',
      relativePath: 'package.json',
      isDirectory: false
    },
    { name: 'README.md', path: 'F:\\D4IDE\\README.md', relativePath: 'README.md', isDirectory: false },
    { name: 'D4IDE.md', path: 'F:\\D4IDE\\D4IDE.md', relativePath: 'D4IDE.md', isDirectory: false }
  ]
};

const SKILLS: SkillItem[] = [
  {
    id: 'review',
    name: 'review',
    description: 'Read the change, look for bugs and risks, report back with file and line.',
    content: 'Review the current diff…',
    isGlobal: true
  },
  {
    id: 'test',
    name: 'test',
    description: 'Run the affected tests, then the full suite, and fix what fails.',
    content: 'Run the tests…',
    isGlobal: true
  },
  {
    id: 'simplify',
    name: 'simplify',
    description: 'Cut the code down without changing behaviour.',
    content: 'Simplify…',
    isGlobal: true
  },
  {
    id: 'commit',
    name: 'commit',
    description: 'Stage the change you made and commit it with a clear message.',
    content: 'Commit…',
    isGlobal: true
  },
  {
    id: 'open-pr',
    name: 'open-pr',
    description: 'Push the branch and open a pull request with a summary.',
    content: 'Open a PR…',
    isGlobal: true
  },
  {
    id: 'overhead',
    name: 'overhead',
    description: 'Trim the plan to the smallest change that solves the problem.',
    content: 'Trim…',
    isGlobal: false
  },
  {
    id: 'essential',
    name: 'essential',
    description: 'Re-derive the requirement and drop everything that is not it.',
    content: 'Essentials…',
    isGlobal: false
  },
  {
    id: 'brainstorm',
    name: 'brainstorm',
    description: 'List three different approaches before choosing one.',
    content: 'Brainstorm…',
    isGlobal: false
  },
  {
    id: 'explain',
    name: 'explain',
    description: 'Explain how the piece you just read works, in plain language.',
    content: 'Explain…',
    isGlobal: false
  },
  {
    id: 'derisk',
    name: 'derisk',
    description: 'Name the riskiest assumption and check it first.',
    content: 'Derisk…',
    isGlobal: false
  }
];

/**
 * The real provider list, so the hub can be reviewed with every vendor on it.
 * The first few pretend to hold a key, which is what makes the cards show their
 * connected state instead of an empty form.
 */
const CONNECTED = new Set(['opencode-go', 'opencode-zen', 'anthropic']);

const PROVIDERS: ProviderConfig[] = PROVIDER_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  type: preset.type,
  enabled: true,
  baseUrl: preset.baseUrl,
  modelsPath: preset.modelsPath,
  requiresApiKey: preset.requiresApiKey,
  docsUrl: preset.docsUrl,
  isBuiltIn: true,
  hasApiKey: CONNECTED.has(preset.id),
  apiKeyPreview: CONNECTED.has(preset.id) ? 'sk-demo-…40f2' : undefined,
  status: CONNECTED.has(preset.id) ? 'connected' : preset.isLocal ? 'local' : 'not_configured',
  models: preset.models.map((model) => ({ ...model, providerId: preset.id }))
}));

const MCP_SERVERS = [
  {
    id: 'fs',
    name: 'filesystem',
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    status: 'connected' as const
  },
  {
    id: 'remote',
    name: 'remote-docs',
    transport: 'http' as const,
    url: 'https://example.com/mcp',
    status: 'disconnected' as const
  }
];

const MCP_TOOLS = [
  {
    serverId: 'fs',
    serverName: 'filesystem',
    tools: [
      { name: 'read_file', description: 'Read a file from the allowed directory' },
      { name: 'write_file', description: 'Write a file' },
      { name: 'list_directory', description: 'List a directory' }
    ]
  }
];

const noop = async () => null;
const unsubscribe = () => () => {};

const EXPLICIT: Record<string, (...args: any[]) => any> = {
  getSettings: async () => SETTINGS,
  updateSettings: async (partial: Partial<AppSettings>) => Object.assign(SETTINGS, partial),
  getProviders: async () => PROVIDERS,
  saveProviders: async (providers: unknown) => providers,
  testProvider: async () => ({ success: true, models: 0 }),
  refreshProviderModels: async () => ({ success: true, models: [] }),
  listSessions: async () => SESSIONS,
  getSessionTranscript: async (sessionId: string) => ({
    sessionId,
    projectPath: 'F:\\D4IDE',
    timeline: DEMO_TIMELINE,
    todos: [],
    plan: null,
    updatedAt: now,
    endedCleanly: true
  }),
  getUsage: async () => USAGE,
  resetUsage: async () => USAGE,
  getUpdateStatus: async () => ({ state: 'unsupported', channel: 'demo' }),
  getProjectTree: () => TREE,
  gitStatus: async () => ({ branch: 'master', staged: [], unstaged: [], untracked: [] }),
  listSkills: async () => SKILLS,
  listCheckpoints: async () => [],
  listToolAudit: async () => [],
  listMcp: async () => MCP_SERVERS,
  discoveredMcpTools: async () => MCP_TOOLS,
  startMcp: async () => ({ success: true, tools: MCP_TOOLS[0].tools }),
  stopMcp: async () => ({ success: true }),
  refreshMcpTools: async () => ({ tools: 3 }),
  logCounts: async () => ({}),
  readLogs: async () => [],
  detectPreviewUrls: async () => ['http://localhost:5173'],
  resolveAutoModel: async () => ({ modelName: 'GLM 5.3', reason: 'Demo bridge — nothing was called.' }),
  readFile: async () => '// The demo bridge has no filesystem. Open a project to read real files.\n',
  searchFiles: async () => [],
  openProjectDialog: async () => null,
  onAgentEvent: unsubscribe,
  onUsageEvent: unsubscribe,
  onApprovalRequest: unsubscribe,
  onPreviewDiscovered: unsubscribe,
  onFileChanged: unsubscribe,
  onTerminalData: unsubscribe,
  onUpdateStatus: unsubscribe,
  onAuthPrompt: unsubscribe,
  // The demo bridge is for looking at screens, so it reports a signed-in user
  // rather than showing the lock screen with no way past it.
  authStatus: async () => ({
    signedIn: true,
    profile: { provider: 'github', id: '1', login: 'demo-user', name: 'Demo User' },
    signedInAt: now,
    githubReady: true,
    googleReady: true,
    required: false
  }),
  authSignIn: async () => ({ success: true }),
  authSignOut: async () => true,
  dbInfo: async () => null,
  dbCheck: async () => ({ ok: true, problems: [], checkedAt: now }),
  dbBackup: async () => null,
  dbVacuum: async () => null,
  dbOpenFolder: async () => true
};

/**
 * The mock API object. Unknown calls resolve to null instead of exploding the
 * page, which is what lets a half-mocked screen still be opened and looked at.
 */
export function demoApi(): Record<string, (...args: any[]) => any> {
  return new Proxy(EXPLICIT, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return noop;
    }
  });
}

