import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  describeTranscript,
  transcriptToConversation
} from '../src/main/ai/agent/session-history';
import { AgentTimelineItem, SessionTranscript } from '../src/shared/types';

/**
 * Resuming a session must mean more than redrawing the old timeline: the model
 * has to be told what it already did, or it re-explores the same ground and
 * repeats work. These tests pin the shape of that replay — the conversational
 * spine only, in order, without tool spam or transcript-busting size.
 */
const item = (partial: Partial<AgentTimelineItem>): AgentTimelineItem => ({
  id: partial.id ?? 'x',
  type: partial.type ?? 'message',
  title: partial.title ?? 'User Prompt',
  content: partial.content,
  timestamp: partial.timestamp ?? 0,
  ...partial
});

const transcript = (timeline: AgentTimelineItem[]): SessionTranscript => ({
  sessionId: 's1',
  projectPath: 'C:/proj',
  timeline,
  todos: [],
  plan: null,
  updatedAt: 0,
  endedCleanly: false
});

describe('session replay — what the model sees on resume', () => {
  it('replays user prompts and assistant replies in order', () => {
    const messages = transcriptToConversation(
      transcript([
        item({ id: 'a', title: 'User Prompt', content: 'Add a dark mode toggle' }),
        item({ id: 'b', title: 'D4 Agent', content: 'I added the toggle in settings.' }),
        item({ id: 'c', title: 'User Prompt', content: 'Now persist it' })
      ])
    );

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0].content).toBe('Add a dark mode toggle');
    expect(messages[2].content).toBe('Now persist it');
  });

  it('keeps completion summaries as assistant context', () => {
    const messages = transcriptToConversation(
      transcript([
        item({ id: 'a', type: 'summary', title: 'Done', content: 'Refactor finished: 4 files.' })
      ])
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('Refactor finished');
  });

  it('leaves out tool calls and results entirely', () => {
    const messages = transcriptToConversation(
      transcript([
        item({ id: 'a', title: 'User Prompt', content: 'Fix the bug' }),
        item({ id: 'b', type: 'tool_call', title: 'read_file', content: '{"path":"a.ts"}' }),
        item({
          id: 'c',
          type: 'tool_result',
          title: 'read_file Result',
          content: 'const x = 1;'.repeat(500)
        }),
        item({ id: 'd', title: 'D4 Agent', content: 'Fixed.' })
      ])
    );

    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.content)).toEqual(['Fix the bug', 'Fixed.']);
  });

  it('never disguises a failure as something the assistant said', () => {
    const messages = transcriptToConversation(
      transcript([item({ id: 'a', type: 'error', title: 'Provider Error', content: 'HTTP 401: bad key' })])
    );

    // A stale error from an earlier run must read as context, not as an assistant claim.
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('HTTP 401');
    expect(messages[0].content).toContain('Earlier run failed');
  });

  it('skips empty items and tolerates missing content', () => {
    const messages = transcriptToConversation(
      transcript([
        item({ id: 'a', title: 'User Prompt', content: '   ' }),
        item({ id: 'b', type: 'tool_call', title: 'grep' }),
        item({ id: 'c', title: 'D4 Agent', content: 'Real answer' })
      ])
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Real answer');
  });

  it('returns nothing for a missing or malformed transcript', () => {
    expect(transcriptToConversation(null)).toEqual([]);
    expect(transcriptToConversation(undefined)).toEqual([]);
    expect(transcriptToConversation({ timeline: null } as any)).toEqual([]);
  });
});

describe('session replay — staying inside the context window', () => {
  it('keeps the newest turns when the transcript is long', () => {
    const timeline = Array.from({ length: 40 }, (_, index) =>
      item({
        id: `m${index}`,
        title: index % 2 === 0 ? 'User Prompt' : 'D4 Agent',
        content: `turn ${index}`
      })
    );

    const messages = transcriptToConversation(transcript(timeline));

    expect(messages).toHaveLength(MAX_HISTORY_MESSAGES);
    // The tail is what matters: the very first turns may fall off, the last must not.
    expect(messages[messages.length - 1].content).toBe('turn 39');
    expect(messages.some((m) => m.content === 'turn 0')).toBe(false);
  });

  it('stops before the character budget is blown', () => {
    const timeline = Array.from({ length: 10 }, (_, index) =>
      item({
        id: `m${index}`,
        title: index % 2 === 0 ? 'User Prompt' : 'D4 Agent',
        content: `T${index}:` + 'y'.repeat(4000)
      })
    );

    const messages = transcriptToConversation(transcript(timeline));
    const total = messages.reduce((sum, m) => sum + m.content.length, 0);

    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 4000);
    expect(messages.length).toBeLessThan(timeline.length);
    // Still newest-first-priority: the most recent message survives.
    expect(messages[messages.length - 1].content).toContain('T9:');
  });

  it('always keeps at least the latest turn, however large it is', () => {
    const messages = transcriptToConversation(
      transcript([item({ id: 'a', title: 'User Prompt', content: 'z'.repeat(MAX_HISTORY_CHARS * 2) })])
    );

    expect(messages).toHaveLength(1);
  });
});

describe('session replay — summary line', () => {
  it('describes a transcript for the recovery banner', () => {
    const line = describeTranscript(
      transcript([
        item({ id: 'a', title: 'User Prompt', content: 'hi' }),
        item({
          id: 'b',
          type: 'tool_call',
          title: 'read_file',
          toolCall: { id: 'tc1', name: 'read_file', args: {} }
        }),
        item({
          id: 'c',
          type: 'tool_call',
          title: 'read_file',
          toolCall: { id: 'tc2', name: 'read_file', args: {} }
        })
      ])
    );

    expect(line).toContain('3 events');
    expect(line).toContain('1 prompt');
    expect(line).toContain('1 distinct tool');
  });

  it('has nothing to say about a missing transcript', () => {
    expect(describeTranscript(null)).toBe('');
  });
});
