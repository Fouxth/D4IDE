import { describe, it, expect } from 'vitest';
import {
  MAX_IDENTICAL_CALLS,
  MAX_LEDGER_REUSES,
  REPEATABLE_TOOLS,
  RunLedger,
  loopNotice,
  repetitionNotice,
  reuseNotice,
  tokenDisciplineRules,
  toolSignature,
  trimConversation
} from '../src/main/ai/agent/token-discipline';
import { ChatMessage, ToolCall } from '../src/shared/types';

/**
 * The point of this module is not to ask the model to be frugal — it is to make
 * repetition impossible to pay for. So these tests check behaviour, not wording:
 * a second identical read must be free, a third identical write must be refused,
 * and any prompt that gets trimmed must still be a request a provider accepts.
 */
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `c_${name}`, name, args });

const message = (role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m_${Math.random().toString(36).slice(2)}`,
  role,
  content,
  timestamp: Date.now(),
  ...extra
});

describe('tool signatures', () => {
  it('treats the same call in a different key order as the same call', () => {
    expect(toolSignature(call('read_file', { path: 'a.ts', offset: 1 }))).toBe(
      toolSignature(call('read_file', { offset: 1, path: 'a.ts' }))
    );
  });

  it('separates calls that differ in arguments or tool', () => {
    expect(toolSignature(call('read_file', { path: 'a.ts' }))).not.toBe(toolSignature(call('read_file', { path: 'b.ts' })));
    expect(toolSignature(call('read_file', { path: 'a.ts' }))).not.toBe(toolSignature(call('grep', { path: 'a.ts' })));
  });

  it('tolerates a call with no arguments', () => {
    expect(toolSignature({ id: 'x', name: 'git_status' })).toBe('git_status()');
  });
});

describe('run ledger', () => {
  it('lets the first call through', () => {
    const ledger = new RunLedger();
    expect(ledger.inspect(call('read_file', { path: 'a.ts' }))).toEqual({ action: 'run', count: 1 });
  });

  it('answers a repeated read from memory instead of re-reading', () => {
    const ledger = new RunLedger();
    const read = call('read_file', { path: 'package.json' });
    ledger.inspect(read);
    ledger.remember(read, '{"name":"d4ide"}');

    const verdict = ledger.inspect(read);
    expect(verdict.action).toBe('reuse');
    expect(verdict.cached).toBe('{"name":"d4ide"}');
    expect(verdict.count).toBe(2);
  });

  it('does not reuse a read whose first run produced nothing', () => {
    const ledger = new RunLedger();
    const read = call('grep', { pattern: 'todo' });
    ledger.inspect(read);
    // No result recorded (the call failed): running it again is legitimate.
    expect(ledger.inspect(read).action).toBe('run');
  });

  it('refuses a write that keeps coming back', () => {
    const ledger = new RunLedger();
    const write = call('write_file', { path: 'a.ts', content: 'x' });
    expect(ledger.inspect(write).action).toBe('run');
    expect(ledger.inspect(write).action).toBe('run');
    expect(ledger.inspect(write).action).toBe('blocked');
    expect(ledger.count(toolSignature(write))).toBe(MAX_IDENTICAL_CALLS);
  });

  it('never caches a write result', () => {
    const ledger = new RunLedger();
    const write = call('write_file', { path: 'a.ts', content: 'x' });
    ledger.inspect(write);
    ledger.remember(write, 'written');
    // The second attempt still runs: a write is not idempotent from the model's
    // point of view, so a cached answer would be a lie.
    expect(ledger.inspect(write).action).toBe('run');
  });

  it('stops reusing a read that the model keeps asking for', () => {
    const ledger = new RunLedger();
    const read = call('read_file', { path: 'big.ts' });
    for (let i = 0; i < MAX_LEDGER_REUSES + 1; i++) ledger.inspect(read);
    ledger.remember(read, 'contents');
    expect(ledger.inspect(read).action).toBe('blocked');
  });

  it('forgets everything when a new run starts', () => {
    const ledger = new RunLedger();
    const read = call('read_file', { path: 'a.ts' });
    ledger.inspect(read);
    ledger.remember(read, 'x');
    ledger.reset();
    expect(ledger.inspect(read)).toEqual({ action: 'run', count: 1 });
  });

  it('knows which tools are safe to reuse', () => {
    expect(REPEATABLE_TOOLS.has('read_file')).toBe(true);
    expect(REPEATABLE_TOOLS.has('write_file')).toBe(false);
    expect(REPEATABLE_TOOLS.has('run_terminal')).toBe(false);
  });
});

describe('repeated answers', () => {
  it('flags the third identical answer in a row', () => {
    const ledger = new RunLedger();
    expect(ledger.isRepeatingText('Working on it now.')).toBe(false);
    expect(ledger.isRepeatingText('Working on it now.')).toBe(false);
    expect(ledger.isRepeatingText('Working   on it now.')).toBe(true);
  });

  it('does not flag a model that is moving on', () => {
    const ledger = new RunLedger();
    ledger.isRepeatingText('Step one done.');
    ledger.isRepeatingText('Step two done.');
    expect(ledger.isRepeatingText('Finishing up.')).toBe(false);
  });

  it('ignores empty answers', () => {
    const ledger = new RunLedger();
    expect(ledger.isRepeatingText('   ')).toBe(false);
  });
});

describe('prompt trimming', () => {
  const long = 'x'.repeat(9000);

  it('leaves a small conversation alone', () => {
    const messages = [message('system', 'sys'), message('user', 'hi'), message('assistant', 'hello')];
    const result = trimConversation(messages, { maxMessages: 40, maxToolChars: 4000 });
    expect(result.messages).toHaveLength(3);
    expect(result.dropped).toBe(0);
    expect(result.truncated).toBe(0);
  });

  it('shortens old tool output but keeps the recent one whole', () => {
    const messages = [
      message('system', 'sys'),
      message('tool', long, { toolCallId: 't1', name: 'read_file' }),
      message('assistant', 'a'),
      message('user', 'u'),
      message('assistant', 'b'),
      message('user', 'u2'),
      message('tool', long, { toolCallId: 't2', name: 'read_file' })
    ];
    const result = trimConversation(messages, { maxMessages: 40, maxToolChars: 1000, keepRecent: 2 });
    expect(result.truncated).toBe(1);
    expect(result.messages[1].content.length).toBeLessThan(1200);
    expect(result.messages[6].content).toBe(long);
    expect(result.messages[1].content).toContain('trimmed to save tokens');
  });

  it('keeps the system prompt and drops the oldest exchanges', () => {
    const messages: ChatMessage[] = [message('system', 'sys')];
    for (let i = 0; i < 30; i++) messages.push(message(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));

    const result = trimConversation(messages, { maxMessages: 10, maxToolChars: 1000 });
    expect(result.messages).toHaveLength(10);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages.at(-1)?.content).toBe('turn 29');
    expect(result.dropped).toBeGreaterThan(0);
  });

  it('never starts the window on a tool result', () => {
    // A tool message whose requesting assistant turn fell outside the window is
    // rejected by every provider, so the window moves forward past it.
    const messages: ChatMessage[] = [message('system', 'sys')];
    for (let i = 0; i < 12; i++) messages.push(message('user', `u${i}`));
    messages.push(message('assistant', 'call', { toolCalls: [call('read_file', { path: 'a.ts' })] }));
    messages.push(message('tool', 'result', { toolCallId: 'c_read_file', name: 'read_file' }));
    messages.push(message('assistant', 'done'));

    const result = trimConversation(messages, { maxMessages: 6, maxToolChars: 1000, keepRecent: 2 });
    expect(result.messages[1].role).not.toBe('tool');
    expect(result.messages[0].role).toBe('system');
  });

  it('never ends the window on an assistant turn whose tool results were cut', () => {
    const messages: ChatMessage[] = [message('system', 'sys')];
    for (let i = 0; i < 8; i++) messages.push(message('user', `u${i}`));
    messages.push(message('assistant', 'calling', { toolCalls: [call('write_file', { path: 'a.ts' })] }));
    messages.push(message('tool', 'written', { toolCallId: 'c_write_file', name: 'write_file' }));

    const result = trimConversation(messages, { maxMessages: 5, maxToolChars: 1000, keepRecent: 1 });
    const last = result.messages.at(-1);
    expect(last?.role === 'assistant' && (last.toolCalls?.length ?? 0) > 0).toBe(false);
  });
});

describe('stated rules', () => {
  it('spells out the required behaviours in both languages', () => {
    const english = tokenDisciplineRules('en');
    const thai = tokenDisciplineRules('th');

    for (const rules of [english, thai]) {
      expect(rules).toMatch(/loop|วน/);
      expect(rules).toMatch(/repeat|ซ้ำ/);
      expect(rules).toMatch(/token|โทเคน/);
      expect(rules.length).toBeGreaterThan(400);
    }
    expect(english).toContain('Think before acting');
    expect(thai).toContain('คิดก่อนทำ');
  });

  it('explains a reuse and a refusal in the user’s language', () => {
    expect(reuseNotice('en', 2)).toContain('Reused');
    expect(reuseNotice('th', 2)).toContain('ใช้ซ้ำ');
    expect(loopNotice('en', call('write_file'), 3)).toContain('Refused as a loop');
    expect(loopNotice('th', call('write_file'), 3)).toContain('ปฏิเสธ');
    expect(repetitionNotice('en')).toContain('repeated');
    expect(repetitionNotice('th')).toContain('ซ้ำ');
  });
});
