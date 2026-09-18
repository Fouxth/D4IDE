import {
  IAIProvider,
  ProviderChatRequest,
  StreamChunk,
  classifyHttpError,
  classifyThrownError,
  extractErrorMessage
} from './provider-interface';
import { ModelInfo, ProviderTestResult, ToolCall } from '../../../shared/types';
import { buildIdentityHeaders } from './client-identity';
import { verifyKeyIfModelsArePublic } from './key-verification';

interface OpenAICompatibleOptions {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Ollama exposes a native `/api/tags` endpoint with more detail than the OpenAI shim. */
  isLocal?: boolean;
  extraHeaders?: Record<string, string>;
  /** Path the model list lives at, when it is not `{baseUrl}/models`. */
  modelsPath?: string;
}

export class OpenAICompatibleProvider implements IAIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isLocal: boolean;
  extraHeaders: Record<string, string>;
  modelsPath: string;

  constructor(options: OpenAICompatibleOptions);
  constructor(id: string, name: string, baseUrl: string, apiKey?: string);
  constructor(optionsOrId: OpenAICompatibleOptions | string, name?: string, baseUrl?: string, apiKey = '') {
    if (typeof optionsOrId === 'string') {
      this.id = optionsOrId;
      this.name = name || optionsOrId;
      this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      this.apiKey = apiKey;
      this.isLocal = false;
      this.extraHeaders = {};
      this.modelsPath = '/models';
    } else {
      this.id = optionsOrId.id;
      this.name = optionsOrId.name;
      this.baseUrl = optionsOrId.baseUrl.replace(/\/+$/, '');
      this.apiKey = optionsOrId.apiKey || '';
      this.isLocal = !!optionsOrId.isLocal;
      this.extraHeaders = optionsOrId.extraHeaders || {};
      this.modelsPath = optionsOrId.modelsPath || '/models';
    }
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private headers(apiKey = this.apiKey, sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Identify the client, and carry the conversation id to gateways that
      // route and cache per session (OpenCode Go documents both).
      ...buildIdentityHeaders(this.baseUrl, sessionId),
      ...this.extraHeaders
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  /**
   * Ollama's OpenAI shim lists models at `/v1/models`, but its native endpoint
   * carries `size`/`details` we can surface as a nicer label.
   */
  async listModels(): Promise<ModelInfo[]> {
    if (this.isLocal) {
      const nativeBase = this.baseUrl.replace(/\/v1\/?$/, '');
      try {
        const res = await fetch(`${nativeBase}/api/tags`, { headers: this.headers() });
        if (res.ok) {
          const data: any = await res.json();
          const models = Array.isArray(data?.models) ? data.models : [];
          if (models.length > 0) {
            return models.map(
              (m: any): ModelInfo => ({
                id: m.name || m.model,
                name: m.name || m.model,
                providerId: this.id,
                supportsTools: true,
                supportsVision: false,
                supportsReasoning: false,
                inputPricePerMillion: 0,
                outputPricePerMillion: 0,
                cachedInputPricePerMillion: 0,
                contextWindow: m.details?.context_length || undefined,
                source: 'fetched'
              })
            );
          }
        }
      } catch {
        // Fall through to the OpenAI-compatible endpoint.
      }
    }

    const res = await fetch(`${this.baseUrl}${this.modelsPath}`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      const err: any = new Error(extractErrorMessage(body) || `HTTP ${res.status}`);
      err.errorKind = classifyHttpError(res.status, body);
      err.status = res.status;
      throw err;
    }
    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    return list
      .map((m: any) => ({
        id: typeof m === 'string' ? m : m.id || m.name,
        name: typeof m === 'string' ? m : m.id || m.name,
        contextWindow: m?.context_length || m?.context_window || undefined,
        inputPricePerMillion:
          m?.pricing?.prompt !== undefined ? Number(m.pricing.prompt) * 1_000_000 : undefined,
        outputPricePerMillion:
          m?.pricing?.completion !== undefined ? Number(m.pricing.completion) * 1_000_000 : undefined
      }))
      .filter((m) => !!m.id)
      .map(
        (m): ModelInfo => ({
          id: m.id,
          name: m.name,
          providerId: this.id,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: /(reason|r1|o1|o3|o4|thinking)/i.test(m.id),
          contextWindow: m.contextWindow,
          inputPricePerMillion: Number.isFinite(m.inputPricePerMillion) ? m.inputPricePerMillion : undefined,
          outputPricePerMillion: Number.isFinite(m.outputPricePerMillion) ? m.outputPricePerMillion : undefined,
          source: 'fetched'
        })
      );
  }

  async testConnection(apiKey = this.apiKey, baseUrl?: string, model?: string): Promise<ProviderTestResult> {
    const started = Date.now();
    const targetBase = (baseUrl || this.baseUrl).replace(/\/+$/, '');

    // Prefer /models: it validates the key without spending generation tokens.
    try {
      const res = await fetch(`${targetBase}/models`, { headers: this.headers(apiKey) });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const count = Array.isArray(data?.data) ? data.data.length : Array.isArray(data?.models) ? data.models.length : 0;

        // A public model list says nothing about the key, so prove it separately
        // rather than showing a success the first real request will contradict.
        const verification = await verifyKeyIfModelsArePublic({
          modelsUrl: `${targetBase}/models`,
          headers: this.headers(apiKey)
        });
        if (verification.modelsArePublic && verification.keyProvided) {
          const probe = await this.probeKey(targetBase, apiKey, model);
          if (!probe.ok) return { ...probe, latencyMs: Date.now() - started };
        }

        return { success: true, latencyMs: Date.now() - started, modelCount: count };
      }
      if (res.status !== 404 && res.status !== 405) {
        const body = await res.text();
        return {
          success: false,
          error: extractErrorMessage(body) || `HTTP ${res.status}`,
          errorKind: classifyHttpError(res.status, body),
          latencyMs: Date.now() - started
        };
      }
    } catch (e: any) {
      return { success: false, error: e.message || 'Connection failed', errorKind: classifyThrownError(e) };
    }

    // Endpoint without /models support — fall back to a tiny completion.
    try {
      const res = await fetch(`${targetBase}/chat/completions`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          success: false,
          error: extractErrorMessage(body) || `HTTP ${res.status}`,
          errorKind: classifyHttpError(res.status, body),
          latencyMs: Date.now() - started
        };
      }
      return { success: true, latencyMs: Date.now() - started, modelCount: 0 };
    } catch (e: any) {
      return { success: false, error: e.message || 'Connection failed', errorKind: classifyThrownError(e) };
    }
  }

  /**
   * One minimal completion. Only reached when the provider's model list is
   * public, where it is the only way to tell a working key from a typo.
   */
  private async probeKey(
    targetBase: string,
    apiKey: string,
    model?: string
  ): Promise<{ ok: true } | { ok: false; success: false; error: string; errorKind: any }> {
    try {
      const res = await fetch(`${targetBase}/chat/completions`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model: model || 'deepseek-chat',
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
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this.headers(this.apiKey, req.sessionId);

    const formattedMessages = req.messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) }
          }))
        };
      }
      // Vision input (spec §52): OpenAI-compatible APIs take a content array
      // where each image is a data URL. Only user turns can carry images.
      if (m.role === 'user' && m.images && m.images.length > 0) {
        return {
          role: 'user',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.data}` }
            }))
          ]
        };
      }
      return { role: m.role, content: m.content };
    });

    const body: Record<string, any> = {
      model: req.model,
      messages: formattedMessages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }

    if (req.temperature !== undefined) body.temperature = req.temperature;

    if (req.reasoningEffort && req.reasoningEffort !== 'off' && req.reasoningEffort !== 'auto') {
      body.reasoning_effort = req.reasoningEffort;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      const err: any = new Error(extractErrorMessage(errText) || `HTTP ${response.status}`);
      err.errorKind = classifyHttpError(response.status, errText);
      err.status = response.status;
      throw err;
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const toolCallsMap: Record<number, { id: string; name: string; argsText: string }> = {};
    const emittedToolCallIndexes = new Set<number>();

    const emitToolCalls = (finishReason?: string) => {
      const assembled: ToolCall[] = [];
      for (const key of Object.keys(toolCallsMap)) {
        const index = Number(key);
        if (emittedToolCallIndexes.has(index)) continue;
        const item = toolCallsMap[index];
        if (!item.name) continue;
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = item.argsText ? JSON.parse(item.argsText) : {};
        } catch {
          parsedArgs = { raw: item.argsText };
        }
        assembled.push({ id: item.id, name: item.name, args: parsedArgs });
        emittedToolCallIndexes.add(index);
      }
      if (assembled.length > 0) {
        onChunk({ toolCalls: assembled, finishReason: finishReason || 'tool_calls' });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6);
        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (data.usage) {
          // OpenAI/OpenRouter report cached prompt tokens under prompt_tokens_details;
          // DeepSeek reports prompt_cache_hit_tokens.
          const cached =
            data.usage.prompt_tokens_details?.cached_tokens ??
            data.usage.prompt_cache_hit_tokens ??
            data.usage.cache_read_input_tokens ??
            undefined;
          const reasoning = data.usage.completion_tokens_details?.reasoning_tokens ?? undefined;
          onChunk({
            usage: {
              promptTokens: data.usage.prompt_tokens ?? 0,
              completionTokens: data.usage.completion_tokens ?? 0,
              totalTokens: data.usage.total_tokens ?? 0,
              cachedPromptTokens: cached,
              reasoningTokens: reasoning
            }
          });
        }

        const choice = data.choices?.[0];
        if (!choice) continue;

        if (data.error) {
          const err: any = new Error(extractErrorMessage(JSON.stringify({ error: data.error })));
          err.errorKind = 'bad_request';
          throw err;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) onChunk({ content: delta.content });
        if (delta.reasoning_content) onChunk({ reasoningContent: delta.reasoning_content });
        if (delta.reasoning) onChunk({ reasoningContent: delta.reasoning });

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallsMap[index]) {
              toolCallsMap[index] = {
                id: tc.id || `call_${Date.now()}_${index}`,
                name: '',
                argsText: ''
              };
            }
            if (tc.function?.name) toolCallsMap[index].name = tc.function.name;
            if (tc.function?.arguments) toolCallsMap[index].argsText += tc.function.arguments;
          }
        }

        if (choice.finish_reason) {
          emitToolCalls(choice.finish_reason);
        }
      }
    }

    // Streams that end without an explicit finish_reason still need their tool calls.
    emitToolCalls();
  }
}
