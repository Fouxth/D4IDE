import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DESIGN_PROFILES } from '../src/shared/design-profiles';
import { writeProjectMemory } from '../src/main/project/project-memory';
import { writeProjectDesign, readProjectDesign } from '../src/main/project/design-store';

/**
 * End-to-end tests for the agent runtime itself.
 *
 * They run the real loop against a scripted provider so the two guarantees that
 * used to be broken are actually verified here:
 *   1. Safe/Ask mode must not touch a file until the user approves.
 *   2. A checkpoint must contain the previous file content so it can restore.
 *
 * `electron` is stubbed: `app.getPath` throws so the store falls back to the
 * APPDATA-scoped data dir, which we point at a temp folder.
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-agent-test-'));
process.env.APPDATA = testRoot;

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('app is not ready in tests');
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  },
  BrowserWindow: class {},
  ipcMain: { handle: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => {} }
}));

const { IPC_CHANNELS } = await import('../src/shared/ipc-events');
const { appStore } = await import('../src/main/database/store');
const { providerManager } = await import('../src/main/ai/providers/provider-manager');
const { agentRuntime } = await import('../src/main/ai/agent/agent-runtime');
const { usageService } = await import('../src/main/ai/usage/usage-service');
const { ToolCall } = await import('../src/shared/types');

const PROVIDER_ID = 'test-provider';
const MODEL_ID = 'test-model';

interface CapturedEvent {
  channel: string;
  payload: any;
}

/** Scripted provider: returns the queued tool calls first, then plain text. */
class ScriptedProvider {
  id = PROVIDER_ID;
  name = 'Test Provider';
  calls = 0;

  constructor(private script: ToolCall[][]) {}

  async listModels() {
    return [];
  }

  async testConnection() {
    return { success: true };
  }

  async streamChat(_req: any, onChunk: (chunk: any) => void) {
    const step = this.calls++;
    const toolCalls = this.script[step] ?? [];
    if (toolCalls.length > 0) {
      onChunk({ toolCalls, finishReason: 'tool_calls' });
    } else {
      onChunk({ content: `Handled in ${this.calls} step(s).` });
    }
    onChunk({
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedPromptTokens: 40 }
    });
  }
}

const createWindow = () => {
  const events: CapturedEvent[] = [];
  const win: any = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: any) => events.push({ channel, payload })
    }
  };
  return { win, events };
};

const timelineOf = (events: CapturedEvent[]) =>
  events.filter((e) => e.channel === IPC_CHANNELS.AGENT_EVENT && e.payload?.type === 'timeline').map((e) => e.payload.item);

const approvalRequests = (events: CapturedEvent[]) =>
  events.filter((e) => e.channel === IPC_CHANNELS.AGENT_APPROVAL_REQUEST).map((e) => e.payload);

const statusEvents = (events: CapturedEvent[]) =>
  events
    .filter((e) => e.channel === IPC_CHANNELS.AGENT_EVENT && e.payload?.type === 'status')
    .map((e) => e.payload.status);

const waitFor = async (predicate: () => boolean, timeoutMs = 4000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Timed out waiting for the expected agent state');
};

let projectPath: string;

beforeAll(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-project-'));
});

afterAll(() => {
  providerManager.forgetInstance(PROVIDER_ID);
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.rmSync(projectPath, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset persisted state between tests and register the scripted provider.
  appStore.saveSettings({
    activeProviderId: PROVIDER_ID,
    activeModelId: MODEL_ID,
    permissionMode: 'safe',
    language: 'en',
    autoRunBuild: false,
    autoRunTests: false,
    checkpointFrequency: 'write',
    maxAgentSteps: 5,
    removedProviderIds: [],
    fallbackChain: []
  });

  appStore.saveProviders([
    {
      id: PROVIDER_ID,
      name: 'Test Provider',
      type: 'custom',
      enabled: true,
      baseUrl: 'http://127.0.0.1:9/v1',
      requiresApiKey: false,
      models: [
        {
          id: MODEL_ID,
          name: 'Test Model',
          providerId: PROVIDER_ID,
          supportsTools: true,
          supportsVision: false,
          inputPricePerMillion: 3,
          outputPricePerMillion: 15,
          cachedInputPricePerMillion: 0.3
        }
      ]
    }
  ]);

  providerManager.reloadProviders();
});

describe('agent runtime — approval gate', () => {
  it('does not write a file until the user approves the tool call', async () => {
    const target = path.join(projectPath, 'created.txt');
    fs.rmSync(target, { force: true });

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'write_file', args: { path: 'created.txt', content: 'hello from the agent' } }]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Create created.txt', mode: 'build', projectPath, sessionId: 's_approve' });

    await waitFor(() => approvalRequests(events).length > 0);

    // The gate must hold: the file must not exist while approval is pending.
    expect(fs.existsSync(target)).toBe(false);
    expect(appStore.getSettings().permissionMode).toBe('safe');

    const request = approvalRequests(events)[0];
    expect(request.toolCall.name).toBe('write_file');

    agentRuntime.resolveApproval(request.id, 'approved', 'write_file');
    await run;

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('hello from the agent');
  });

  it('leaves the file untouched and reports the refusal when the user rejects', async () => {
    const target = path.join(projectPath, 'rejected.txt');
    fs.rmSync(target, { force: true });

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'write_file', args: { path: 'rejected.txt', content: 'should never land' } }]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Create rejected.txt', mode: 'build', projectPath, sessionId: 's_reject' });

    await waitFor(() => approvalRequests(events).length > 0);
    agentRuntime.resolveApproval(approvalRequests(events)[0].id, 'rejected', 'write_file');
    await run;

    expect(fs.existsSync(target)).toBe(false);

    // The model is told the action was refused so it can change approach…
    const refused = timelineOf(events).find(
      (item) => item.type === 'tool_result' && String(item.content).includes('User rejected')
    );
    expect(refused).toBeDefined();

    // …and the refusal is recorded in the audit trail.
    const audit = appStore.getToolAudit(50);
    expect(audit.some((entry) => entry.toolName === 'write_file' && entry.decision === 'rejected')).toBe(true);
  });

  it('auto-approves read-only work in safe mode without asking', async () => {
    fs.writeFileSync(path.join(projectPath, 'readable.txt'), 'file body', 'utf8');

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([[{ id: 'call_1', name: 'read_file', args: { path: 'readable.txt' } }]]) as any
    );

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Read readable.txt', mode: 'build', projectPath, sessionId: 's_read' });

    expect(approvalRequests(events)).toHaveLength(0);
    const result = timelineOf(events).find((item) => item.type === 'tool_result' && item.status === 'success');
    expect(String(result?.content)).toContain('file body');
  });

  it('never exposes write tools to the model in plan mode', async () => {
    const scripted = new ScriptedProvider([[{ id: 'call_1', name: 'write_file', args: { path: 'x.txt', content: 'nope' } }]]);
    providerManager.setProviderInstance(PROVIDER_ID, scripted as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Plan a change', mode: 'plan', projectPath, sessionId: 's_plan' });

    // Plan mode pauses for plan approval; approve so the run can finish cleanly.
    await waitFor(() => timelineOf(events).some((item) => item.type === 'plan'));
    agentRuntime.approvePlan();
    await run;

    // The tool registry is what filters write tools; verify the agents' view.
    const { toolRegistry } = await import('../src/main/ai/tools/tool-registry');
    const planTools = toolRegistry.getToolDefinitions('plan').map((tool) => tool.name);
    expect(planTools).not.toContain('write_file');
    expect(planTools).toContain('read_file');
    expect(fs.existsSync(path.join(projectPath, 'x.txt'))).toBe(false);
  });
});

