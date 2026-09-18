import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionsStore } from '../src/renderer/stores/sessionsStore';
import { useAgentStore } from '../src/renderer/stores/agentStore';
import { SessionSummary } from '../src/shared/types';

const session = (id: string, title: string, updatedAt = 0): SessionSummary => ({
  id,
  title,
  projectPath: 'F:\\D4IDE',
  providerId: 'p',
  modelId: 'm',
  createdAt: 0,
  updatedAt,
  status: 'completed'
});

function installBridge(sessions: SessionSummary[]) {
  (globalThis as any).window = globalThis.window ?? {};
  (globalThis as any).window.electronAPI = {
    listSessions: vi.fn(async () => sessions)
  };
}

const resetStore = () =>
  useSessionsStore.setState({ tabs: [], activeId: null, closedIds: [] });

describe('session rename', () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({ sessionId: null, timeline: [] });
  });

  it('renames the tab immediately and persists through upsertSession', async () => {
    installBridge([session('s1', 'Fix the tests')]);
    const upsert = vi.fn(async () => undefined);
    (globalThis as any).window.electronAPI.upsertSession = upsert;

    await useSessionsStore.getState().refresh(null, 'D4IDE');
    await useSessionsStore.getState().rename('s1', '  Payment redesign  ');

    const tabs = useSessionsStore.getState().tabs;
    expect(tabs.find((t) => t.id === 's1')?.title).toBe('Payment redesign');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].title).toBe('Payment redesign');
    expect(upsert.mock.calls[0][0].id).toBe('s1');
  });

  it('keeps a renamed title across a refresh', async () => {
    installBridge([session('s1', 'Fix the tests')]);
    (globalThis as any).window.electronAPI.upsertSession = vi.fn(async () => undefined);

    await useSessionsStore.getState().refresh(null, 'D4IDE');
    await useSessionsStore.getState().rename('s1', 'Payment redesign');
    // The stored row now carries the new title, so a refresh keeps it.
    installBridge([session('s1', 'Payment redesign')]);
    await useSessionsStore.getState().refresh('s1');

    expect(useSessionsStore.getState().tabs.find((t) => t.id === 's1')?.title).toBe('Payment redesign');
  });

  it('ignores an empty name', async () => {
    installBridge([session('s1', 'Fix the tests')]);
    const upsert = vi.fn(async () => undefined);
    (globalThis as any).window.electronAPI.upsertSession = upsert;

    await useSessionsStore.getState().refresh(null, 'D4IDE');
    await useSessionsStore.getState().rename('s1', '   ');

    expect(useSessionsStore.getState().tabs.find((t) => t.id === 's1')?.title).toBe('Fix the tests');
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('session tab strip', () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({ sessionId: null, timeline: [] });
  });

  it('shows a single local tab when there is no Electron bridge', async () => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electronAPI = undefined;
    await useSessionsStore.getState().refresh(null, 'D4IDE');
    expect(useSessionsStore.getState().tabs).toEqual([{ id: '__local__', title: 'D4IDE' }]);
    expect(useSessionsStore.getState().activeId).toBe('__local__');
  });

  it('lists stored sessions in creation order and puts a session it does not know about last', async () => {
    installBridge([session('s1', 'Fix the tests'), session('s2', 'Add a provider')]);
    await useSessionsStore.getState().refresh('s9');

    const state = useSessionsStore.getState();
    // The live session is kept, but it does not jump the queue: a strip that
    // reshuffles on every click moves the entry you were about to press.
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1', 's2', 's9']);
    expect(state.activeId).toBe('s9');
  });

  it('leaves every position alone when another session is selected', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two'), session('s3', 'Three')]);
    await useSessionsStore.getState().refresh('s2');
    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1', 's2', 's3']);

    useAgentStore.setState({ resumeSession: vi.fn(async () => true) });
    await useSessionsStore.getState().select('s3');
    await useSessionsStore.getState().refresh('s3');

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1', 's2', 's3']);
  });

  it('reorders and remembers the order the user dragged', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two'), session('s3', 'Three')]);
    await useSessionsStore.getState().refresh('s1');

    useSessionsStore.getState().reorder('s3', 's2');
    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1', 's3', 's2']);

    // A refresh (a new session saved elsewhere, say) must not undo the drag.
    await useSessionsStore.getState().refresh('s1');
    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1', 's3', 's2']);
  });

  it('does not resurrect a tab the user closed', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');

    useSessionsStore.getState().close('s2');
    await useSessionsStore.getState().refresh('s1');

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
  });

  it('falls back to the project folder when a session has no title', async () => {
    installBridge([session('s1', '')]);
    await useSessionsStore.getState().refresh(null);
    expect(useSessionsStore.getState().tabs[0].title).toBe('D4IDE');
  });

  it('selecting another tab replays that session', async () => {
    const resumeSession = vi.fn(async () => true);
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');
    useAgentStore.setState({ resumeSession });

    await useSessionsStore.getState().select('s2');

    expect(resumeSession).toHaveBeenCalledWith('s2');
    expect(useSessionsStore.getState().activeId).toBe('s2');
  });

  it('opens a visible new-session tab instead of adopting the newest stored one', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');

    // What the + button does: the agent store drops its session, then the strip
    // refreshes with no id. It used to fall back to the newest stored session, so
    // the highlighted tab never changed and the button looked dead.
    useAgentStore.setState({ sessionId: null, timeline: [] });
    await useSessionsStore.getState().refresh(null, 'เซสชันใหม่');

    const state = useSessionsStore.getState();
    // The placeholder is a *new* session, so it takes the newest slot rather than
    // shoving the stored ones aside.
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs[2]).toMatchObject({ id: '__new__', title: 'เซสชันใหม่' });
    expect(state.activeId).toBe('__new__');
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1', 's2', '__new__']);
  });

  it('returns to a new-session tab when the new-session tab is selected again', async () => {
    installBridge([session('s1', 'One')]);
    await useSessionsStore.getState().refresh('s1');
    const clearSession = vi.fn();
    useAgentStore.setState({ clearSession } as any);

    await useSessionsStore.getState().select('__new__');

    expect(clearSession).toHaveBeenCalled();
    expect(useSessionsStore.getState().activeId).toBe('__new__');
  });

  it('keeps the active tab when the session cannot be replayed', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');
    useAgentStore.setState({ resumeSession: vi.fn(async () => false) });

    await useSessionsStore.getState().select('s2');

    expect(useSessionsStore.getState().activeId).toBe('s1');
  });
});
