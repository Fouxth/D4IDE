// Shared types between Main, Preload, and Renderer processes

export type { DesignStyle } from './design-profiles';
export type { ThemeId } from './theme';
import type { TeamConfig } from './ai-team';
import type { DesignStyle } from './design-profiles';
import type { ThemeId } from './theme';

export type PermissionMode = 'safe' | 'ask' | 'full';

export type WorkspaceMode = 'agent' | 'code';

export type AgentMode = 'plan' | 'build';

export type AgentStatus = 'idle' | 'planning' | 'waiting_approval' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';

/** Sounds a desktop notification can carry (see `AppSettings.notificationSound`). */
export type NotificationSound = 'system' | 'chime' | 'ping' | 'pop' | 'none';

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning?: boolean;
  supportsCaching?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
  /** Where this model entry came from: shipped preset, fetched from the provider API, or typed by the user. */
  source?: 'builtin' | 'fetched' | 'manual';
}

/**
 * Which wire protocol a provider speaks — not which company it is.
 *
 * `openai` is chat-completions, `anthropic` is `/messages`, `gemini` is Google's
 * `:streamGenerateContent`, and `responses` is OpenAI's newer `/responses`. The
 * distinction matters because one vendor can need several of them: OpenCode's
 * gateways serve GPT and Grok only on `/responses`, Claude and Qwen only on
 * `/messages`, and Gemini on the Google shape — the same key, three protocols.
 */
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'responses'
  | 'deepseek'
  | 'openrouter'
  | 'xai'
  | 'ollama'
  | 'custom';

export type ProviderStatus = 'connected' | 'not_configured' | 'error' | 'local' | 'unknown';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  /**
   * Where this provider lists models, when that is not `{baseUrl}/models`.
   * Perplexity is the shipped example: chat at the root, catalogue under `/v1`.
   */
  modelsPath?: string;
  /**
   * Encrypted API key. Only ever populated inside the main process.
   * IPC responses carry `hasApiKey` / `apiKeyPreview` instead (spec §29).
   */
  apiKey?: string;
  baseUrl?: string;
  models: ModelInfo[];
  isCustom?: boolean;
  isBuiltIn?: boolean;
  docsUrl?: string;
  requiresApiKey?: boolean;
  headers?: Record<string, string>;
  /** Sanitized flag: an API key is stored for this provider. */
  hasApiKey?: boolean;
  /** Sanitized masked preview, e.g. "••••1a2b". */
  apiKeyPreview?: string;
  /**
   * Sanitized flag: a key *is* on file for this provider but it cannot be
   * decrypted any more — the OS keychain that protected it has changed since.
   * Not the same as "no key": the user must paste it again, and until then no
   * request can be authorized, so the provider stays out of routing.
   */
  keyUnreadable?: boolean;
  status?: ProviderStatus;
  lastTestedAt?: number;
  lastError?: string;
  latencyMs?: number;
  modelCount?: number;
}

export interface ProviderTestResult {
  success: boolean;
  error?: string;
  errorKind?: ProviderErrorKind;
  latencyMs?: number;
  modelCount?: number;
}