describe('agent runtime — checkpoints', () => {
  it('snapshots the previous content before an edit so it can be restored', async () => {
    const target = path.join(projectPath, 'edited.txt');
    fs.writeFileSync(target, 'original content', 'utf8');

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [
          {
            id: 'call_1',
            name: 'edit_file',
            args: { path: 'edited.txt', targetContent: 'original content', replacementContent: 'updated content' }
          }
        ]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Update edited.txt', mode: 'build', projectPath, sessionId: 's_checkpoint' });

    await waitFor(() => approvalRequests(events).length > 0);
    agentRuntime.resolveApproval(approvalRequests(events)[0].id, 'approved', 'edit_file');
    await run;

    expect(fs.readFileSync(target, 'utf8')).toBe('updated content');

    // The checkpoint must actually hold the pre-edit bytes.
    const checkpoints = appStore.getCheckpoints();
    const relevant = checkpoints.find((cp) => cp.files.some((f) => f.path === target));
    expect(relevant).toBeDefined();
    expect(relevant!.files[0].content).toBe('original content');

    // …which is what makes restore work (the old bug stored an empty file list).
    fs.writeFileSync(target, relevant!.files[0].content, 'utf8');
    expect(fs.readFileSync(target, 'utf8')).toBe('original content');
  });

  it('ends the run with a completion report stored on the request it belongs to', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'write_file', args: { path: 'summary.txt', content: 'done' } }]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Write summary.txt', mode: 'build', projectPath, sessionId: 's_summary' });

    await waitFor(() => approvalRequests(events).length > 0);
    agentRuntime.resolveApproval(approvalRequests(events)[0].id, 'approved', 'write_file');
    await run;

    // The report still lives on the request's usage row (spec §88), but the
    // user-facing story is the Freebuff-style changed-files card in the
    // timeline: one row per file with +/- counts, structured so the renderer
    // never re-parses prose.
    const summaryCard = timelineOf(events).find((item) => item.type === 'summary');
    expect(summaryCard).toBeDefined();
    expect(summaryCard!.details.files).toEqual([
      expect.objectContaining({ path: 'summary.txt', type: 'created' })
    ]);

    const record = appStore.getUsageRecords().filter((r) => r.sessionId === 's_summary').pop()!;
    expect(record.summary).toBeDefined();
    expect(record.summary).toContain('**Changed files:**');
    expect(record.summary).toContain('summary.txt');
    expect(record.summary).toContain('**Validation:**');
    expect(record.summary).toContain('**Usage:**');
    expect(record.summaryRequest).toBe('Write summary.txt');
  });
});

const questionCards = (events: CapturedEvent[]) => timelineOf(events).filter((item) => item.type === 'question');

describe('agent runtime — questions', () => {
  const askCall = (id = 'call_q') => ({
    id,
    name: 'ask_question',
    args: {
      questions: [
        {
          header: 'ฐานข้อมูล',
          question: 'จะใช้ฐานข้อมูลอะไร?',
          options: [{ label: 'PostgreSQL', description: 'มีอยู่แล้วในเครื่อง' }, { label: 'SQLite' }]
        }
      ]
    }
  });

  it('is offered to every model, in plan mode as well as build mode', async () => {
    const { toolRegistry } = await import('../src/main/ai/tools/tool-registry');
    expect(toolRegistry.getToolDefinitions('plan').map((tool) => tool.name)).toContain('ask_question');
    expect(toolRegistry.getToolDefinitions('build').map((tool) => tool.name)).toContain('ask_question');
  });

  it('parking in plan mode, asking with options, and planning only after the answers', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([[askCall()], [], []]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'ทำโปรเจกต์อสังหา',
      mode: 'plan',
      projectPath,
      sessionId: 's_ask_plan'
    });

    await waitFor(() => questionCards(events).length > 0);

    const card = questionCards(events)[0];
    expect(card.details.questions[0].header).toBe('ฐานข้อมูล');
    expect(card.details.questions[0].options.map((option: any) => option.label)).toEqual([
      'PostgreSQL',
      'SQLite'
    ]);
    expect(statusEvents(events).at(-1)).toBe('waiting_approval');

    // Nothing was planned while the run was parked — that is the whole point of
    // asking first.
    expect(timelineOf(events).some((item) => item.type === 'plan')).toBe(false);

    expect(
      agentRuntime.answerQuestions({
        answers: [{ question: 'จะใช้ฐานข้อมูลอะไร?', selected: ['PostgreSQL'] }]
      })
    ).toBe(true);
    // A second answer has nothing to answer.
    expect(agentRuntime.answerQuestions({ answers: [] })).toBe(false);

    await waitFor(() => timelineOf(events).some((item) => item.type === 'plan'));
    agentRuntime.approvePlan();
    await run;

    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('answers in build mode reach the model and the work continues', async () => {
    const target = path.join(projectPath, 'answered.txt');
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [askCall()],
        [{ id: 'call_1', name: 'write_file', args: { path: 'answered.txt', content: 'yes' } }],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'เริ่มโปรเจกต์ใหม่',
      mode: 'build',
      projectPath,
      sessionId: 's_ask_build'
    });

    await waitFor(() => questionCards(events).length > 0);
    await agentRuntime.answerQuestions({
      answers: [{ question: 'จะใช้ฐานข้อมูลอะไร?', selected: ['SQLite'], note: 'ของเดิมมีอยู่' }]
    });

    // Getting to the approval dialog proves the loop moved past the question.
    await waitFor(() => approvalRequests(events).length > 0);
    agentRuntime.resolveApproval(approvalRequests(events)[0].id, 'approved', 'write_file');
    await run;

    expect(fs.existsSync(target)).toBe(true);

    // The answer is written onto the card it belongs to, so a replayed session
    // shows what was decided instead of an unanswered question.
    // The transcript is flushed on a short timer, so give it a moment.
    let transcript: any = null;
    for (let attempt = 0; attempt < 60 && !transcript; attempt++) {
      const stored = appStore.getSessionTranscript<any>('s_ask_build');
      if (stored?.timeline?.some((item: any) => item.type === 'question' && item.details?.answer)) {
        transcript = stored;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(transcript).not.toBeNull();
    const storedCard = transcript.timeline.find((item: any) => item.type === 'question');
    expect(storedCard.details.answer.answers[0].selected).toEqual(['SQLite']);
    expect(storedCard.details.answer.answers[0].note).toBe('ของเดิมมีอยู่');
  });

  it('a cancelled run is not left parked on a question', async () => {
    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([[askCall()], []]) as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'ถามก่อน',
      mode: 'build',
      projectPath,
      sessionId: 's_ask_cancel'
    });

    await waitFor(() => questionCards(events).length > 0);
    agentRuntime.cancel();
    await run;

    expect(statusEvents(events).at(-1)).toBe('cancelled');
  });

  it('a skip tells the model to decide and state its assumption', async () => {
    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([[askCall()], []]) as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'ข้ามคำถามได้',
      mode: 'build',
      projectPath,
      sessionId: 's_ask_skip'
    });

    await waitFor(() => questionCards(events).length > 0);
    await agentRuntime.answerQuestions({ answers: [], skipped: true });
    await run;

    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('a malformed ask is refused instead of parking the run on an unanswerable card', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_q', name: 'ask_question', args: { questions: [{ question: '   ' }] } }],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'ถามอะไรก็ได้',
      mode: 'build',
      projectPath,
      sessionId: 's_ask_bad'
    });

    expect(questionCards(events)).toHaveLength(0);
    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('asking is never gated behind an approval dialog', async () => {
    const { permissionEngine } = await import('../src/main/security/permission-engine');
    const decision = permissionEngine.check('safe', askCall() as any, {}, { projectPath });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });
});

