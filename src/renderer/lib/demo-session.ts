import { AgentTimelineItem } from '../../shared/types';
import { useAgentStore } from '../stores/agentStore';

/**
 * A recorded-looking transcript for UI work (development only).
 *
 * The agent view needs a backend to fill it, which makes it hard to check the
 * layout of a long run — grouped steps, a failed tool, prose, a plan, the
 * outline. Opening the dev server with `?demo=1` seeds this transcript into the
 * store instead. It is compiled out of production builds by the `DEV` check and
 * never runs when the Electron bridge is present.
 */

const now = Date.now();

const item = (
  id: string,
  partial: Partial<AgentTimelineItem> & Pick<AgentTimelineItem, 'type' | 'title'>
): AgentTimelineItem => ({ id, timestamp: now, ...partial } as AgentTimelineItem);

const tool = (
  id: string,
  name: string,
  args: Record<string, unknown>,
  output: string,
  success = true
): [AgentTimelineItem, AgentTimelineItem] => [
  item(`call_${id}`, {
    type: 'tool_call',
    title: name,
    content: JSON.stringify(args, null, 2),
    toolCall: { id: `tc_${id}`, name, args },
    status: 'running'
  }),
  item(`res_${id}`, {
    type: 'tool_result',
    title: `${name} Result`,
    content: output,
    toolResult: { toolCallId: `tc_${id}`, success, output, error: success ? undefined : output },
    status: success ? 'success' : 'failed'
  })
];

const readOutput = [
  'export interface ProviderChatRequest {',
  '  model: string;',
  '  messages: ChatMessage[];',
  '  tools?: ToolDefinition[];',
  '  temperature?: number;',
  '  reasoningEffort?: ReasoningEffort;',
  '  signal?: AbortSignal;',
  '}'
].join('\n');

function buildTimeline(): AgentTimelineItem[] {
  const grep = tool(
    '1',
    'run_terminal',
    { command: 'grep -n "interface ProviderChatRequest" -A 12 src/shared/types.ts' },
    `${readOutput}\n\n12 matches in 3 files`
  );
  const read = tool('2', 'read_file', { path: 'src/main/ai/providers/openai-adapter.ts' }, readOutput);
  const edit = tool(
    '3',
    'edit_file',
    { path: 'src/main/ai/providers/openai-adapter.ts', oldString: 'this.headers()', newString: 'this.headers(req.sessionId)' },
    'Edited src/main/ai/providers/openai-adapter.ts (+4 -1)'
  );
  const write = tool('4', 'write_file', { path: 'src/shared/version.ts' }, 'Wrote src/shared/version.ts (12 lines)');
  const sync = tool(
    '5',
    'run_terminal',
    { command: 'node scripts/sync-providers.cjs --input=models-dev.json' },
    '48 providers · 361 models · written to src/shared/provider-presets.ts'
  );
  const failed = tool(
    '6',
    'run_tests',
    { command: 'pnpm test' },
    'FAIL tests/provider-usability.test.ts\n  ● marks a provider unusable when its key is rejected\n\n  2 failed, 163 passed',
    false
  );
  const fix = tool(
    '7',
    'edit_file',
    { path: 'src/main/ai/providers/provider-usability.ts' },
    'Edited src/main/ai/providers/provider-usability.ts (+6 -2)'
  );
  const green = tool('8', 'run_tests', { command: 'pnpm test' }, 'Test Files  18 passed (18)\nTests  165 passed (165)');

  return [
    item('u1', {
      type: 'message',
      title: 'User Prompt',
      content:
        'opencode go ครับ และใช้เช็คการทำงาน ให้ใช้งานได้ 100% หน่อยครับ และ API ที่จะใช้ก็ต้องมีให้เลือกทุกค่ายเลย'
    }),
    item('t1', {
      type: 'thinking',
      title: 'Reasoning',
      content:
        'ProviderChatRequest has: model, messages, tools, temperature, reasoningEffort, signal. No sessionId. The Go endpoint wants a client identity and a session header, so I will add an optional sessionId and send it only to opencode.ai.'
    }),
    ...grep,
    ...read,
    item('t2', {
      type: 'thinking',
      title: 'Reasoning',
      content: 'The adapter builds headers in one place, so both the streaming and non-streaming paths pick the change up.'
    }),
    ...edit,
    ...write,
    ...sync,
    item('m1', {
      type: 'message',
      title: 'D4 Agent',
      content:
        'เพิ่มพรีเซ็ต OpenCode Go ให้แล้วครับ — registry ชี้ว่า Go ใช้โปรโตคอลเดียวทั้งแคตตาล็อก จึงเป็นพรีเซ็ตเดียวชนิด OpenAI-compatible และเพิ่มสอง header ที่เอกสารบังคับ คือ User-Agent กับ x-opencode-session ซึ่งส่งเฉพาะไปที่ opencode.ai เท่านั้น'
    }),
    ...failed,
    item('t3', {
      type: 'thinking',
      title: 'Reasoning',
      content: 'The failing case is a provider whose key was rejected once but is still enabled — usability must treat a stale test failure as advisory, not fatal.'
    }),
    ...fix,
    ...green,
    item('s1', {
      type: 'summary',
      title: 'Task complete',
      content:
        'Done — 2 files changed, tests green (165 passed / 18 files), typecheck clean.\n\n48 providers · 361 models available to choose from.'
    }),
    item('u2', {
      type: 'message',
      title: 'User Prompt',
      content: 'ช่วยทำให้น่าใช้งาน และเอาให้เหมือน freebuff จริงๆ'
    }),
    item('t4', {
      type: 'thinking',
      title: 'Reasoning',
      content:        'The shell needs to read like a workspace: a session tab strip on top, the transcript as compact step rows, and the side panel with word tabs.'
    })
  ];
}

/** Exported so the demo bridge can replay the same transcript per session. */
export const DEMO_TIMELINE: AgentTimelineItem[] = buildTimeline();

export function seedDemoTranscript(): void {
  useAgentStore.setState({ timeline: DEMO_TIMELINE, status: 'idle', sessionId: 'demo_session' });
}


