import {
  IAIProvider,
  ProviderChatRequest,
  StreamChunk,
  classifyHttpError,
  classifyThrownError,
  extractErrorMessage
} from './provider-interface';
import { ModelInfo, ProviderTestResult } from '../../../shared/types';
import { buildIdentityHeaders } from './client-identity';
import { verifyKeyIfModelsArePublic } from './key-verification';

const ANTHROPIC_VERSION = '2023-06-01';

const THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384
};

export class AnthropicProvider implements IAIProvider {
  id = 'anthropic';
  name = 'Anthropic';
  baseUrl: string;
  apiKey: string;

  constructor(apiKey = '', baseUrl = 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private headers(apiKey = this.apiKey, sessionId?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Anthropic-shaped gateways (OpenCode Zen, MiniMax, Kimi) sit behind the
      // same client-identity rules as the OpenAI-shaped ones.
      ...buildIdentityHeaders(this.baseUrl, sessionId)
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models?limit=100`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      const err: any = new Error(extractErrorMessage(body) || `HTTP ${res.status}`);
      err.errorKind = classifyHttpError(res.status, body);
      throw err;
    }
    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    return list
      .map((m: any) => ({ id: m.id as string, display: m.display_name as string }))
      .filter((m) => !!m.id)
      .map(
        (m): ModelInfo => ({
          id: m.id,
          name: m.display || m.id,
          providerId: this.id,
          supportsTools: true,
          supportsVision: true,
          supportsReasoning: /(sonnet|opus|3-7)/i.test(m.id),
          supportsCaching: true,
          contextWindow: 200000,
          source: 'fetched'
        })
      );
  }

  async testConnection(apiKey = this.apiKey, baseUrl?: string, _model?: string): Promise<ProviderTestResult> {
    const started = Date.now();
    const targetBase = (baseUrl || this.baseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${targetBase}/models?limit=1`, { headers: this.headers(apiKey) });
      if (!res.ok) {
        const body = await res.text();
        return {
          success: false,
          error: extractErrorMessage(body) || `HTTP ${res.status}`,
          errorKind: classifyHttpError(res.status, body),
          latencyMs: Date.now() - started
        };
      }
      const data: any = await res.json().catch(() => ({}));

      // See key-verification.ts: where the model list is public it cannot vouch
      // for the key, and an Anthropic-shaped gateway is one of those places.
      const verification = await verifyKeyIfModelsArePublic({
        modelsUrl: `${targetBase}/models`,
        headers: this.headers(apiKey)
      });
      if (verification.modelsArePublic && verification.keyProvided) {
        const probe = await this.probeKey(targetBase, apiKey, _model);
        if (!probe.ok) return { ...probe, latencyMs: Date.now() - started };
      }

      return {
        success: true,
        latencyMs: Date.now() - started,
        modelCount: Array.isArray(data?.data) ? data.data.length : 0
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Anthropic connection failed', errorKind: classifyThrownError(e) };
    }
  }