describe('agent runtime — usage accounting', () => {
  it('records tokens and cost for every provider call, including cached tokens', async () => {
    const before = appStore.getUsageRecords().length;

    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([[]]) as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'Just answer', mode: 'build', projectPath, sessionId: 's_usage' });

    const records = appStore.getUsageRecords();
    expect(records.length).toBeGreaterThan(before);

    const record = records.filter((r) => r.sessionId === 's_usage').pop()!;
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(20);
    expect(record.cachedInputTokens).toBe(40);
    expect(record.providerId).toBe(PROVIDER_ID);
    expect(record.status).toBe('completed');

    // 60 fresh input @ $3/M + 40 cached @ $0.3/M + 20 output @ $15/M
    const expected = (60 * 3 + 40 * 0.3 + 20 * 15) / 1_000_000;
    expect(record.estimatedCost).toBeCloseTo(expected, 10);
  });

  /** Provider that reports tokens and then fails, like a mid-stream 429. */
  const failingProvider = (tokens: number) => {
    const provider: any = {
      id: PROVIDER_ID,
      name: 'Failing Provider',
      attempts: 0,
      async listModels() {
        return [];
      },
      async testConnection() {
        return { success: true };
      },
      async streamChat(_req: any, onChunk: (chunk: any) => void) {
        provider.attempts++;
        onChunk({ usage: { promptTokens: tokens, completionTokens: 5, totalTokens: tokens + 5 } });
        throw new Error('HTTP 429: rate limit reached');
      }
    };
    return provider;
  };

  it('records usage even when the provider call fails', async () => {
    // No retries here: we want to see exactly what one failed call records.
    appStore.saveSettings({ retryLimit: 0 });
    providerManager.setProviderInstance(PROVIDER_ID, failingProvider(70));

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Do something', mode: 'build', projectPath, sessionId: 's_failed' });

    const failedRecord = appStore
      .getUsageRecords()
      .filter((r) => r.sessionId === 's_failed')
      .pop();
    expect(failedRecord).toBeDefined();
    expect(failedRecord!.status).toBe('failed');
    expect(failedRecord!.inputTokens).toBe(70);

    // The error message must be actionable, not a raw stack/exception string.
    const errorItem = timelineOf(events).find((item) => item.type === 'error');
    expect(errorItem).toBeDefined();
    expect(String(errorItem!.content)).toMatch(/rate limited/i);
  });

  it('counts every retry attempt and tells the user a retry is happening', async () => {
    appStore.saveSettings({ retryLimit: 1 });
    const provider = failingProvider(70);
    providerManager.setProviderInstance(PROVIDER_ID, provider);

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Do something', mode: 'build', projectPath, sessionId: 's_retry' });

    expect(provider.attempts).toBe(2);

    const record = appStore
      .getUsageRecords()
      .filter((r) => r.sessionId === 's_retry')
      .pop()!;
    // Each attempt is a real request against the provider, so the tokens add up.
    expect(record.inputTokens).toBe(140);
    expect(record.status).toBe('failed');

    const retryNote = timelineOf(events).find(
      (item) => item.type === 'thinking' && /retry/i.test(`${item.title} ${item.content}`)
    );
    expect(retryNote).toBeDefined();
  });
});

describe('agent runtime — provider resolution', () => {
  it('falls back to a usable provider and says so in the timeline', async () => {
    appStore.saveSettings({ activeProviderId: 'does-not-exist', activeModelId: 'nope' });
    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([[]]) as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Hello', mode: 'build', projectPath, sessionId: 's_fallback' });

    const note = timelineOf(events).find(
      (item) => item.type === 'thinking' && /fallback|using/i.test(String(item.content) + String(item.title))
    );
    expect(note).toBeDefined();
    expect(appStore.getUsageRecords().some((r) => r.providerId === PROVIDER_ID)).toBe(true);
  });

  it('reports a clear error instead of throwing when no provider is usable', async () => {
    // Fresh install: the shipped presets all need a key, and the keyless local
    // one has never answered. No request may be attempted in that state.
    appStore.saveProviders([]);
    appStore.saveSettings({ activeProviderId: 'missing', activeModelId: 'missing', fallbackChain: [] });
    providerManager.reloadProviders();
    providerManager.forgetInstance(PROVIDER_ID);

    expect(providerManager.getUsableProviders()).toHaveLength(0);

    const { win, events } = createWindow();
    const startedAt = Date.now();
    await agentRuntime.run(win, { prompt: 'Hello', mode: 'build', projectPath, sessionId: 's_none' });

    const errorItem = timelineOf(events).find((item) => item.type === 'error');
    expect(errorItem).toBeDefined();
    expect(String(errorItem!.content)).toMatch(/provider/i);

    // No request, no retry backoff: the failure must be immediate.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(timelineOf(events).some((item) => /retry/i.test(String(item.title)))).toBe(false);
  });

  it('will not route to a keyless local provider before it has been confirmed running', () => {
    appStore.saveProviders([
      {
        id: 'ollama',
        name: 'Ollama',
        type: 'ollama',
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        requiresApiKey: false,
        status: 'local',
        models: [{ id: 'llama3.2', name: 'Llama 3.2', providerId: 'ollama', supportsTools: true }]
      } as any
    ]);
    providerManager.reloadProviders();

    expect(providerManager.getUsableProviders()).toHaveLength(0);

    // After a successful probe it joins the rotation…
    appStore.updateProviderMeta('ollama', { status: 'connected' });
    expect(providerManager.getUsableProviders().map((p) => p.id)).toEqual(['ollama']);

    // …and a failed probe takes it straight back out.
    appStore.updateProviderMeta('ollama', { status: 'error', lastError: 'connect ECONNREFUSED' });
    expect(providerManager.getUsableProviders()).toHaveLength(0);
  });

  it('names the unverified local provider instead of blaming the configuration', async () => {
    appStore.saveProviders([
      {
        id: 'ollama',
        name: 'Ollama',
        type: 'ollama',
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        requiresApiKey: false,
        status: 'local',
        models: [{ id: 'llama3.2', name: 'Llama 3.2', providerId: 'ollama', supportsTools: true }]
      } as any
    ]);
    appStore.saveSettings({ activeProviderId: 'ollama', activeModelId: 'llama3.2', fallbackChain: [] });
    providerManager.reloadProviders();

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Hello', mode: 'build', projectPath, sessionId: 's_local' });

    const errorItem = timelineOf(events).find((item) => item.type === 'error');
    expect(String(errorItem!.content)).toMatch(/Ollama/);
    expect(String(errorItem!.content)).toMatch(/Test|ทดสอบ/);
  });

  it('keeps a deleted built-in provider deleted across restarts', () => {
    expect(appStore.getProviders().some((p) => p.id === 'anthropic')).toBe(true);

    appStore.deleteProvider('anthropic');

    // Reading again is what used to resurrect every shipped preset.
    expect(appStore.getProviders().some((p) => p.id === 'anthropic')).toBe(false);
    expect(appStore.getSettings().removedProviderIds).toContain('anthropic');

    // Auth: a deleted provider is never offered for routing.
    expect(providerManager.getUsableProviders().some((p) => p.id === 'anthropic')).toBe(false);

    // Re-adding it from the hub clears the removal so it survives the next restart.
    appStore.saveProviders([
      ...appStore.getProviders(),
      {
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        enabled: true,
        baseUrl: 'https://api.anthropic.com',
        requiresApiKey: true,
        models: []
      } as any
    ]);
    expect(appStore.getSettings().removedProviderIds).not.toContain('anthropic');
    expect(appStore.getProviders().some((p) => p.id === 'anthropic')).toBe(true);
  });
});

