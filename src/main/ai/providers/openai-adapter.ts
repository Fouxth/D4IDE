import { IAIProvider, ProviderChatRequest, StreamChunk } from './provider-interface';
import { ToolCall } from '../../../shared/types';

export class OpenAICompatibleProvider implements IAIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;

  constructor(id: string, name: string, baseUrl: string, apiKey = '') {
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  async testConnection(apiKey = this.apiKey, baseUrl = this.baseUrl, model = 'deepseek-chat'): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${errorText}` };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Connection failed' };
    }
  }

  async streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Convert messages
    const formattedMessages = req.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          }))
        };
      }
      return {
        role: m.role,
        content: m.content
      };
    });

    const body: any = {
      model: req.model,
      messages: formattedMessages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

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
      let parsedMsg = errText;
      try {
        const json = JSON.parse(errText);
        parsedMsg = json.error?.message || json.message || errText;
      } catch {}
      throw new Error(`Provider API Error (${response.status}): ${parsedMsg}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Active tool calls accumulator
    const toolCallsMap: Record<number, { id: string; name: string; argsText: string }> = {};

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

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);

            if (data.usage) {
              onChunk({
                usage: {
                  promptTokens: data.usage.prompt_tokens,
                  completionTokens: data.usage.completion_tokens,
                  totalTokens: data.usage.total_tokens
                }
              });
            }

            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (!delta) continue;

            // Content delta
            if (delta.content) {
              onChunk({ content: delta.content });
            }

            // Reasoning content delta (DeepSeek / Qwen)
            if (delta.reasoning_content) {
              onChunk({ reasoningContent: delta.reasoning_content });
            }

            // Tool calls delta
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!toolCallsMap[index]) {
                  toolCallsMap[index] = {
                    id: tc.id || `call_${Date.now()}_${index}`,
                    name: tc.function?.name || '',
                    argsText: ''
                  };
                }
                if (tc.function?.name) {
                  toolCallsMap[index].name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCallsMap[index].argsText += tc.function.arguments;
                }
              }
            }

            // If finished, emit assembled tool calls
            if (choice.finish_reason === 'tool_calls' || (choice.finish_reason && Object.keys(toolCallsMap).length > 0)) {
              const assembled: ToolCall[] = [];
              for (const key of Object.keys(toolCallsMap)) {
                const item = toolCallsMap[Number(key)];
                let parsedArgs = {};
                try {
                  parsedArgs = item.argsText ? JSON.parse(item.argsText) : {};
                } catch {
                  parsedArgs = { raw: item.argsText };
                }
                assembled.push({
                  id: item.id,
                  name: item.name,
                  args: parsedArgs
                });
              }
              onChunk({ toolCalls: assembled, finishReason: choice.finish_reason });
            }
          } catch {
            // Incomplete JSON in chunk, continue
          }
        }
      }
    }
  }
}
