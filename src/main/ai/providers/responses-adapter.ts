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

interface ResponsesProviderOptions {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelsPath?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * OpenAI's Responses API (`POST /responses`).
 *
 * A third wire protocol, not a variant of chat-completions: the request takes an
 * item list instead of a message list, function calls are typed items rather
 * than `tool_calls` deltas, and the tool schema is flat. Gateways expose the
 * newest families only here — on OpenCode's Zen and Go gateways every GPT and
 * Grok model answers on `/responses` and nowhere else (verified live against
 * `https://opencode.ai/zen/go/v1`), which is why a provider entry needs to know
 * which protocol it speaks.
 *
 * The mapping between D4IDE's message shape and the item list is:
 *   system      → `instructions` (the field the API has for it)
 *   user        → `{ role: 'user', content }`
 *   assistant   → `{ role: 'assistant', content }` + one `function_call` item per call
 *   tool result → `{ type: 'function_call_output', call_id, output }`
 *
 * Order matters: an `function_call_output` must follow the `function_call` it
 * answers, and the API rejects it outright ("No tool call found for function
 * call output") when the call item is missing.
 */
export class ResponsesProvider implements IAIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelsPath: string;
  extraHeaders: Record<string, string>;

  /**
   * `call_id` → output-item id, per provider instance.
   *
   * A Responses tool result is addressed by `call_id`, but replaying the
   * assistant's call on the next turn wants the item id it was created with, and
   * the stream is where we see it. The instance lives as long as the provider
   * config does, so the mapping survives across turns of a conversation.
   */
  private itemIdsByCallId = new Map<string, string>();

  constructor(options: ResponsesProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey || '';
    this.modelsPath = options.modelsPath || '/models';
    this.extraHeaders = options.extraHeaders || {};
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
      ...buildIdentityHeaders(this.baseUrl, sessionId),
      ...this.extraHeaders
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
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
      .map((m: any) => (typeof m === 'string' ? m : m.id || m.name))
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      .map(
        (id: string): ModelInfo => ({
          id,
          name: id,
          providerId: this.id,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: /(gpt-5|gpt-6|grok-|o[1-9])/i.test(id),
          contextWindow: undefined,
          source: 'fetched'
        })
      );
  }

  async testConnection(apiKey = this.apiKey, baseUrl?: string, model?: string): Promise<ProviderTestResult> {
    const started = Date.now();
    const targetBase = (baseUrl || this.baseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${targetBase}${this.modelsPath}`, { headers: this.headers(apiKey) });
      if (!res.ok && res.status !== 404 && res.status !== 405) {
        const body = await res.text();
        return {
          success: false,
          error: extractErrorMessage(body) || `HTTP ${res.status}`,
          errorKind: classifyHttpError(res.status, body),
          latencyMs: Date.now() - started
        };
      }

      const count = res.ok
        ? await res.json().then((data: any) =>
            Array.isArray(data?.data) ? data.data.length : Array.isArray(data?.models) ? data.models.length : 0
          )
        : 0;

      // A gateway that lists models to anonymous callers has not checked the key
      // at all, so a green tick there would mean nothing. Spend one minimal
      // request to find out whether the key is real.
      const keyCheck = await verifyKeyIfModelsArePublic({
        modelsUrl: `${targetBase}${this.modelsPath}`,
        headers: this.headers(apiKey)
      });
      if (keyCheck.keyProvided && keyCheck.modelsArePublic) {
        const probe = await this.probeKey(targetBase, apiKey, model);
        if (!probe.ok) return { ...probe, latencyMs: Date.now() - started };
      }

      return { success: true, latencyMs: Date.now() - started, modelCount: count };
    } catch (e: any) {
      return { success: false, error: e.message || 'Connection failed', errorKind: classifyThrownError(e) };
    }
  }

  /** One tiny completion, used only to confirm a key the models list cannot vouch for. */
  private async probeKey(
    targetBase: string,
    apiKey: string,
    model?: string
  ): Promise<{ ok: true } | { ok: false; success: false; error: string; errorKind: any }> {
    try {
      const res = await fetch(`${targetBase}/responses`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model: model || 'gpt-5.6-luna',
          input: [{ role: 'user', content: 'ping' }],
          max_output_tokens: 16,
          store: false
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
    const url = `${this.baseUrl}/responses`;
    const headers = this.headers(this.apiKey, req.sessionId);
    const { instructions, input } = this.buildInput(req.messages);

    const body: Record<string, any> = {
      model: req.model,
      input,
      stream: true,
      // Coding-agent traffic: the server keeping a copy of every conversation is
      // not something to opt a user into silently.
      store: false
    };
    if (instructions) body.instructions = instructions;

    if (req.tools && req.tools.length > 0) {
      // The Responses tool schema is flat — name/description/parameters at the
      // top level, unlike chat-completions where they nest under `function`.
      body.tools = req.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
    }

    if (req.reasoningEffort && req.reasoningEffort !== 'off' && req.reasoningEffort !== 'auto') {
      body.reasoning = { effort: req.reasoningEffort };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });

    if (!response.ok) {
      const errText = await response.text();
      const err: any = new Error(extractErrorMessage(errText) || `HTTP ${response.status}`);
      err.errorKind = classifyHttpError(response.status, errText);
      err.status = response.status;
      throw err;
    }
    if (!response.body) throw new Error('Response body is empty');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let pendingCall: { callId: string; itemId: string; name: string; argsText: string } | null = null;
    const emitted = new Set<string>();

    const emitToolCall = (finishReason?: string) => {
      if (!pendingCall || !pendingCall.name || emitted.has(pendingCall.callId)) return;
      let args: Record<string, any> = {};
      try {
        args = pendingCall.argsText ? JSON.parse(pendingCall.argsText) : {};
      } catch {
        args = { raw: pendingCall.argsText };
      }
      emitted.add(pendingCall.callId);
      if (pendingCall.itemId) this.itemIdsByCallId.set(pendingCall.callId, pendingCall.itemId);
      onChunk({
        toolCalls: [{ id: pendingCall.callId, name: pendingCall.name, args }],
        finishReason: finishReason || 'tool_calls'
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
        if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        switch (event.type) {
          case 'response.output_item.added': {
            const item = event.item;
            if (item?.type === 'function_call') {
              const callId = item.call_id || item.id;
              pendingCall = { callId, itemId: item.id || '', name: item.name || '', argsText: item.arguments || '' };
            }
            break;
          }

          case 'response.function_call_arguments.delta':
            if (pendingCall) pendingCall.argsText += event.delta || '';
            break;

          case 'response.function_call_arguments.done':
            if (pendingCall) {
              if (event.arguments) pendingCall.argsText = event.arguments;
              if (event.item_id) pendingCall.itemId = event.item_id;
              emitToolCall();
            }
            break;

          case 'response.output_text.delta':
            if (event.delta) onChunk({ content: event.delta });
            break;

          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning_text.delta':
            if (event.delta) onChunk({ reasoningContent: event.delta });
            break;

          case 'response.completed': {
            emitToolCall();
            const usage = event.response?.usage;
            if (usage) {
              onChunk({
                usage: {
                  promptTokens: usage.input_tokens ?? 0,
                  completionTokens: usage.output_tokens ?? 0,
                  totalTokens: usage.total_tokens ?? 0,
                  cachedPromptTokens: usage.input_tokens_details?.cached_tokens ?? undefined,
                  reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? undefined
                }
              });
            }
            break;
          }

          case 'response.failed':
          case 'response.incomplete': {
            const err: any = new Error(
              event.response?.error?.message || `The provider stopped this response (${event.type}).`
            );
            err.errorKind = classifyHttpError(500, JSON.stringify(event.response?.error || {}));
            throw err;
          }

          case 'error': {
            const err: any = new Error(event.message || event.error?.message || 'Provider stream error');
            err.errorKind = classifyHttpError(400, JSON.stringify(event));
            throw err;
          }
        }
      }
    }

    emitToolCall();
  }

  /** Translates the conversation into the item list `/responses` expects. */
  private buildInput(messages: ProviderChatRequest['messages']): { instructions: string; input: any[] } {
    const systemParts: string[] = [];
    const input: any[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        if (m.content) systemParts.push(m.content);
        continue;
      }

      if (m.role === 'tool') {
        // Every call we ever made is known here; a call id with no remembered
        // item id still works, the gateway matches on `call_id`.
        input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content || '' });
        continue;
      }

      if (m.role === 'assistant') {
        if (m.content) input.push({ role: 'assistant', content: m.content });
        for (const tc of m.toolCalls || []) {
          const knownId = this.itemIdsByCallId.get(tc.id);
          input.push({
            type: 'function_call',
            ...(knownId ? { id: knownId } : {}),
            call_id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.args ?? {})
          });
        }
        continue;
      }

      // Vision input (spec §52): the Responses API names the text/image parts
      // `input_text` / `input_image` rather than chat-completions' `text` /
      // `image_url`.
      if (m.images && m.images.length > 0) {
        input.push({
          role: 'user',
          content: [
            ...(m.content ? [{ type: 'input_text', text: m.content }] : []),
            ...m.images.map((image) => ({
              type: 'input_image',
              image_url: `data:${image.mimeType};base64,${image.data}`
            }))
          ]
        });
        continue;
      }

      input.push({ role: 'user', content: m.content || '' });
    }

    return { instructions: systemParts.join('\n\n'), input };
  }
}