describe('agent runtime — subagents', () => {
  it('delegates to a subagent and gives the parent only its report', async () => {
    fs.writeFileSync(path.join(projectPath, 'auth.ts'), 'export const login = () => true;', 'utf8');

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'spawn_subagent', args: { role: 'explore', task: 'Where does login live?' } }],
        // The subagent does its own work…
        [{ id: 'sub_1', name: 'read_file', args: { path: 'auth.ts' } }],
        [],
        // …and the parent wraps up.
        []
      ]) as any
    );

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Find the login code', mode: 'build', projectPath, sessionId: 's_sub' });

    // The delegation is visible as a start card and a completion card, both tagged
    // with the role so the UI can colour them.
    const cards = timelineOf(events).filter((item) => item.type === 'subagent');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ agent: 'explore', status: 'running' });
    expect(cards[1]).toMatchObject({ agent: 'explore', status: 'success' });
    expect(String(cards[1].content)).toContain('Handled in 3 step(s).');

    // The subagent's own tool work is attributed to it, not to the parent.
    const subToolCall = timelineOf(events).find((item) => item.type === 'tool_call' && item.agent === 'explore');
    expect(subToolCall?.title).toBe('read_file');

    // The parent sees one compact result carrying the report.
    const result = timelineOf(events).find(
      (item) => item.type === 'tool_result' && item.title === 'spawn_subagent Result'
    );
    expect(String(result?.content)).toContain('Handled in 3 step(s).');
    expect(result?.status).toBe('success');
  });

  it('still asks the user before a "read-only" subagent is allowed to write', async () => {
    const target = path.join(projectPath, 'subagent-wrote.txt');
    fs.rmSync(target, { force: true });

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'spawn_subagent', args: { role: 'explore', task: 'Create a file' } }],
        // A model that ignores the role restrictions and tries to write anyway.
        [{ id: 'sub_1', name: 'write_file', args: { path: 'subagent-wrote.txt', content: 'nope' } }],
        [],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Look around', mode: 'build', projectPath, sessionId: 's_sub_write' });

    await waitFor(() => approvalRequests(events).length > 0);
    expect(fs.existsSync(target)).toBe(false);

    // The dialog has to say who is asking, or the user cannot judge it.
    const request = approvalRequests(events)[0];
    expect(request.toolCall.name).toBe('write_file');
    expect(String(request.reason)).toContain('Explore subagent');

    agentRuntime.resolveApproval(request.id, 'rejected', 'write_file');
    await run;

    expect(fs.existsSync(target)).toBe(false);
    expect(
      appStore.getToolAudit(50).some((entry) => entry.toolName === 'write_file' && entry.decision === 'rejected')
    ).toBe(true);
  });

  it('stops a subagent from delegating further', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'spawn_subagent', args: { role: 'review', task: 'Review the change' } }],
        [{ id: 'sub_1', name: 'spawn_subagent', args: { role: 'explore', task: 'Nested delegation' } }],
        [],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Review it', mode: 'build', projectPath, sessionId: 's_nested' });

    // Exactly one delegation ran; the nested attempt came back as a refusal the
    // subagent can read and work around.
    expect(timelineOf(events).filter((item) => item.type === 'subagent')).toHaveLength(2);

    const nested = timelineOf(events).find(
      (item) => item.type === 'tool_result' && String(item.content).includes('cannot delegate')
    );
    expect(nested).toBeDefined();
    expect(nested?.status).toBe('failed');
  });

  it('never runs a write-capable subagent while planning', async () => {
    const target = path.join(projectPath, 'planned.txt');
    fs.rmSync(target, { force: true });

    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [
          {
            id: 'call_1',
            name: 'spawn_subagent',
            args: { role: 'frontend', task: 'Ship the new screen' }
          },
          { id: 'call_2', name: 'write_file', args: { path: 'planned.txt', content: 'while planning' } }
        ],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Plan the screen', mode: 'plan', projectPath, sessionId: 's_plan_sub' });

    await waitFor(() => timelineOf(events).some((item) => item.type === 'plan'));
    agentRuntime.approvePlan();
    await run;

    expect(timelineOf(events).filter((item) => item.type === 'subagent')).toHaveLength(0);
    expect(fs.existsSync(target)).toBe(false);

    // Defence in depth: the delegation entry point itself refuses a write-capable
    // role in Plan Mode, so the promise holds even if a caller forgets to filter.
    const runtime = agentRuntime as any;
    const previousMode = runtime.currentMode;
    runtime.currentMode = 'plan';
    try {
      await expect(runtime.runSubagentTool({ role: 'frontend', task: 'Ship it' }, projectPath)).rejects.toThrow(
        /Plan Mode/
      );
    } finally {
      runtime.currentMode = previousMode;
    }
  });

  it('rejects an unknown role with the list of valid ones', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'spawn_subagent', args: { role: 'wizard', task: 'Do magic' } }],
        []
      ]) as any
    );

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Delegate', mode: 'build', projectPath, sessionId: 's_bad_role' });

    const blocked = timelineOf(events).find((item) => item.type === 'error');
    expect(String(blocked?.content)).toMatch(/known role/);
    expect(String(blocked?.content)).toContain('explore');
    expect(timelineOf(events).filter((item) => item.type === 'subagent')).toHaveLength(0);
  });
});

describe('agent runtime — session resume', () => {
  it('replays the earlier conversation and appends to the same session', async () => {
    const first = new ScriptedProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, first as any);

    const { win } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'Remember the magic word is plumbus',
      mode: 'build',
      projectPath,
      sessionId: 's_resume'
    });

    // A second run on the same session must be handed the earlier turn.
    const seen: any[][] = [];
    const second: any = {
      id: PROVIDER_ID,
      name: 'Test Provider',
      async listModels() {
        return [];
      },
      async testConnection() {
        return { success: true };
      },
      async streamChat(req: any, onChunk: (chunk: any) => void) {
        seen.push(req.messages);
        onChunk({ content: 'Continuing.' });
        onChunk({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
      }
    };
    providerManager.setProviderInstance(PROVIDER_ID, second);

    const { win: win2, events: events2 } = createWindow();
    await agentRuntime.run(win2, {
      prompt: 'What was the magic word?',
      mode: 'build',
      projectPath,
      sessionId: 's_resume'
    });

    const replayed = seen[0].map((message) => message.content).join('\n');
    expect(replayed).toContain('Remember the magic word is plumbus');

    // The user is told the session continued rather than started fresh.
    const notice = timelineOf(events2).find((item) => /Loaded .* event/i.test(String(item.content)));
    expect(notice).toBeDefined();
    expect(String(notice?.title)).toMatch(/earlier session/i);

    // Both runs belong to one session on disk.
    const transcript = appStore.getSessionTranscript('s_resume');
    expect(transcript?.sessionId).toBe('s_resume');
    expect(transcript?.timeline.some((item) => String(item.content).includes('plumbus'))).toBe(true);
  });

  it('starts clean when the session id is new', async () => {
    const seen: any[][] = [];
    providerManager.setProviderInstance(PROVIDER_ID, {
      id: PROVIDER_ID,
      name: 'Test Provider',
      async listModels() {
        return [];
      },
      async testConnection() {
        return { success: true };
      },
      async streamChat(req: any, onChunk: (chunk: any) => void) {
        seen.push(req.messages);
        onChunk({ content: 'Hello.' });
        onChunk({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
      }
    } as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'A brand new task',
      mode: 'build',
      projectPath,
      sessionId: `s_fresh_${Date.now()}`
    });

    // Nothing older than this run is replayed into the model's context.
    const contents = seen[0].map((message) => message.content).join('\n');
    expect(contents).toContain('A brand new task');
    expect(contents).not.toContain('plumbus');
    expect(timelineOf(events).some((item) => /Loaded .* event/i.test(String(item.content)))).toBe(false);
    expect(timelineOf(events).some((item) => item.type === 'message' && item.title === 'User Prompt')).toBe(false);
  });
});