  /** One minimal message; the only key check available to a public model list. */
  private async probeKey(
    targetBase: string,
    apiKey: string,
    model?: string
  ): Promise<{ ok: true } | { ok: false; success: false; error: string; errorKind: any }> {
    try {
      const res = await fetch(`${targetBase}/messages`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return {
        ok: false,
        success: false,
        error: extractErrorMessage(body) || `HTTP ${res.status}`,
        errorKind: classifyHttpError(res.status, body)
      };
    } catch (e: any) {
      return { ok: false, success: false, error: e.message || 'Connection failed', errorKind: classifyThrownError(e) };
    }
  }

  async streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const url = `${this.baseUrl}/messages`;
    const headers = this.headers(this.apiKey, req.sessionId);
    const systemMessage = req.messages.find((m) => m.role === 'system');

    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: m.content
              }
            ]
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const contentBlocks: any[] = [];
          if (m.content) contentBlocks.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
          }
          return { role: 'assistant', content: contentBlocks };
        }
        // Vision input (spec §52): Anthropic takes image blocks in the user turn.
        if (m.role === 'user' && m.images && m.images.length > 0) {
          return {
            role: 'user',
            content: [
              ...m.images.map((image) => ({
                type: 'image',
                source: { type: 'base64', media_type: image.mimeType, data: image.data }
              })),
              ...(m.content ? [{ type: 'text', text: m.content }] : [])
            ]
          };
        }
        return { role: m.role, content: m.content };
      });

    const thinkingBudget =
      req.reasoningEffort && req.reasoningEffort !== 'off' && req.reasoningEffort !== 'auto'
        ? THINKING_BUDGETS[req.reasoningEffort]
        : undefined;

    const body: Record<string, any> = {
      model: req.model,
      messages,
      max_tokens: thinkingBudget ? Math.max(thinkingBudget + 4096, 8192) : 8192,
      stream: true
    };

    if (systemMessage) body.system = systemMessage.content;

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    if (thinkingBudget) {
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    } else if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal
    });

    if (!response.ok) {
      const txt = await response.text();
      const err: any = new Error(extractErrorMessage(txt) || `HTTP ${response.status}`);
      err.errorKind = classifyHttpError(response.status, txt);
      err.status = response.status;
      throw err;
    }

    if (!response.body) throw new Error('Response body empty');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';

    // Anthropic reports input tokens on message_start and output tokens on message_delta.
    let inputTokens = 0;
    let cachedReadTokens = 0;
    let cacheCreationTokens = 0;
    let outputTokens = 0;

    const flushUsage = () => {
      if (inputTokens === 0 && outputTokens === 0 && cachedReadTokens === 0 && cacheCreationTokens === 0) return;
      const promptTokens = inputTokens + cachedReadTokens + cacheCreationTokens;
      onChunk({
        usage: {
          promptTokens,
          completionTokens: outputTokens,
          totalTokens: promptTokens + outputTokens,
          cachedPromptTokens: cachedReadTokens
        }
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        let data: any;
        try {
          data = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        if (data.type === 'error') {
          const err: any = new Error(data.error?.message || 'Anthropic stream error');
          err.errorKind = data.error?.type === 'overloaded_error' ? 'unavailable' : 'bad_request';
          throw err;
        }

        if (data.type === 'message_start') {
          const usage = data.message?.usage;
          if (usage) {
            // input_tokens excludes cached tokens on Anthropic's API.
            inputTokens = usage.input_tokens || 0;
            cachedReadTokens = usage.cache_read_input_tokens || 0;
            cacheCreationTokens = usage.cache_creation_input_tokens || 0;
            outputTokens = usage.output_tokens || 0;
          }
          continue;
        }

        if (data.type === 'content_block_start') {
          if (data.content_block?.type === 'tool_use') {
            currentToolId = data.content_block.id;
            currentToolName = data.content_block.name;
            currentToolArgs = '';
          }
          continue;
        }

        if (data.type === 'content_block_delta') {
          if (data.delta?.type === 'text_delta') {
            onChunk({ content: data.delta.text });
          } else if (data.delta?.type === 'thinking_delta') {
            onChunk({ reasoningContent: data.delta.thinking });
          } else if (data.delta?.type === 'input_json_delta') {
            currentToolArgs += data.delta.partial_json;
          }
          continue;
        }

        if (data.type === 'content_block_stop') {
          if (currentToolId) {
            let parsed: Record<string, any> = {};
            try {
              parsed = currentToolArgs ? JSON.parse(currentToolArgs) : {};
            } catch {
              parsed = { raw: currentToolArgs };
            }
            onChunk({
              toolCalls: [{ id: currentToolId, name: currentToolName, args: parsed }],
              finishReason: 'tool_calls'
            });
            currentToolId = '';
            currentToolName = '';
            currentToolArgs = '';
          }
          continue;
        }

        if (data.type === 'message_delta') {
          if (data.usage?.output_tokens !== undefined) {
            outputTokens = data.usage.output_tokens;
          }
          flushUsage();
          continue;
        }

        if (data.type === 'message_stop') {
          flushUsage();
        }
      }
    }
  }
}
