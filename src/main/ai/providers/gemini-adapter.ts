import { IAIProvider, ProviderChatRequest, StreamChunk } from './provider-interface';
import { ToolCall } from '../../../shared/types';

export class GeminiProvider implements IAIProvider {
  id = 'gemini';
  name = 'Google Gemini';
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  apiKey = '';

  constructor(apiKey = '') {
    this.apiKey = apiKey;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async testConnection(apiKey = this.apiKey, _baseUrl = this.baseUrl, model = 'gemini-2.5-flash'): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Ping' }] }]
        })
      });
      if (!res.ok) {
        const txt = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${txt}` };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Gemini connection failed' };
    }
  }

  async streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const model = req.model || 'gemini-2.5-flash';
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    // Format contents
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
            parts: m.toolCalls.map((tc) => ({
              functionCall: { name: tc.name, args: tc.args }
            }))
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        };
      });

    const systemInstruction = req.messages.find((m) => m.role === 'system');

    const body: any = {
      contents
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction.content }]
      };
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

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Gemini Error (${response.status}): ${txt}`);
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
        const jsonStr = trimmed.slice(6);
        try {
          const data = JSON.parse(jsonStr);
          const candidate = data.candidates?.[0];
          if (!candidate) continue;

          const parts = candidate.content?.parts || [];
          const toolCalls: ToolCall[] = [];

          for (const part of parts) {
            if (part.text) {
              onChunk({ content: part.text });
            }
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

          if (data.usageMetadata) {
            onChunk({
              usage: {
                promptTokens: data.usageMetadata.promptTokenCount || 0,
                completionTokens: data.usageMetadata.candidatesTokenCount || 0,
                totalTokens: data.usageMetadata.totalTokenCount || 0
              }
            });
          }
        } catch {}
      }
    }
  }
}