/** One vendor's row in the "test every provider" summary (spec §30). */
export interface ProviderTestAllRow {
  providerId: string;
  name: string;
  protocols: string[];
  success: boolean;
  /** True when the key is fine but the probed model is gated off the plan. */
  gatedModel?: boolean;
  latencyMs?: number;
  modelCount?: number;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export interface ProviderTestAllResult {
  rows: ProviderTestAllRow[];
  okCount: number;
  failCount: number;
  testedAt: number;
}

/**
 * What the periodic health watch last learned about the provider the user is
 * talking to. Pushed to the renderer whenever a probe finishes, so a provider
 * that dies between tests is named in the UI before the next prompt fails.
 */
export interface ProviderHealthStatus {
  /** `unknown` — nothing probed yet, auto routing, or no active provider. */
  state: 'ok' | 'down' | 'unknown';
  providerId?: string;
  providerName?: string;
  errorKind?: ProviderErrorKind;
  error?: string;
  checkedAt?: number;
  /** A fallback that *answered its own probe*, offered only when `down`. */
  fallbackProviderId?: string;
  fallbackProviderName?: string;
  fallbackModelId?: string;
}

export type ProviderErrorKind =
  | 'invalid_key'
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'model_not_found'
  | 'context_exceeded'
  | 'bad_request'
  | 'cancelled'
  | 'unknown';

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp: number;
  /** Images attached to a user turn, sent only to vision-capable models (§52). */
  images?: PromptImage[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  output?: any;
  error?: string;
}

export interface AgentTodo {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/** Specialised helper agents the main agent may delegate to (spec §81). */
export type SubagentRole = 'explore' | 'review' | 'test' | 'debug' | 'frontend' | 'database';

export interface AgentTimelineItem {
  id: string;
  type:
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'plan'
    | 'design'
    | 'question'
    | 'message'
    | 'error'
    | 'summary'
    | 'subagent';
  title: string;
  content?: string;
  timestamp: number;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  status?: 'running' | 'success' | 'failed' | 'cancelled';
  /** Set when the item belongs to a delegated subagent run (spec §81). */
  agent?: SubagentRole;
  /** Screenshot captured by a browser tool, as a file path inside the project. */
  imagePath?: string;
  details?: any;
}

export interface PlanData {
  summary: string;
  steps: string[];
  affectedFiles: string[];
  estimatedScope: string;
  risk: 'Low' | 'Medium' | 'High';
  approved?: boolean;
  /** How far the user let the approved plan run (spec §35). */
  scope?: PlanScope;
}

/**
 * Approving a plan is not all-or-nothing: the user picks how far the agent may
 * go before it stops and asks again.
 *
 *   · `full`  — run the whole plan through to the summary.
 *   · `step`  — run one step, then wait for approval of the next.
 *   · `first` — run only the first step, then wait.
 */
export type PlanScope = 'full' | 'step' | 'first';

/**
 * A question the agent raises mid-run, with the answers already laid out.
 *
 * "What do you want?" wastes the one turn the user is willing to spend; a
 * question with concrete options can be answered in one click, and in Plan Mode
 * it is the difference between a plan for the right thing and a plan for a
 * guess. Options are bounded (see `shared/questions.ts`) so a model cannot turn
 * the card into a wall of prose.
 */
export interface QuestionOption {
  /** The answer itself, shown on the button. */
  label: string;
  /** One line explaining what choosing it means. */
  description?: string;
  /** The AI's recommendation, with a one-line why, so the user can decide fast. */
  recommended?: boolean;
  /** Why this option is recommended (shown under the recommendation badge). */
  reason?: string;
}

export interface AgentQuestion {
  /** Two or three words naming the topic, e.g. "ฐานข้อมูล". */
  header?: string;
  question: string;
  options: QuestionOption[];
  /** Several options may be true at once. */
  multiSelect?: boolean;
  /** The user may answer in their own words (always available when there are no options). */
  allowFreeText?: boolean;
  /**
   * The AI's suggested answer when no single option is marked, or a one-line
   * note on why it leans where it leans. Empty when the AI has no opinion.
   */
  aiSuggestion?: string;
}

/** One question's answer, as the user chose it. */
export interface QuestionAnswerEntry {
  question: string;
  /** Labels of the options the user picked, in the order asked. */
  selected: string[];
  /** Anything the user typed instead of, or in addition to, the options. */
  note?: string;
}

/** What the user did with a question card. */
export interface QuestionAnswer {
  answers: QuestionAnswerEntry[];
  /** True when the card was dismissed without answering. */
  skipped?: boolean;
}

/**
 * The style chooser the agent raises before it writes any UI.
 *
 * "Make it beautiful" is not a specification, and the user should not have to
 * repeat one in every prompt either. So on the first UI request in a project
 * with no style recorded, the agent asks — once, with the options laid out — and
 * the answer is remembered for that project from then on.
 */
export interface DesignChoiceRequest {
  /** Project the choice will be remembered for. */
  projectPath: string;
  /** The style currently recorded, when there is one. */
  current?: string;
  language: 'th' | 'en';
}

/** What the user did with the plan card. */
export interface PlanDecision {
  action: 'approve' | 'revise' | 'cancel';
  /** Chosen when `action` is `approve`; defaults to `full`. */
  scope?: PlanScope;
  /** What to change when `action` is `revise`. */
  feedback?: string;
}

/** Answer to the gate that pauses the build loop between steps. */
export type PlanStepDecision = 'continue' | 'runAll' | 'stop';

export interface TaskQueueItem {
  id: string;
  prompt: string;
  mode: AgentMode;
  /**
   * Images that were attached when the message was queued. A queued message is
   * still a message: dropping its pictures on the way into the queue would send
   * the words and silently lose the screenshot they referred to.
   */
  images?: PromptImage[];
  status: 'queued' | 'planning' | 'waiting_approval' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface FileChange {
  path: string;
  relativePath: string;
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  previousContent?: string;
  newContent?: string;
  diff?: string;
  additions: number;
  deletions: number;
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  files: { path: string; content: string }[];
}

export interface FileNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileNode[];
  size?: number;
}

export interface UsageRecord {
  id: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  estimatedCost: number;
  providerId: string;
  providerName?: string;
  modelId: string;
  modelName?: string;
  projectPath?: string;
  mode?: AgentMode;
  status: 'completed' | 'failed' | 'cancelled' | 'partial';
  durationMs?: number;
  timestamp: number;
  /**
   * What that one request finished: files changed, validations that really ran,
   * tokens spent. Kept on the usage row instead of in the transcript because it
   * is a report about the run, and the run's report belongs with its cost.
   */
  summary?: string;
  /** The user's request this summary reports on, so a list of them is readable. */
  summaryRequest?: string;
}

export interface UsageAggregate {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageBucket extends UsageAggregate {
  key: string;
  label: string;
}

/**
 * What has been spent, and nothing else.
 *
 * There are no limits in here on purpose. The app used to carry a spending
 * budget — daily, monthly and per-request caps, a hard stop and an automatic
 * thrift switch — which meant the engine could refuse to keep working on a
 * number the user had typed months earlier. Usage is a report now: it says what
 * a run cost, and the user decides what to do about it.
 */
export interface UsageSummary {
  session: UsageAggregate;
  today: UsageAggregate;
  month: UsageAggregate;
  allTime: UsageAggregate;
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  byProject: UsageBucket[];
  recent: UsageRecord[];
}

export interface ToolAuditEntry {
  id: string;
  sessionId: string;
  toolName: string;
  argsPreview: string;
  mode: PermissionMode;
  allowed: boolean;
  requiresApproval: boolean;
  decision?: 'approved' | 'approved_for_session' | 'rejected' | 'auto';
  reason?: string;
  durationMs?: number;
  timestamp: number;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolCall: ToolCall;
  mode: PermissionMode;
  reason?: string;
  timestamp: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  projectPath: string;
  providerId: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  status: AgentStatus;
}

/**
 * Sign-in (spec §7). The app is usable only after GitHub or Google sign-in, so
 * the identity and the gate state are shared between main and renderer.
 */
export type AuthProvider = 'github' | 'google';

export interface AuthProfile {
  provider: AuthProvider;
  id: string;
  login: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface AuthState {
  signedIn: boolean;
  profile: AuthProfile | null;
  signedInAt?: number;
  /** A client id is configured, so the flow can actually start. */
  githubReady: boolean;
  googleReady: boolean;
  /** The gate is switched on in settings. */
  required: boolean;
}

/** The GitHub device-flow code the user has to enter on github.com. */
export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  /** Set for the Google flow, whose URL is opened directly. */
  browserOpened?: boolean;
}

export interface DatabaseTableInfo {
  name: string;
  rows: number;
}

export interface DatabaseBackupInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
}

/** What Settings → Database reports about the SQLite file (spec §45). */
export interface DatabaseInfo {
  file: string;
  dataDir: string;
  sizeBytes: number;
  walBytes: number;
  /** Revision the file is on, and the revision this build expects. */
  version: number;
  targetVersion: number;
  journalMode: string;
  pageSize: number;
  pageCount: number;
  freePages: number;
  tables: DatabaseTableInfo[];
  backups: DatabaseBackupInfo[];
  /** Set when a damaged file was moved aside and a fresh one created. */
  quarantinedFile: string | null;
  /** False when the file was written by a newer build than this one. */
  healthy: boolean;
}

export interface DatabaseCheckResult {
  ok: boolean;
  problems: string[];
  checkedAt: number;
}

/**
 * Everything needed to replay a finished or interrupted run (spec §45). Written
 * continuously while the agent works, so a crash still leaves a usable trail.
 */
export interface SessionTranscript {
  sessionId: string;
  projectPath: string;
  timeline: AgentTimelineItem[];
  todos: AgentTodo[];
  plan: PlanData | null;
  updatedAt: number;
  /** False while a run is in flight — a restart can then offer recovery (§84). */
  endedCleanly: boolean;
  /** Mission in force for this session (spec §40). */
  mission?: Mission | null;
}

export interface AppSettings {
  language: 'th' | 'en';
  theme: ThemeId;
  fontSize: number;
  permissionMode: PermissionMode;
  defaultMode: AgentMode;
  autoRunTests: boolean;
  autoRunBuild: boolean;
  maxAgentSteps: number;
  activeProviderId: string;
  activeModelId: string;
  routingProfile: 'quality' | 'balanced' | 'cost' | 'fast';
  reasoningEffort: 'off' | 'low' | 'medium' | 'high' | 'auto';
  /**
   * Token economy. These are engine settings, not prompt wording: `/thrift`
   * flips `thriftMode` and the runtime changes what it actually sends.
   */
  thriftMode: boolean;
  /** Ceiling on the tokens carried by one request (0 = the default). */
  contextTokenBudget: number;
  /** Ceiling on the tokens one task may spend in total (0 = no ceiling). */
  runTokenBudget: number;
  /** Send small jobs (subagents, read-only work) to a cheaper model. */
  cheaperModelForSmallTasks: boolean;
  /** Provider/model used for those small jobs, `provider:model`. */
  cheapModelId: string;
  /**
   * The AI team: a model per role (planner / analyst / executor), `provider:model`.
   * An empty seat keeps the composer's model — the feature is dormant until a
   * seat is filled, and a malformed seat falls back the same way.
   */
  aiTeam: TeamConfig;
  /** Master switch for the AI team — off means every seat falls back to the main model. */
  aiTeamEnabled: boolean;
  autoFallback: boolean;
  fallbackChain: string[];
  toolTimeoutMs: number;
  retryLimit: number;
  checkpointFrequency: 'off' | 'task' | 'write';
  favoriteModels: string[];
  recentModels: string[];
  /**
   * The folders that stay on the rail, most recently opened first.
   *
   * Deliberately *not* the same list as `recentProjects`. Recents is a shortcut
   * list that ages out on its own (newest ten, so the picker stays short), while
   * a space is furniture: it sits on the rail until the user takes it off, and
   * switching back to one must never require finding the folder again. The two
   * are written together when a folder is opened, and removing a space leaves
   * the recents list alone.
   */
  spaces: string[];
  recentProjects: string[];
  /**
   * The order the user dragged the session strip into (session ids).
   *
   * Persisted rather than kept in the renderer so it survives a restart, and
   * stored as a whole order instead of a position per session so a list whose
   * contents changed still lands somewhere sensible.
   */
  sessionOrder: string[];
  /**
   * Sessions the user closed from the strip.
   *
   * Persisted for the same reason the order is: a closed tab that comes back on
   * the next launch is not closed, and every session in the database 
   * reappearing at once made opening a project look like it had undone the
   * tidying. Selecting a session anywhere removes its id from this list.
   */
  closedSessionIds?: string[];
  /**
   * Whether local runtimes (Ollama, LM Studio) appear in the model picker.
   *
   * Off by default: they need no API key, so "the runtime answered on this
   * machine" was being treated as "the user wants this listed", and a user who
   * uses neither still got both cards. Turning it on discovers their models.
   */
  localProvidersEnabled?: boolean;
  /** When the user answered "not now" to the one-time local-LLM nudge — it never asks again. */
  localLlmPromptDismissedAt?: number;
  firstRunComplete: boolean;
  /** Built-in providers the user removed — they must not come back on restart. */
  removedProviderIds: string[];
  /** Structured log verbosity (spec §66). */
  logLevel: LogLevel;
  /** OS notifications when the window is not focused (spec §53). */
  desktopNotifications: boolean;
  /**
   * Sound played alongside a desktop notification.
   *
   * `system` leaves the sound to Windows, the rest are short tones D4IDE plays
   * itself (so the choice exists on every platform and needs no asset files),
   * and `none` is silence.
   */
  notificationSound: NotificationSound;
  /**
   * Standing laws the user switched off on purpose.
   *
   * Every law in `STANDING_LAWS` is enforced by the engine, not just written in
   * a prompt — which is the point, and also why a few people legitimately need
   * to turn one off (a monorepo whose sibling folders belong to the same
   * project, a scaffold step that starts from an empty folder). Off means the
   * engine stops enforcing it *and* the model stops being told it, so the UI and
   * the prompt can never disagree.
   */
  disabledLaws: string[];
  /** Visual direction D4IDE applies to UI work; "ask" makes the agent ask first. */
  designStyle: DesignStyle;
  /** Ask before writing UI when the project has no style chosen yet. */
  askDesignBeforeUiWork: boolean;
  /** Remember what the project is, in the project itself, across sessions. */
  projectMemoryEnabled: boolean;

