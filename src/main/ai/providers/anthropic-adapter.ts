import { IAIProvider, ProviderChatRequest, StreamChunk } from './provider-interface';
import { ToolCall } from '../../../shared/types';

export class AnthropicProvider implements IAIProvider {
  id = 'anthropic';
  name = 'Anthropic';
  baseUrl = 'https://api.anthropic.com/v1';
  apiKey = '';

  constructor(apiKey = '') {
    this.apiKey = apiKey;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async testConnection(apiKey = this.apiKey, _baseUrl = this.baseUrl, model = 'claude-3-5-haiku-20241022'): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${this.baseUrl}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5
        })
      });
      if (!res.ok) {
        const txt = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${txt}` };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Anthropic connection failed' };
    }
  }

  async streamChat(req: ProviderChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const url = `${this.baseUrl}/messages`;
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
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args
            });
          }
          return { role: 'assistant', content: contentBlocks };
        }
        return { role: m.role, content: m.content };
      });

    const body: any = {
      model: req.model || 'claude-3-7-sonnet-20250219',
      messages,
      max_tokens: 4096,
      stream: true
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: req.signal
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Anthropic Error (${response.status}): ${txt}`);
    }

    if (!response.body) throw new Error('Response body empty');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';

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

          if (data.type === 'content_block_start') {
            if (data.content_block?.type === 'tool_use') {
              currentToolId = data.content_block.id;
              currentToolName = data.content_block.name;
              currentToolArgs = '';
            }
          } else if (data.type === 'content_block_delta') {
            if (data.delta?.type === 'text_delta') {
              onChunk({ content: data.delta.text });
            } else if (data.delta?.type === 'input_json_delta') {
              currentToolArgs += data.delta.partial_json;
            }
          } else if (data.type === 'content_block_stop') {
            if (currentToolId) {
              let parsed = {};
              try {
                parsed = JSON.parse(currentToolArgs);
              } catch {}
              onChunk({
                toolCalls: [{ id: currentToolId, name: currentToolName, args: parsed }],
                finishReason: 'tool_calls'
              });
              currentToolId = '';
            }
          }
        } catch {}
      }
    }
  }
}
