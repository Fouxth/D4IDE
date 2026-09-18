import { ChatMessage, ModelInfo, ProviderErrorKind, ProviderTestResult, ToolCall } from '../../../shared/types';

export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  }[];
  temperature?: number;
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'auto';
  signal?: AbortSignal;
  /**
   * Conversation id, sent to providers that route and cache per session
   * (OpenCode Go asks for it as `x-opencode-session`). Same value for every
   * request in one agent session, so caching works across turns.
   */
  sessionId?: string;
}

export interface StreamChunk {
  content?: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Tokens served from the provider's prompt cache (priced lower). */
    cachedPromptTokens?: number;
    /** Tokens spent on internal reasoning, when the provider reports it. */
    reasoningTokens?: number;
  };
}

export interface IAIProvider {
  id: string;
  name: string;
  /** Discover the models this provider currently exposes for the configured key. */
  listModels(): Promise<ModelInfo[]>;
  streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void>;
  testConnection(apiKey?: string, baseUrl?: string, model?: string): Promise<ProviderTestResult>;
}

export interface ProviderRef {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
}

/** Maps an HTTP failure to a stable, translatable error kind. */
export function classifyHttpError(status: number, body = ''): ProviderErrorKind {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 429) return 'rate_limit';
  if (status === 404) {
    if (lower.includes('model')) return 'model_not_found';
    return 'bad_request';
  }
  if (status === 400) {
    if (lower.includes('context') || lower.includes('too long') || lower.includes('max_tokens')) {
      return 'context_exceeded';
    }
    if (lower.includes('model')) return 'model_not_found';
    return 'bad_request';
  }
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

export function classifyThrownError(error: unknown): ProviderErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('abort')) return 'cancelled';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('enotfound')) return 'unavailable';
  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) return 'invalid_key';
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limit';
  return 'unknown';
}

export function extractErrorMessage(body: string): string {
  try {
    const json = JSON.parse(body);
    const candidate = json.error?.message || json.error?.type || json.message || json.detail;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body.slice(0, 400).trim();
}