  // --------------------------------------------------------------- updates
  /**
   * These decide when D4IDE *looks* for a newer build. Nothing here can make it
   * download or install one: that is always a click, and there is deliberately
   * no setting that changes that.
   */
  updateCheckEnabled: boolean;
  /** Check shortly after launch, in addition to the recurring interval. */
  checkUpdatesOnLaunch: boolean;
  updateCheckIntervalHours: number;
  /** Epoch ms of the last completed check, so the interval survives a restart. */
  lastUpdateCheckAt: number;
  /** Version already announced, so the same build is not announced twice. */
  lastNotifiedVersion: string;
  /** Version the user skipped — silence until something newer shows up. */
  skippedUpdateVersion: string;
  /** Provider model lists and prices, on the same "look, never apply" rule. */
  catalogCheckEnabled: boolean;
  catalogCheckIntervalHours: number;
  lastCatalogCheckAt: number;
  /**
   * The periodic watch on the provider being talked to. The failure it finds is
   * shown as a banner over the chat the moment the probe lands, not here.
   */
  providerHealthCheckEnabled: boolean;
  providerHealthCheckIntervalMinutes: number;

  // ------------------------------------------------------------- sign-in
  /** The whole app is locked behind GitHub or Google sign-in (spec §7). */
  requireLogin: boolean;
  /**
   * Public client ids for the sign-in flows. These are not secrets — they are
   * how the app identifies itself to GitHub/Google — so they live in settings
   * where they can be changed without rebuilding.
   */
  githubClientId?: string;
  googleClientId?: string;
}

/** Log streams the app keeps apart (spec §66). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogChannel = 'app' | 'agent' | 'provider' | 'terminal';

export interface LogRecord {
  id: string;
  channel: LogChannel;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Mission: persistent, session-scoped context (spec §40). It is deliberately
 * separate from project rules — rules are committed with the repository, a
 * mission belongs to what the user is doing right now.
 */
export interface Mission {
  objective: string;
  constraints: string;
  codingStyle: string;
  importantFiles: string[];
  forbiddenActions: string;
  effort: 'low' | 'medium' | 'high';
}

export const EMPTY_MISSION: Mission = {
  objective: '',
  constraints: '',
  codingStyle: '',
  importantFiles: [],
  forbiddenActions: '',
  effort: 'medium'
};

/** An image the user attached to a prompt (spec §52). */
export interface PromptImage {
  id: string;
  name: string;
  mimeType: string;
  /** Base64 payload without the data-URL prefix. */
  data: string;
  bytes: number;
}

/** Unsaved editor buffers, persisted so a crash does not lose them (spec §84). */
export interface BufferSnapshot {
  path: string;
  relativePath: string;
  content: string;
  dirty: boolean;
  savedAt: number;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported';
  version?: string;
  notes?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
  /** Release date reported by the feed, shown next to the version. */
  releasedAt?: string;
}

/** Everything the updater can be in, named once so switches can match on it. */
export type UpdateState = UpdateStatus['state'];

/**
 * The model catalogue: what the providers report, staged before it is applied.
 *
 * These live here rather than next to the service because the renderer has to
 * describe them to the user — "3 new models, 5 price changes" — and a renderer
 * that imported a main-process module for the type would be reaching across the
 * process boundary for words.
 */
export interface ModelChange {
  id: string;
  name: string;
  /** Human-readable field names that would change. */
  fields: string[];
}

export interface ProviderCatalogChange {
  providerId: string;
  providerName: string;
  added: ModelChange[];
  changed: ModelChange[];
  /** Configured models this provider no longer lists. Kept, never deleted. */
  missingUpstream: string[];
}

export interface CatalogDiff {
  checkedAt: number;
  providers: ProviderCatalogChange[];
  totals: { providers: number; added: number; changed: number; kept: number; failed: number };
  /** Providers that could not be asked, with why. */
  failures: { providerId: string; error: string }[];
}

export interface CatalogStatus {
  state: 'idle' | 'checking' | 'changes' | 'error';
  diff?: CatalogDiff;
  error?: string;
  checkedAt?: number;
  /** A snapshot of the models replaced by the last apply is restorable. */
  undoAvailable: boolean;
}

export interface ContextItem {
  id: string;
  type: 'file' | 'folder' | 'git_diff' | 'terminal' | 'selection' | 'rule';
  name: string;
  path?: string;
  content: string;
  tokenCount: number;
  isPinned?: boolean;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  content: string;
  isGlobal: boolean;
}

/**
 * Transport for an MCP server (spec §42). Stdio is the default because most
 * published servers are local processes; HTTP covers the hosted ones.
 */
export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  id: string;
  name: string;
  transport?: McpTransport;
  /** stdio: executable to spawn. */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** http: full endpoint URL, e.g. https://api.example.com/mcp. */
  url?: string;
  /** http: extra request headers, e.g. an authorization token. */
  headers?: Record<string, string>;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** Last connection error, surfaced in Settings → MCP. */
  error?: string;
}

export interface GitStatusSummary {
  branch: string;
  isClean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  /**
   * False when the folder is not a git working tree at all.
   *
   * The status bar used to print a branch cell unconditionally and fell back to
   * an em dash, so every non-git folder carried a dead "—" in the corner. Absent
   * on older payloads; treat that as "unknown, keep showing what we have".
   */
  isRepo?: boolean;
  /** `origin`'s URL, when the repository has one. No remote, nothing to sync. */
  remote?: string | null;
}

/**
 * The datastore a project is built on (for the project database panel).
 *
 * Detected from the project's own files — a driver in `package.json`, a Prisma
 * provider, a compose service, a connection URL in `.env` — never guessed. A
 * connection URL is parsed down to host/port/database before it travels, so no
 * credential can reach the interface or a log through this type.
 */
export type DatabaseEngine =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'sqlite'
  | 'libsql'
  | 'redis'
  | 'clickhouse'
  | 'dynamodb'
  | 'firestore'
  | 'mssql'
  | 'oracle'
  | 'unknown';

export interface DatabaseFinding {
  engine: DatabaseEngine;
  /** A cache is not a database, but it is worth knowing about. */
  kind: 'database' | 'cache';
  /** Drivers that imply this engine, e.g. ["pg"]. */
  clients: string[];
  evidence: Array<{ file: string; detail: string }>;
  /** Read from a connection URL, with the user and password removed. */
  target?: { host?: string; port?: number; database?: string; user?: string };
  /** Environment variables the project expects but does not define. */
  missingEnv: string[];
}

export interface ProjectDatabaseReport {
  /** Files that were actually read — evidence that detection really looked. */
  scanned: string[];
  databases: DatabaseFinding[];
  /** ORMs and query builders, which say how the data is used but not on what. */
  tooling: string[];
}
