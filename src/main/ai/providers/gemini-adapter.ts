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

const THINKING_BUDGETS: Record<string, number> = {
  low: 1024,
  medium: 8192,
  high: 24576
};

export class GeminiProvider implements IAIProvider {
  id = 'gemini';
  name = 'Google Gemini';
  baseUrl: string;
  apiKey: string;

  constructor(apiKey = '', baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  /**
   * The key travels in `x-goog-api-key`, never in the query string.
   *
   * Google accepts both, but keys in URLs leak — into proxy logs, shell
   * history, crash reports. And gateways that resell Gemini over the same wire
   * shape (OpenCode Zen) only accept the header: sending `?key=` there answers
   * "Missing API key" even when the key is valid (verified live).
   */
  private headers(apiKey = this.apiKey, sessionId?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      ...buildIdentityHeaders(this.baseUrl, sessionId)
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      const err: any = new Error(extractErrorMessage(body) || `HTTP ${res.status}`);
      err.errorKind = classifyHttpError(res.status, body);
      throw err;
    }
    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.models) ? data.models : [];
    return list
      .filter((m) => {
        const methods: string[] = m.supportedGenerationMethods || [];
        return methods.length === 0 || methods.includes('generateContent');
      })
      .map((m): ModelInfo => {
        const id = String(m.name || '').replace(/^models\//, '');
        return {
          id,
          name: m.displayName || id,
          providerId: this.id,
          supportsTools: true,
          supportsVision: true,
          supportsReasoning: /2\.5|thinking/i.test(id),
          supportsCaching: true,
          contextWindow: m.inputTokenLimit || undefined,
          maxOutputTokens: m.outputTokenLimit || undefined,
          source: 'fetched'
        };
      })
      .filter((m) => !!m.id);
  }

  async testConnection(apiKey = this.apiKey, baseUrl?: string, _model?: string): Promise<ProviderTestResult> {
    const started = Date.now();
    const targetBase = (baseUrl || this.baseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${targetBase}/models?pageSize=1`, { headers: this.headers(apiKey) });
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
      return {
        success: true,
        latencyMs: Date.now() - started,
        modelCount: Array.isArray(data?.models) ? data.models.length : 0
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Gemini connection failed', errorKind: classifyThrownError(e) };
    }
  }

  async streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const model = req.model;
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'function',
            parts: [{ functionResponse: { name: m.name || 'tool', response: { result: m.content } } }]
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'model',
            parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } }))
          };
        }
        // Vision input (spec §52): Gemini takes inlineData parts alongside text.
        if (m.role === 'user' && m.images && m.images.length > 0) {
          return {
            role: 'user',
            parts: [
              ...(m.content ? [{ text: m.content }] : []),
              ...m.images.map((image) => ({
                inlineData: { mimeType: image.mimeType, data: image.data }
              }))
            ]
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        };
      });

    const systemInstruction = req.messages.find((m) => m.role === 'system');

    const body: Record<string, any> = { contents };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ];
    }

    const thinkingBudget =
      req.reasoningEffort && req.reasoningEffort !== 'off' && req.reasoningEffort !== 'auto'
        ? THINKING_BUDGETS[req.reasoningEffort]
        : undefined;
    if (thinkingBudget) {
      body.generationConfig = { thinkingConfig: { thinkingBudget } };
    } else if (req.temperature !== undefined) {
      body.generationConfig = { temperature: req.temperature };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(this.apiKey, req.sessionId),
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

        const candidate = data.candidates?.[0];
        if (candidate) {
          const parts = candidate.content?.parts || [];
          const toolCalls: ToolCall[] = [];

          for (const part of parts) {
            if (part.text) onChunk({ content: part.text });
            if (part.thought) onChunk({ reasoningContent: part.text || '' });
            if (part.functionCall) {
              toolCalls.push({
                id: `gemini_call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                name: part.functionCall.name,
                args: part.functionCall.args || {}
              });
            }
          }

          if (toolCalls.length > 0) {
            onChunk({ toolCalls, finishReason: 'tool_calls' });
          }

          if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            if (candidate.finishReason === 'MAX_TOKENS') {
              onChunk({ finishReason: 'length' });
            } else if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
              const err: any = new Error('Response blocked by Gemini safety filters.');
              err.errorKind = 'bad_request';
              throw err;
            }
          }
        }

        if (data.usageMetadata) {
          onChunk({
            usage: {
              promptTokens: data.usageMetadata.promptTokenCount || 0,
              completionTokens: data.usageMetadata.candidatesTokenCount || 0,
              totalTokens: data.usageMetadata.totalTokenCount || 0,
              cachedPromptTokens: data.usageMetadata.cachedContentTokenCount || undefined,
              reasoningTokens: data.usageMetadata.thoughtsTokenCount || undefined
            }
          });
        }
      }
    }
  }
}
