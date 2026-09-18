import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../src/shared/types';
import { compressForBudget, estimateTokens } from '../src/main/ai/agent/token-discipline';

/**
 * Where a long run's money actually goes.
 *
 * Measured from the app's own database: one build session sent 7.8M input tokens
 * across 80 calls, with the last forty calls each resending ~150K. The weight was
 * not the conversation as such — it was the *files the agent had already
 * written*, carried in assistant tool-call arguments and never touched by the
 * older message-count trimmer. These pin the compression that removes it.
 */
const assistantWriting = (id: string, body: string, path = 'src/app/page.tsx'): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  toolCalls: [{ id: `c_${id}`, name: 'create_file', args: { path, content: body } }],
  timestamp: Date.now()
});

const toolResult = (id: string, content: string): ChatMessage => ({
  id,
  role: 'tool',
  content,
  toolCallId: `c_${id}`,
  name: 'create_file',
  timestamp: Date.now()
});

const system = (text: string): ChatMessage => ({ id: 'sys', role: 'system', content: text, timestamp: Date.now() });

describe('token budgeting', () => {
  it('counts non-ASCII text at a higher rate than Latin', () => {
    const latin = 'the quick brown fox jumps over the lazy dog';
    const thai = 'ระบบจัดการค่าเช่าและใบแจ้งหนี้สำหรับผู้ให้เช่า';
    expect(estimateTokens(thai)).toBeGreaterThan(estimateTokens(latin) / 2);
    expect(estimateTokens('')).toBe(0);
  });

  it('replaces file-sized tool arguments in older turns with a size marker', () => {
    const big = 'x'.repeat(40_000);
    const messages = [
      system('sys'),
      assistantWriting('1', big),
      toolResult('1', 'ok'),
      { id: 'u2', role: 'user', content: 'continue', timestamp: Date.now() } as ChatMessage,
      assistantWriting('2', 'recent body', 'src/recent.tsx')
    ];

    const before = messages[1].toolCalls![0].args.content as string;
    const result = compressForBudget(messages, { maxTokens: 200_000, keepRecent: 2 });

    const after = result.messages[1].toolCalls![0].args.content as string;
    expect(before).toHaveLength(40_000);
    expect(after.length).toBeLessThan(1_000);
    expect(after).toContain('not repeated here to save tokens');
    expect(result.argumentCharsSaved).toBeGreaterThan(39_000);
    // The path survives: the model still knows what it wrote and where.
    expect(result.messages[1].toolCalls![0].args.path).toBe('src/app/page.tsx');
  });

  it('leaves recent turns untouched, so the model keeps what it is working on', () => {
    const big = 'y'.repeat(20_000);
    const messages = [system('sys'), assistantWriting('1', big)];
    const result = compressForBudget(messages, { maxTokens: 100_000, keepRecent: 4 });
    expect(result.messages[1].toolCalls![0].args.content).toBe(big);
    expect(result.argumentCharsSaved).toBe(0);
  });

  it('shortens old tool results but never the newest ones', () => {
    const long = 'z'.repeat(9_000);
    const messages = [
      system('sys'),
      toolResult('1', long),
      { id: 'a', role: 'assistant', content: 'thinking', timestamp: Date.now() } as ChatMessage,
      { id: 'u', role: 'user', content: 'go on', timestamp: Date.now() } as ChatMessage,
      toolResult('2', long)
    ];
    const result = compressForBudget(messages, { maxTokens: 100_000, maxToolChars: 500, keepRecent: 2 });
    expect((result.messages[1].content as string).length).toBeLessThan(1_000);
    expect((result.messages[4].content as string).length).toBe(9_000);
    expect(result.truncated).toBe(1);
  });

  it('drops the oldest exchanges when the prompt is still over budget', () => {
    const filler = 'q'.repeat(2_000);
    const messages: ChatMessage[] = [system('sys')];
    for (let i = 0; i < 12; i += 1) {
      messages.push({ id: `m${i}`, role: 'user', content: `${filler}${i}`, timestamp: Date.now() });
      messages.push({ id: `a${i}`, role: 'assistant', content: `${filler}${i}`, timestamp: Date.now() });
    }

    const result = compressForBudget(messages, { maxTokens: 3_000, keepRecent: 2 });
    expect(result.dropped).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    // The system prompt never goes: it holds the rules and the project memory.
    expect(result.messages[0].id).toBe('sys');
  });

  it('never leaves a tool result without the call that produced it', () => {
    const filler = 'w'.repeat(1_500);
    const messages: ChatMessage[] = [system('sys'), { id: 'u0', role: 'user', content: filler, timestamp: Date.now() }];
    for (let i = 0; i < 8; i += 1) {
      messages.push(assistantWriting(`w${i}`, `${filler}${i}`, `src/file${i}.ts`));
      messages.push(toolResult(`w${i}`, `${filler}${i}`));
    }

    const result = compressForBudget(messages, { maxTokens: 4_000, keepRecent: 2 });
    let firstToolCallIndex = -1;
    result.messages.forEach((message, index) => {
      if (message.role === 'assistant' && message.toolCalls?.length && firstToolCallIndex < 0) {
        firstToolCallIndex = index;
      }
    });
    // The first non-system message must not be a tool result: providers reject a
    // request whose window opens with a result and no call.
    expect(result.messages[1].role).not.toBe('tool');
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0);
  });

  it('reports how much it saved, for the meter the user can see', () => {
    const messages = [system('sys'), assistantWriting('1', 'k'.repeat(30_000))];
    const result = compressForBudget(messages, { maxTokens: 200_000, keepRecent: 1 });
    // keepRecent 1 leaves the writing message recent, so nothing is stripped —
    // the meter must not claim savings that did not happen.
    expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    expect(result.argumentCharsSaved).toBe(0);

    // keepRecent is clamped to at least 2 — the last exchange always stays
    // intact — so the old write has to be genuinely further back than that.
    const older = [
      system('sys'),
      assistantWriting('1', 'k'.repeat(30_000)),
      toolResult('1', 'ok'),
      assistantWriting('2', 'tail')
    ];
    const compressed = compressForBudget(older, { maxTokens: 200_000, keepRecent: 2 });
    expect(compressed.argumentCharsSaved).toBeGreaterThan(29_000);
    expect(compressed.tokensAfter).toBeLessThan(compressed.tokensBefore);
  });
});
