import { ChatMessage, ToolCall, ToolResult } from '../../../shared/types';

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
  };
}

export interface IAIProvider {
  id: string;
  name: string;
  streamChat(
    req: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void>;
  testConnection(apiKey: string, baseUrl?: string, model?: string): Promise<{ success: boolean; error?: string }>;
}