describe('agent runtime — a stale failure record does not stick', () => {
  const warning = (events: CapturedEvent[]) =>
    timelineOf(events).filter((item) => item.title === 'Provider last failed its test');

  it('warns once about a failed test, then clears the record after a real success', async () => {
    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([]) as any);

    // What one failed connection test leaves behind on the provider.
    appStore.updateProviderMeta(PROVIDER_ID, {
      status: 'error',
      lastTestedAt: Date.now(),
      lastError: 'Request is missing x-opencode-session and cannot be routed'
    });

    const first = createWindow();
    await agentRuntime.run(first.win, { prompt: 'Say hello', mode: 'build', projectPath, sessionId: 's_heal_1' });

    // The warning names the old failure, including its original reason.
    expect(warning(first.events)).toHaveLength(1);
    expect(String(warning(first.events)[0].content)).toContain('x-opencode-session');

    // The request answered, so the provider is no longer "failed".
    const stored = appStore.getProviders().find((p) => p.id === PROVIDER_ID);
    expect(stored?.status).toBe('connected');
    expect(stored?.lastError).toBeUndefined();

    const second = createWindow();
    await agentRuntime.run(second.win, { prompt: 'Say hello again', mode: 'build', projectPath, sessionId: 's_heal_2' });
    expect(warning(second.events)).toHaveLength(0);
  });

  it('says nothing about a failure old enough that the hub no longer shows it', async () => {
    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([]) as any);

    // Eleven minutes after the failed test, the hub treats the provider as merely
    // untested — the agent must not contradict that with a stale warning.
    appStore.updateProviderMeta(PROVIDER_ID, {
      status: 'error',
      lastTestedAt: Date.now() - 11 * 60_000,
      lastError: 'Request is missing x-opencode-session and cannot be routed'
    });
    expect(appStore.getProviders().find((p) => p.id === PROVIDER_ID)?.status).not.toBe('error');

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Say hello', mode: 'build', projectPath, sessionId: 's_heal_stale' });
    expect(warning(events)).toHaveLength(0);
  });
});

/**
 * Approving a plan is a scope decision, not just a yes (spec §35).
 *
 * These pin the three answers the card offers — run everything, run step by
 * step, run only the first step — plus the step gate itself, because a gate that
 * does not actually hold would let an agent run past the approval the user
 * thought they were giving.
 */
describe('agent runtime — plan scope', () => {
  const planCards = (events: CapturedEvent[]) =>
    timelineOf(events).filter((item) => item.type === 'plan' && item.details?.summary);
  const stepGates = (events: CapturedEvent[]) =>
    timelineOf(events).filter((item) => item.type === 'plan' && item.details?.kind === 'step_gate');

  /**
   * Two build steps that only read the project, then a text-only finish.
   *
   * The steps have to really execute: the gate sits at the end of a completed
   * step, so a step that errors out would end the run before it could hold.
   */
  const stepwiseScript = () => [
    [],
    [{ id: 'call_1', name: 'list_directory', args: { path: '.' } }],
    [{ id: 'call_2', name: 'list_directory', args: { path: '.' } }],
    []
  ] as ToolCall[][];

  it('stops after the first step when the user approves only the first step', async () => {
    const provider = new ScriptedProvider(stepwiseScript());
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Do the work', mode: 'plan', projectPath, sessionId: 's_scope_first' });

    await waitFor(() => planCards(events).length === 1);
    agentRuntime.approvePlan('first');

    await waitFor(() => stepGates(events).length === 1);

    // The gate must hold: planning + exactly one build step, and no more.
    expect(provider.calls).toBe(2);
    expect(statusEvents(events).at(-1)).toBe('paused');

    // Let the loop run on; without the gate this would finish the whole plan.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(provider.calls).toBe(2);

    // "Run the rest" drops the gate for the remainder of the plan.
    expect(agentRuntime.resolvePlanStep('runAll')).toBe(true);
    await run;
    expect(stepGates(events)).toHaveLength(1);
    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('pauses at every step when the plan is approved step by step', async () => {
    const provider = new ScriptedProvider(stepwiseScript());
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Do the work', mode: 'plan', projectPath, sessionId: 's_scope_step' });

    await waitFor(() => planCards(events).length === 1);
    agentRuntime.approvePlan('step');

    await waitFor(() => stepGates(events).length === 1);
    agentRuntime.resolvePlanStep('continue');

    await waitFor(() => stepGates(events).length === 2);
    expect(provider.calls).toBe(3);

    // Stopping here must end the run where it stands rather than cancelling it.
    agentRuntime.resolvePlanStep('stop');
    await run;

    expect(statusEvents(events).at(-1)).toBe('paused');
    expect(provider.calls).toBe(3);
    expect(timelineOf(events).some((item) => item.type === 'message' && /Stopped at your request/.test(item.title))).toBe(
      true
    );
  });

  it('runs the whole plan with no gate when approval scope is full', async () => {
    const provider = new ScriptedProvider(stepwiseScript());
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Do the work', mode: 'plan', projectPath, sessionId: 's_scope_full' });

    await waitFor(() => planCards(events).length === 1);
    agentRuntime.approvePlan('full');
    await run;

    expect(stepGates(events)).toHaveLength(0);
    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('sends the plan back for revision instead of cancelling the task', async () => {
    const provider = new ScriptedProvider([[], [], []]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Plan the work', mode: 'plan', projectPath, sessionId: 's_revise' });

    await waitFor(() => planCards(events).length === 1);
    agentRuntime.revisePlan('split step 2 into two smaller steps');

    // A second planning pass produces a fresh card; the run is still alive.
    await waitFor(() => planCards(events).length === 2);
    expect(statusEvents(events)).toContain('planning');
    expect(statusEvents(events)).not.toContain('cancelled');

    agentRuntime.approvePlan('full');
    await run;
    expect(statusEvents(events).at(-1)).toBe('completed');
  });
});

/**
 * A provider that hangs until the run is stopped, the way a real one does while
 * it is waiting on the network.
 */
class HangingProvider {
  id = PROVIDER_ID;
  name = 'Hanging Provider';
  started = 0;

  async listModels() {
    return [];
  }

  async testConnection() {
    return { success: true };
  }

  async streamChat(request: any): Promise<void> {
    this.started += 1;
    await new Promise<void>((_resolve, reject) => {
      const signal: AbortSignal | undefined = request?.signal;
      if (signal?.aborted) {
        reject(new Error('This operation was aborted'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true });
    });
  }
}

describe('agent runtime — stopping a run', () => {
  /**
   * The bug this pins: `cancel()` aborted *and dropped* the controller, so every
   * cancellation guard read `undefined` and fell through to the provider-error
   * branch. The user who pressed stop (or approved until the session ended) saw
   * "provider error (This operation was aborted)" and no closing message — which
   * is indistinguishable from the work silently disappearing.
   */
  it('reports a stop as a stop, not as a provider failure', async () => {
    const provider = new HangingProvider();
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Do the work', mode: 'build', projectPath, sessionId: 's_stop' });

    await waitFor(() => provider.started > 0);
    agentRuntime.cancel();
    await run;

    expect(statusEvents(events).at(-1)).toBe('cancelled');
    expect(timelineOf(events).some((item) => /aborted/i.test(item.content || ''))).toBe(false);
    expect(timelineOf(events).some((item) => item.type === 'message' && /Run stopped/.test(item.title))).toBe(true);
  });

  it('answers a waiting approval dialog when the user switches to Full', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'write_file', args: { path: 'unblocked.txt', content: 'written' } }]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'Create unblocked.txt',
      mode: 'build',
      projectPath,
      sessionId: 's_unblock'
    });

    await waitFor(() => approvalRequests(events).length === 1);

    // What the settings handler does when permissionMode becomes 'full'.
    expect(agentRuntime.approveAllPending('approved', win)).toBe(1);
    await run;

    expect(fs.existsSync(path.join(projectPath, 'unblocked.txt'))).toBe(true);
    expect(statusEvents(events).at(-1)).toBe('completed');
    // Answering in main is not enough: the modal is the renderer's, and leaving
    // it up kept blocking the window the user had just unblocked.
    expect(approvalRequests(events).at(-1)).toBeNull();
  });

  it('reads the permission mode per tool call, so Full applies mid-run', async () => {
    providerManager.setProviderInstance(
      PROVIDER_ID,
      new ScriptedProvider([
        [{ id: 'call_1', name: 'write_file', args: { path: 'first.txt', content: 'one' } }],
        [{ id: 'call_2', name: 'write_file', args: { path: 'second.txt', content: 'two' } }]
      ]) as any
    );

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'Create two files',
      mode: 'build',
      projectPath,
      sessionId: 's_live_mode'
    });

    await waitFor(() => approvalRequests(events).length === 1);

    // The user changes the setting while the dialog is on screen, then approves.
    appStore.saveSettings({ permissionMode: 'full' });
    agentRuntime.resolveApproval(approvalRequests(events)[0].id, 'approved', 'write_file');
    await run;

    // The second write must not ask again: the mode is read live, not captured.
    expect(approvalRequests(events)).toHaveLength(1);
    expect(fs.existsSync(path.join(projectPath, 'second.txt'))).toBe(true);
    expect(statusEvents(events).at(-1)).toBe('completed');
  });

  it('keeps working when the session has already spent a lot of money', async () => {
    // Spending is a report, not a brake: an expensive month must never turn into
    // a run that refuses to start.
    const { usageService } = await import('../src/main/ai/usage/usage-service');
    usageService.record({
      id: `u_${Date.now()}`,
      sessionId: 's_spent',
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      inputTokens: 5_000_000,
      outputTokens: 500_000,
      estimatedCost: 480,
      status: 'completed',
      timestamp: Date.now()
    });

    providerManager.setProviderInstance(PROVIDER_ID, new ScriptedProvider([[]]) as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'Do the work', mode: 'build', projectPath, sessionId: 's_spent' });

    expect(statusEvents(events).at(-1)).toBe('completed');
    expect(timelineOf(events).some((item) => item.type === 'error')).toBe(false);
  });
});

