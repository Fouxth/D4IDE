import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsesProvider } from '../src/main/ai/providers/responses-adapter';
import { StreamChunk } from '../src/main/ai/providers/provider-interface';
import { ChatMessage } from '../src/shared/types';

/**
 * The Responses API is a different wire protocol, and every part of the mapping
 * is something the gateway rejected when we got it wrong:
 *   - `input` takes typed items, not a message list
 *   - tools are flat (`name`/`parameters` at the top level, not under `function`)
 *   - a tool result is a `function_call_output` addressed by `call_id`, and the
 *     gateway answers 400 "No tool call found for function call output" if the
 *     matching `function_call` item is not in the same request
 *
 * These tests pin that translation with recorded event sequences.
 */

const encoder = new TextEncoder();

const sse = (events: unknown[], status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          const type = (event as any).type;
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      }
    }),
    { status, headers: { 'content-type': 'text/event-stream' } }
  );

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content, timestamp: 0 });
const system = (content: string): ChatMessage => ({ id: 's1', role: 'system', content, timestamp: 0 });

const collect = async (provider: ResponsesProvider, messages: ChatMessage[], tools?: any[]) => {
  const chunks: StreamChunk[] = [];
  await provider.streamChat({ model: 'gpt-5.6-luna', messages, tools }, (chunk) => chunks.push(chunk));
  return chunks;
};

const lastRequest = (fetchMock: any): any => JSON.parse(fetchMock.mock.calls.at(-1)[1].body);

describe('ResponsesProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams text deltas and reports usage', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: 'response.created' },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message' } },
        { type: 'response.output_text.delta', delta: 'OK' },
        { type: 'response.output_text.delta', delta: '!' },
        { type: 'response.output_item.done', item: { id: 'msg_1', type: 'message' } },
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 11,
              output_tokens: 5,
              total_tokens: 16,
              input_tokens_details: { cached_tokens: 7 },
              output_tokens_details: { reasoning_tokens: 2 }
            }
          }
        }
      ])
    );

    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });
    const chunks = await collect(provider, [system('Be terse.'), user('Say OK')]);

    expect(chunks.map((c) => c.content).join('')).toBe('OK!');
    expect(chunks.at(-1)?.usage).toEqual({
      promptTokens: 11,
      completionTokens: 5,
      totalTokens: 16,
      cachedPromptTokens: 7,
      reasoningTokens: 2
    });

    const body = lastRequest(fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/v1/responses');
    expect(body.instructions).toBe('Be terse.');
    expect(body.input).toEqual([{ role: 'user', content: 'Say OK' }]);
    expect(body.store).toBe(false);
  });

  it('sends tools in the flat shape the Responses API expects', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ type: 'response.completed', response: {} }]));
    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });

    await collect(provider, [user('read a file')], [
      { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } }
    ]);

    expect(lastRequest(fetchMock).tools).toEqual([
      { type: 'function', name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } }
    ]);
  });

  it('assembles a tool call from its argument deltas', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { id: 'fc_item_1', type: 'function_call', call_id: 'call_abc', name: 'read_file', arguments: '' }
        },
        { type: 'response.function_call_arguments.delta', delta: '{"pa' },
        { type: 'response.function_call_arguments.delta', delta: 'th":"src' },
        { type: 'response.function_call_arguments.delta', delta: '/index.ts"}' },
        { type: 'response.function_call_arguments.done', item_id: 'fc_item_1', arguments: '{"path":"src/index.ts"}' },
        { type: 'response.output_item.done', item: { id: 'fc_item_1', type: 'function_call' } },
        { type: 'response.completed', response: {} }
      ])
    );

    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });
    const chunks = await collect(provider, [user('read src/index.ts')]);

    const toolChunk = chunks.find((c) => c.toolCalls);
    expect(toolChunk?.toolCalls).toEqual([{ id: 'call_abc', name: 'read_file', args: { path: 'src/index.ts' } }]);
    expect(toolChunk?.finishReason).toBe('tool_calls');
  });

  it('replays a tool call and its result as items, in that order', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { id: 'fc_item_1', type: 'function_call', call_id: 'call_abc', name: 'read_file', arguments: '{}' }
        },
        { type: 'response.function_call_arguments.done', item_id: 'fc_item_1', arguments: '{"path":"a.ts"}' },
        { type: 'response.completed', response: {} }
      ])
    );
    fetchMock.mockResolvedValueOnce(sse([{ type: 'response.completed', response: {} }]));

    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });
    await collect(provider, [user('read a.ts')]);
    await collect(provider, [
      user('read a.ts'),
      { id: 'a1', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 'call_abc', name: 'read_file', args: { path: 'a.ts' } }] },
      { id: 't1', role: 'tool', content: 'file contents', toolCallId: 'call_abc', name: 'read_file', timestamp: 0 }
    ]);

    const input = lastRequest(fetchMock).input;
    expect(input[1]).toMatchObject({
      type: 'function_call',
      id: 'fc_item_1',
      call_id: 'call_abc',
      name: 'read_file',
      arguments: '{"path":"a.ts"}'
    });
    expect(input[2]).toEqual({ type: 'function_call_output', call_id: 'call_abc', output: 'file contents' });
  });

  it('omits the item id rather than inventing one for an unknown call', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ type: 'response.completed', response: {} }]));
    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });

    await collect(provider, [
      user('read a.ts'),
      { id: 'a1', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 'call_unknown', name: 'read_file', args: {} }] },
      { id: 't1', role: 'tool', content: 'contents', toolCallId: 'call_unknown', timestamp: 0 }
    ]);

    const [, call, output] = lastRequest(fetchMock).input;
    expect(call).toEqual({ type: 'function_call', call_id: 'call_unknown', name: 'read_file', arguments: '{}' });
    expect(output.type).toBe('function_call_output');
  });

  it('maps images to input_image parts and carries the session id', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ type: 'response.completed', response: {} }]));
    const provider = new ResponsesProvider({
      id: 'opencode-go-responses',
      name: 'Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'k'
    });

    const chunks: StreamChunk[] = [];
    await provider.streamChat(
      {
        model: 'gpt-5.6-luna',
        sessionId: 'session-42',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'what is this?',
            timestamp: 0,
            images: [{ mimeType: 'image/png', data: 'AAAA' }]
          }
        ]
      },
      (chunk) => chunks.push(chunk)
    );

    expect(lastRequest(fetchMock).input[0].content).toEqual([
      { type: 'input_text', text: 'what is this?' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
    ]);

    // A gateway that routes per session needs the conversation id; the header
    // helper only adds it for hosts that understand it.
    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    const sessionHeader = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-opencode-session');
    expect(sessionHeader?.[1]).toBe('session-42');
    const agent = Object.entries(headers).find(([name]) => name.toLowerCase() === 'user-agent');
    expect(agent?.[1]).toMatch(/^D4IDE\//);
  });

  it('surfaces a stream error as a provider error instead of a silent empty reply', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([{ type: 'response.failed', response: { error: { message: 'upstream exploded' } } }])
    );
    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'k' });

    await expect(collect(provider, [user('hi')])).rejects.toThrow(/upstream exploded/);
  });

  it('reports an HTTP failure with its classified kind', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const provider = new ResponsesProvider({ id: 'go', name: 'Go', baseUrl: 'https://gateway.test/v1', apiKey: 'bad' });

    await expect(collect(provider, [user('hi')])).rejects.toMatchObject({ errorKind: 'invalid_key', status: 401 });
  });
});
