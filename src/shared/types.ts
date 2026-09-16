// Shared types between Main, Preload, and Renderer processes

export type PermissionMode = 'safe' | 'ask' | 'full';

export type WorkspaceMode = 'agent' | 'code';

export type AgentMode = 'plan' | 'build';

export type AgentStatus = 'idle' | 'planning' | 'waiting_approval' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'xai' | 'ollama' | 'custom';
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models: ModelInfo[];
  isCustom?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp: number;
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

export interface AgentTimelineItem {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'plan' | 'message' | 'error' | 'summary';
  title: string;
  content?: string;
  timestamp: number;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  status?: 'running' | 'success' | 'failed' | 'cancelled';
  details?: any;
}

export interface PlanData {
  summary: string;
  steps: string[];
  affectedFiles: string[];
  estimatedScope: string;
  risk: 'Low' | 'Medium' | 'High';
  approved?: boolean;
}

export interface TaskQueueItem {
  id: string;
  prompt: string;
  mode: AgentMode;
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
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  estimatedCost: number;
  providerId: string;
  modelId: string;
  timestamp: number;
}

export interface AppSettings {
  language: 'th' | 'en';
  theme: 'd4-dark' | 'd4-light';
  fontSize: number;
  permissionMode: PermissionMode;
  defaultMode: AgentMode;
  autoRunTests: boolean;
  autoRunBuild: boolean;
  maxAgentSteps: number;
  activeProviderId: string;
  activeModelId: string;
  reasoningEffort: 'off' | 'low' | 'medium' | 'high' | 'auto';
  dailyBudget: number;
  monthlyBudget: number;
  perRequestBudget: number;
  recentProjects: string[];
  firstRunComplete: boolean;
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

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
}

export interface GitStatusSummary {
  branch: string;
  isClean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}