/**
 * Cheap mode has to be a switch, not a sentence.
 *
 * `/thrift` used to expand into a paragraph asking the model to be careful: the
 * same prompt budget, the same step ceiling, the same reasoning effort, and a
 * slightly larger prompt to pay for. These pin that it now moves the engine —
 * the step ceiling comes down and the run says so in its own stats.
 */
describe('agent runtime — token economy', () => {
  const statsEvents = (events: CapturedEvent[]) =>
    events
      .filter((e) => e.channel === IPC_CHANNELS.AGENT_EVENT && e.payload?.type === 'stats')
      .map((e) => e.payload.stats);

  it('caps the step ceiling when cheap mode is on', async () => {
    appStore.saveSettings({ thriftMode: true, maxAgentSteps: 40 });
    // A tool call every step, so the run would go the whole 40 if uncapped.
    const provider = new ScriptedProvider(
      Array.from({ length: 40 }, (_, i) => [{ id: `c${i}`, name: 'list_directory', args: { path: '.' } }] as ToolCall[])
    );
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'Keep listing the directory',
      mode: 'build',
      projectPath,
      sessionId: 's_thrift_steps'
    });

    expect(provider.calls).toBeLessThanOrEqual(13);
    expect(
      timelineOf(events).some((item) => item.type === 'error' && /step ceiling|ขีดจำกัดจำนวนขั้นตอน/i.test(`${item.title} ${item.content}`))
    ).toBe(true);
    expect(statsEvents(events).at(-1)?.thrift).toBe(true);

    appStore.saveSettings({ thriftMode: false, maxAgentSteps: 30 });
  });

  it('stops at the per-run token ceiling and explains why', async () => {
    appStore.saveSettings({ thriftMode: false, maxAgentSteps: 40, runTokenBudget: 500 });
    const provider = new ScriptedProvider(
      Array.from({ length: 40 }, (_, i) => [{ id: `c${i}`, name: 'list_directory', args: { path: '.' } }] as ToolCall[])
    );
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'Keep going',
      mode: 'build',
      projectPath,
      sessionId: 's_token_cap'
    });

    // Every call bills 120 tokens, so a 500-token ceiling cannot survive many.
    expect(provider.calls).toBeLessThan(10);
    expect(
      timelineOf(events).some((item) => /token ceiling|งบโทเคน/i.test(`${item.title} ${item.content}`))
    ).toBe(true);
    expect(statusEvents(events).at(-1)).toBe('failed');

    appStore.saveSettings({ runTokenBudget: 0, maxAgentSteps: 30 });
  });
});

/**
 * What the agent knows before its first token.
 *
 * Two things the user asked for by name: the project should be remembered across
 * sessions, and the screen style should be chosen by the user rather than
 * invented. Both are only real if they reach the model, so these read the system
 * prompt the provider actually received.
 */
