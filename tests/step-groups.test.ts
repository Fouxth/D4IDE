import { describe, expect, it } from 'vitest';
import { buildNodes, defaultRunOpen, lastRunIdOf, Node } from '../src/renderer/features/agent/step-groups';
import { AgentTimelineItem } from '../src/shared/types';

const call = (id: string, name: string, status: AgentTimelineItem['status'] = 'running'): AgentTimelineItem => ({
  id,
  type: 'tool_call',
  title: name,
  toolCall: { id: `tc_${id}`, name, args: { command: name } },
  status,
  timestamp: 0
});

const result = (id: string, callId: string, success = true): AgentTimelineItem => ({
  id: `${id}_res`,
  type: 'tool_result',
  title: 'Result',
  content: 'output',
  toolResult: { toolCallId: `tc_${callId}`, success },
  status: success ? 'success' : 'failed',
  timestamp: 0
});

const thinking = (id: string): AgentTimelineItem => ({ id, type: 'thinking', title: 'Reasoning', timestamp: 0 });
const message = (id: string, title = 'D4 Agent'): AgentTimelineItem => ({
  id,
  type: 'message',
  title,
  content: 'hi',
  timestamp: 0
});

const runs = (nodes: Node[]) => nodes.filter((n): n is Extract<Node, { kind: 'run' }> => n.kind === 'run');

describe('transcript grouping', () => {
  it('pairs each tool call with the result emitted right after it', () => {
    const nodes = buildNodes([call('a', 'read_file'), result('a', 'a')]);
    const [run] = runs(nodes);
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0].result?.id).toBe('a_res');
  });

  it('keeps an unpaired result visible instead of dropping it', () => {
    const nodes = buildNodes([result('orphan', 'missing')]);
    const [run] = runs(nodes);
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0].result).toBeUndefined();
  });

  it('folds a burst of steps into one run and splits it at a message', () => {
    const nodes = buildNodes([
      thinking('t1'),
      call('a', 'read_file'),
      result('a', 'a'),
      call('b', 'edit_file'),
      result('b', 'b'),
      message('m1'),
      call('c', 'run_tests'),
      result('c', 'c')
    ]);

    expect(nodes.map((n) => n.kind)).toEqual(['run', 'message', 'run']);
    const [first, second] = runs(nodes);
    expect(first.rows.map((row) => row.id)).toEqual(['t1', 'a', 'b']);
    expect(second.rows.map((row) => row.id)).toEqual(['c']);
  });

  it('only calls a run live while a call is still unanswered', () => {
    const answered = runs(buildNodes([call('a', 'read_file'), result('a', 'a')]))[0];
    const pending = runs(buildNodes([call('b', 'read_file')]))[0];
    expect(answered.running).toBe(false);
    expect(pending.running).toBe(true);
  });

  it('keeps plans, summaries and subagent reports out of the step stream', () => {
    const nodes = buildNodes([
      call('a', 'read_file'),
      result('a', 'a'),
      { id: 'p', type: 'plan', title: 'Plan', timestamp: 0 },
      { id: 's', type: 'summary', title: 'Done', timestamp: 0 }
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(['run', 'plan', 'summary']);
  });

  it('a question card is its own node, not a step inside the run', () => {
    // The card carries buttons, so it must not be swallowed by a collapsed run
    // of tool calls — the user could not answer work that is folded away.
    const nodes = buildNodes([
      call('a', 'read_file'),
      result('a', 'a'),
      { id: 'q', type: 'question', title: 'Questions', timestamp: 0 },
      call('b', 'read_file'),
      result('b', 'b')
    ]);

    expect(nodes.map((n) => n.kind)).toEqual(['run', 'question', 'run']);
  });

  it('folds a finished long run, and keeps the newest one open', () => {
    const timeline: AgentTimelineItem[] = [];
    for (let i = 0; i < 6; i++) {
      timeline.push(call(`a${i}`, 'read_file'), result(`a${i}`, `a${i}`));
    }
    const nodes = buildNodes(timeline);
    const [run] = runs(nodes);
    const lastRunId = lastRunIdOf(nodes);

    expect(defaultRunOpen(run, 'some_other_run')).toBe(false);
    expect(defaultRunOpen(run, lastRunId)).toBe(true);
    expect(defaultRunOpen(runs(buildNodes([call('x', 'read_file'), result('x', 'x')]))[0], 'other')).toBe(true);
  });

  it('reports the newest run as the one to follow', () => {
    const nodes = buildNodes([call('a', 'read_file'), result('a', 'a'), message('m'), call('b', 'write_file')]);
    expect(lastRunIdOf(nodes)).toBe('run_b');
  });
});
