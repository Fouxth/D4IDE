import { AgentTimelineItem } from '../../../shared/types';

/**
 * How a flat event stream becomes something readable.
 *
 * The main process emits one item per event — a tool call, its result, a
 * reasoning trace, then prose. Rendered one-to-one that is a wall of cards. The
 * transcript instead pairs each call with its own result and folds a burst of
 * steps into a single collapsible run (spec §15). These rules live outside the
 * component so they can be tested without a DOM.
 */

export interface StepRow {
  id: string;
  item: AgentTimelineItem;
  /** The result emitted for this call, when there is one. */
  result?: AgentTimelineItem;
}

export type Node =
  | { kind: 'message'; item: AgentTimelineItem }
  | { kind: 'plan'; item: AgentTimelineItem }
  | { kind: 'design'; item: AgentTimelineItem }
  | { kind: 'question'; item: AgentTimelineItem }
  | { kind: 'summary'; item: AgentTimelineItem }
  | { kind: 'error'; item: AgentTimelineItem }
  | { kind: 'subagent'; item: AgentTimelineItem }
  | { kind: 'run'; id: string; running: boolean; rows: StepRow[] };

/** Longest run that is still worth showing unfolded. */
const AUTO_OPEN_ROWS = 4;

export function buildNodes(timeline: AgentTimelineItem[]): Node[] {
  const nodes: Node[] = [];
  let run: StepRow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    nodes.push({
      kind: 'run',
      id: `run_${run[0].id}`,
      // A call that already has its result is finished, whatever status the
      // call item still carries from when it was emitted.
      running: run.some((row) => !row.result && row.item.status === 'running'),
      rows: run
    });
    run = [];
  };

  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];

    if (item.type === 'tool_call') {
      // Pair the call with its own result, which is emitted as the next item.
      const next = timeline[i + 1];
      const pairs = next?.type === 'tool_result' && next.toolResult?.toolCallId === item.toolCall?.id;
      run.push({ id: item.id, item, result: pairs ? next : undefined });
      if (pairs) i++;
      continue;
    }

    if (item.type === 'tool_result' || item.type === 'thinking') {
      run.push({ id: item.id, item });
      continue;
    }

    flush();
    if (item.type === 'plan') nodes.push({ kind: 'plan', item });
    else if (item.type === 'design') nodes.push({ kind: 'design', item });
    else if (item.type === 'question') nodes.push({ kind: 'question', item });
    else if (item.type === 'summary') nodes.push({ kind: 'summary', item });
    else if (item.type === 'error') nodes.push({ kind: 'error', item });
    else if (item.type === 'subagent') nodes.push({ kind: 'subagent', item });
    else if (item.type === 'message') nodes.push({ kind: 'message', item });
  }

  flush();
  return nodes;
}

/** Id of the newest run, which is the one the reader is looking at. */
export function lastRunIdOf(nodes: Node[]): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.kind === 'run') return node.id;
  }
  return null;
}

/**
 * Runs start folded once they are done — except the live one, the newest one
 * and the short ones, which the reader can still take in at a glance.
 */
export function defaultRunOpen(node: Extract<Node, { kind: 'run' }>, lastRunId: string | null): boolean {
  return node.running || node.id === lastRunId || node.rows.length <= AUTO_OPEN_ROWS;
}