describe('agent runtime — what the model is told up front', () => {
  class CapturingProvider extends ScriptedProvider {
    public prompts: string[] = [];
    async streamChat(req: any, onChunk: (chunk: any) => void) {
      this.prompts.push(String(req.messages?.[0]?.content ?? ''));
      return super.streamChat(req, onChunk);
    }
  }

  it('carries the project memory into every request', async () => {
    writeProjectMemory(projectPath, '# Rental SaaS\n\nA Thai rental management product with invoices.');
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'Say hello', mode: 'build', projectPath, sessionId: 's_mem' });

    expect(provider.prompts.length).toBeGreaterThan(0);
    expect(provider.prompts[0]).toContain('A Thai rental management product with invoices.');
    expect(provider.prompts[0]).toContain('.d4ide/project.md');
  });

  it('applies the chosen screen style to UI work', async () => {
    writeProjectDesign(projectPath, { style: 'dark-premium', notes: 'keep the glow subtle' });
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'สร้างหน้า landing page ใหม่',
      mode: 'build',
      projectPath,
      sessionId: 's_design'
    });

    const prompt = provider.prompts[0];
    expect(prompt).toContain(DESIGN_PROFILES['dark-premium'].colors.accent);
    expect(prompt).toContain('keep the glow subtle');
    expect(prompt).toContain('Design system in force');
  });

  /**
   * A greeting is answered, not worked on.
   *
   * The prompt tells the agent to update `.d4ide/project.md` at the end of every
   * task; a project with no such file therefore turned "สวัสดีครับ" into a walk
   * through the codebase so the file could be written. Both halves matter: the
   * upkeep rule must be replaced *and* the directive must be present, because
   * saying nothing would leave the agent to infer what "every task" meant.
   */
  it('tells the agent a greeting is not a task, and stops asking for project memory', async () => {
    fs.rmSync(path.join(projectPath, '.d4ide', 'project.md'), { force: true });
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId: 's_hello' });

    const prompt = provider.prompts[0];
    expect(prompt).toContain('This message is not a task');
    expect(prompt).toContain('do not create or update .d4ide/project.md');
    // The upkeep rule is gone, not just outvoted: two rules disagreeing is how a
    // model ends up doing the survey and the summary anyway.
    expect(prompt).not.toContain('At the end of every task: update .d4ide/project.md');
  });

  /**
   * Records the tool list the provider was actually handed.
   *
   * `tools` is what makes a run capable of touching the project, so the test has
   * to look at the request, not at what the model said it would do.
   */
  class ToolAwareProvider extends ScriptedProvider {
    public offers: ({ name: string }[] | undefined)[] = [];
    async streamChat(req: any, onChunk: (chunk: any) => void) {
      this.offers.push(req.tools);
      return super.streamChat(req, onChunk);
    }
  }

  /**
   * The prompt asking the model to hold back is a request; withholding the tools
   * is what actually holds it. "สวัสดีครับ" was answered with git status, a folder
   * listing and a table of the project, so the guarantee is enforced here.
   */
  it('offers a greeting no tools at all', async () => {
    const provider = new ToolAwareProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId: 's_hello_tools' });

    expect(provider.offers.length).toBeGreaterThan(0);
    expect(provider.offers[0]?.length ?? 0).toBe(0);
  });

  it('still offers tools to real work, even after a greeting in the same session', async () => {
    // The withholding must be per-run: a greeting that muted the tools of the
    // next request would break the app rather than make it quieter.
    const provider = new ToolAwareProvider([[], []]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId: 's_mute_then_work' });
    await agentRuntime.run(win, {
      prompt: 'แก้บั๊กใน provider-usability.ts ให้หน่อย',
      mode: 'build',
      projectPath,
      sessionId: 's_mute_then_work'
    });

    expect(provider.offers[0]?.length ?? 0).toBe(0);
    expect(provider.offers[1]?.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * The run that answers is not shaped like the run that works.
   *
   * Withholding the tools stopped the survey; the rest of the over-answer was
   * the costume — four build steps to tick off, a build report under a two-line
   * reply, and "explore this project" chips offering work nobody asked for.
   */
  const todosEvents = (events: CapturedEvent[]) =>
    events
      .filter((event) => event.channel === IPC_CHANNELS.AGENT_EVENT && event.payload?.type === 'todos')
      .map((event) => event.payload.todos as { text: string; status: string }[]);

  const suggestionsSent = (events: CapturedEvent[]) =>
    events.some((event) => event.channel === IPC_CHANNELS.AGENT_EVENT && event.payload?.type === 'suggestions');

  it('shapes a greeting as an answer: one row of work, no build report, no chips', async () => {
    const provider = new ToolAwareProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const sessionId = 's_answer_shape';
    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId });

    const todos = todosEvents(events).at(-1)!;
    expect(todos).toHaveLength(1);
    expect(String(todos[0].text)).toMatch(/no task|ไม่ใช่งาน/);
    expect(todos[0].status).toBe('completed');

    expect(suggestionsSent(events)).toBe(false);

    // The report stored against the request says it answered, rather than
    // reporting "no files modified / no validation command ran" as an outcome.
    const record = appStore.getUsageRecords().filter((row) => row.sessionId === sessionId).pop();
    expect(String(record?.summary)).toMatch(/no files changed|ไม่ได้แก้ไฟล์/);
  });

  it('still gives real work the four build steps and its next-move chips', async () => {
    const provider = new ToolAwareProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'แก้บั๊กใน provider-usability.ts ให้หน่อย',
      mode: 'build',
      projectPath,
      sessionId: 's_work_shape'
    });

    const todos = todosEvents(events).at(-1)!;
    expect(todos).toHaveLength(4);
    expect(suggestionsSent(events)).toBe(true);
  });

  it('reads a lone "ทดสอบ" as an order, not a greeting', async () => {
    // The short-message trap made sharp by withholding: "ทดสอบ" is how users of
    // this app ask for the test suite, and a verdict of "small talk" now costs
    // them the tools rather than merely their tone.
    const provider = new ToolAwareProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'ทดสอบ', mode: 'build', projectPath, sessionId: 's_bare_test' });

    expect(provider.offers[0]?.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses a tool call that arrives anyway, so a greeting cannot touch the project', async () => {
    const target = path.join(projectPath, 'greeting.txt');
    fs.rmSync(target, { force: true });

    // A provider that answers from its own cached schema, ignoring the missing
    // tool list — the case the prompt alone could not stop.
    const provider = new ToolAwareProvider([
      [{ id: 'call_1', name: 'write_file', args: { path: 'greeting.txt', content: 'survey says' } }]
    ]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId: 's_hello_refuse' });

    expect(fs.existsSync(target)).toBe(false);
    // No approval card either: the run must not park on a decision about work
    // nobody asked for.
    expect(approvalRequests(events).length).toBe(0);
    const refused = timelineOf(events).find(
      (item) => item.type === 'tool_result' && String(item.content).includes('not a task')
    );
    expect(refused).toBeDefined();
    const audit = appStore.getToolAudit(50);
    expect(audit.some((entry) => entry.toolName === 'write_file' && entry.decision === 'rejected')).toBe(true);
  });

  it('does not open a plan card for a greeting in Plan mode', async () => {
    const provider = new ToolAwareProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'plan', projectPath, sessionId: 's_hello_plan' });

    expect(timelineOf(events).some((item) => item.type === 'plan')).toBe(false);
    expect(provider.offers[0]?.length ?? 0).toBe(0);
  });

  it('keeps the project-memory rule for real work', async () => {
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'แก้บั๊กใน provider-usability.ts ให้หน่อย',
      mode: 'build',
      projectPath,
      sessionId: 's_work'
    });

    const prompt = provider.prompts[0];
    expect(prompt).toContain('At the end of every task: update .d4ide/project.md');
    expect(prompt).not.toContain('This message is not a task');
  });

  it('raises the style chooser and holds the run until the user answers', async () => {
    // The tests share one project directory, and the previous case chose a
    // style; "not chosen yet" has to be genuinely unset.
    fs.rmSync(path.join(projectPath, '.d4ide', 'design.json'), { force: true });
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'ทำ UI หน้า dashboard ให้สวย ๆ',
      mode: 'build',
      projectPath,
      sessionId: 's_design_ask'
    });

    // The card must appear before any provider call is paid for.
    await waitFor(() => timelineOf(events).some((item) => item.type === 'design'));
    expect(provider.prompts.length).toBe(0);
    expect(statusEvents(events)).toContain('waiting_approval');

    // Answering it is what lets the run continue, and the answer is remembered.
    expect(agentRuntime.chooseDesignStyle('modern-saas')).toBe(true);
    await run;

    expect(readProjectDesign(projectPath).style).toBe('modern-saas');
    const prompt = provider.prompts[0];
    expect(prompt).toContain(DESIGN_PROFILES['modern-saas'].colors.accent);
    expect(prompt).toContain(DESIGN_PROFILES['modern-saas'].fonts.thai);
  });

  it('uses the full limits for an expensive session until /thrift is asked for', async () => {
    // The switch is the user's, and only the user's: a large bill on its own must
    // not quietly shrink the run — nothing about money moves the engine now.
    appStore.saveSettings({ thriftMode: false });
    const { usageService } = await import('../src/main/ai/usage/usage-service');
    usageService.record({
      id: `u_${Date.now()}`,
      sessionId: 's_no_auto_thrift',
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      inputTokens: 10_000,
      outputTokens: 500,
      estimatedCost: 95,
      status: 'completed',
      timestamp: Date.now()
    });

    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'Fix the SQL query that sums overdue invoices',
      mode: 'build',
      projectPath,
      sessionId: 's_no_auto_thrift'
    });

    expect(timelineOf(events).some((item) => /Thrift engaged automatically/i.test(item.title))).toBe(false);
    const stats = events
      .filter((e) => e.channel === IPC_CHANNELS.AGENT_EVENT && e.payload?.type === 'stats')
      .map((e) => e.payload.stats);
    expect(stats.at(-1)?.thrift).toBe(false);
  });

  it('asks on an interface order even when the prompt never says the word UI', async () => {
    // "เพิ่มหน้ารายงานยอดค้างชำระ" is an order to add a screen; it need not say
    // "UI", and it no longer needs the project to prove it holds components.
    fs.rmSync(path.join(projectPath, '.d4ide', 'design.json'), { force: true });
    const uiDir = path.join(projectPath, 'src', 'components');
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(path.join(uiDir, 'Card.tsx'), 'export const Card = () => null;\n', 'utf8');

    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, {
      prompt: 'เพิ่มหน้ารายงานยอดค้างชำระ',
      mode: 'build',
      projectPath,
      sessionId: 's_design_project'
    });

    await waitFor(() => timelineOf(events).some((item) => item.type === 'design'));
    expect(provider.prompts.length).toBe(0);

    agentRuntime.chooseDesignStyle('dark-premium');
    await run;
    expect(provider.prompts[0]).toContain(DESIGN_PROFILES['dark-premium'].colors.accent);

    fs.rmSync(path.join(projectPath, 'src'), { recursive: true, force: true });
    fs.rmSync(path.join(projectPath, '.d4ide', 'design.json'), { force: true });
  });

  it('does not stop a greeting for a style question, even in a project full of screens', async () => {
    // The card used to read the folder: any project with a `.tsx` in it raised
    // the question on every message, so "สวัสดีครับ" was answered with a style
    // picker. The decision is made on the request now.
    fs.rmSync(path.join(projectPath, '.d4ide', 'design.json'), { force: true });
    const uiDir = path.join(projectPath, 'src', 'components');
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(path.join(uiDir, 'Card.tsx'), 'export const Card = () => null;\n', 'utf8');

    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'สวัสดีครับ',
      mode: 'build',
      projectPath,
      sessionId: 's_design_greeting'
    });

    expect(timelineOf(events).some((item) => item.type === 'design')).toBe(false);
    expect(provider.prompts.length).toBeGreaterThan(0);
    expect(provider.prompts[0]).not.toContain('Design system in force');

    fs.rmSync(path.join(projectPath, 'src'), { recursive: true, force: true });
  });

  it('does not stop a back-end order for a style question, even in a project full of screens', async () => {
    fs.rmSync(path.join(projectPath, '.d4ide', 'design.json'), { force: true });
    const uiDir = path.join(projectPath, 'src', 'components');
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(path.join(uiDir, 'Card.tsx'), 'export const Card = () => null;\n', 'utf8');

    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win, events } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'แก้บั๊กใน API ที่คืนค่า 500',
      mode: 'build',
      projectPath,
      sessionId: 's_design_backend'
    });

    expect(timelineOf(events).some((item) => item.type === 'design')).toBe(false);
    expect(provider.prompts.length).toBeGreaterThan(0);

    fs.rmSync(path.join(projectPath, 'src'), { recursive: true, force: true });
  });

  it('leaves back-end work alone — no design brief where there is no interface', async () => {
    const provider = new CapturingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, provider as any);

    const { win } = createWindow();
    await agentRuntime.run(win, {
      prompt: 'Fix the SQL query that sums overdue invoices',
      mode: 'build',
      projectPath,
      sessionId: 's_no_design'
    });

    expect(provider.prompts[0]).not.toContain('Design system in force');
  });
});

/**
 * The AI team: one job, three seats.
 *
 * The seat assignment lives in settings as `provider:model`. What these tests
 * buy is the guarantee that the *request* actually travels to the assigned
 * model — not that the settings were read — because a seat that is configured
 * but silently ignored looks identical to one that is working.
 */
describe('agent runtime — AI team (model per role)', () => {
  const TEAM_PROVIDER_ID = 'team-provider';
  const TEAM_MODEL_ID = 'team-analyst-x';

  /** Records which model every request asked for. */
  class ModelRecordingProvider extends ScriptedProvider {
    public requestedModels: string[] = [];
    async streamChat(req: any, onChunk: (chunk: any) => void) {
      this.requestedModels.push(String(req.model ?? ''));
      return super.streamChat(req, onChunk);
    }
  }

  beforeEach(() => {
    // The seat's provider must exist and be enabled, or teamSeat (deliberately)
    // nulls it — so the fixture registers it like a real second provider.
    const providers = appStore.getProviders();
    appStore.saveProviders([
      ...providers,
      {
        id: TEAM_PROVIDER_ID,
        name: 'Team Provider',
        type: 'custom',
        enabled: true,
        baseUrl: 'http://127.0.0.1:9/v1',
        requiresApiKey: false,
        models: [
          {
            id: TEAM_MODEL_ID,
            name: 'Team Model',
            providerId: TEAM_PROVIDER_ID,
            supportsTools: true,
            supportsVision: false,
            inputPricePerMillion: 1,
            outputPricePerMillion: 2,
            cachedInputPricePerMillion: 0
          }
        ]
      }
    ]);
    providerManager.reloadProviders();
  });

  it('sends plan-mode requests to the planner seat', async () => {
    appStore.saveSettings({ aiTeam: { planner: `${TEAM_PROVIDER_ID}:${TEAM_MODEL_ID}`, analyst: '', executor: '' } });
    const planner = new ModelRecordingProvider([[]]);
    const main = new ModelRecordingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, main as any);
    providerManager.setProviderInstance(TEAM_PROVIDER_ID, planner as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Plan a change', mode: 'plan', projectPath, sessionId: 's_team_plan' });
    await waitFor(() => timelineOf(events).some((item) => item.type === 'plan'));
    agentRuntime.approvePlan();
    await run;

    // Every planning request went to the seat, and every post-approval build
    // request stayed on the main model (the executor seat is empty here) — the
    // two lists never mix, which is the actual routing guarantee.
    expect(planner.requestedModels.length).toBeGreaterThan(0);
    expect(planner.requestedModels.every((m) => m === TEAM_MODEL_ID)).toBe(true);
    expect(main.requestedModels.every((m) => m === MODEL_ID)).toBe(true);
    // The run says which model wrote the plan, so the user is never guessing.
    expect(
      timelineOf(events).some((item) => /AI Team/.test(item.title) && /team-provider\/team-analyst-x/.test(item.content))
    ).toBe(true);
  });

  it('keeps the executor seat away from a greeting — a greeting is not work', async () => {
    appStore.saveSettings({ aiTeam: { planner: '', analyst: '', executor: `${TEAM_PROVIDER_ID}:${TEAM_MODEL_ID}` } });
    const executor = new ModelRecordingProvider([[]]);
    const main = new ModelRecordingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, main as any);
    providerManager.setProviderInstance(TEAM_PROVIDER_ID, executor as any);

    const { win } = createWindow();
    await agentRuntime.run(win, { prompt: 'สวัสดีครับ', mode: 'build', projectPath, sessionId: 's_team_hello' });

    expect(main.requestedModels.length).toBeGreaterThan(0);
    expect(executor.requestedModels).toHaveLength(0);
  });

  it('falls back to the main model when a seat names a disabled provider', async () => {
    appStore.saveSettings({ aiTeam: { planner: 'missing-provider:some-model', analyst: '', executor: '' } });
    const main = new ModelRecordingProvider([[]]);
    providerManager.setProviderInstance(PROVIDER_ID, main as any);

    const { win, events } = createWindow();
    const run = agentRuntime.run(win, { prompt: 'Plan a change', mode: 'plan', projectPath, sessionId: 's_team_fallback' });
    await waitFor(() => timelineOf(events).some((item) => item.type === 'plan'));
    agentRuntime.approvePlan();
    await run;

    // One typo in Settings must cost a seat, not the run.
    expect(main.requestedModels.length).toBeGreaterThan(0);
  });
});
