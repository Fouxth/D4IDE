import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionsStore } from '../src/renderer/stores/sessionsStore';
import { useAgentStore } from '../src/renderer/stores/agentStore';
import { useProjectStore } from '../src/renderer/stores/projectStore';
import { useSettingsStore } from '../src/renderer/stores/settingsStore';
import { AppSettings, SessionSummary } from '../src/shared/types';

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
    listSessions: vi.fn(async () => sessions),
    updateSettings: vi.fn(async (partial: Partial<AppSettings>) => settingsWith(partial))
  };
}

const resetStore = () => {
  useSessionsStore.setState({ tabs: [], activeId: null, closedIds: [], drafts: [], draftsProject: null });
  useProjectStore.setState({ projectPath: null });
  useSettingsStore.setState({ settings: null });
};

/** The settings file as the updater sees it, so persistence can be asserted. */
function settingsWith(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    language: 'th',
    theme: 'd4-dark',
    fontSize: 14,
    permissionMode: 'safe',
    defaultMode: 'build',
    autoRunTests: true,
    autoRunBuild: true,
    maxAgentSteps: 30,
    activeProviderId: 'deepseek',
    activeModelId: 'deepseek-chat',
    routingProfile: 'balanced',
    reasoningEffort: 'medium',
    thriftMode: false,
    contextTokenBudget: 0,
    runTokenBudget: 0,
    cheaperModelForSmallTasks: false,
    cheapModelId: '',
    autoFallback: false,
    fallbackChain: [],
    toolTimeoutMs: 120000,
    retryLimit: 2,
    checkpointFrequency: 'write',
    favoriteModels: [],
    recentModels: [],
    recentProjects: [],
    sessionOrder: [],
    firstRunComplete: true,
    removedProviderIds: [],
    logLevel: 'info',
    desktopNotifications: true,
    designStyle: 'minimal',
    askDesignBeforeUiWork: true,
    projectMemoryEnabled: true,
    updateCheckEnabled: true,
    checkUpdatesOnLaunch: true,
    updateCheckIntervalHours: 6,
    lastUpdateCheckAt: 0,
    lastNotifiedVersion: '',
    skippedUpdateVersion: '',
    catalogCheckEnabled: true,
    catalogCheckIntervalHours: 24,
    lastCatalogCheckAt: 0,
    requireLogin: false,
    ...overrides
  };
}

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

  it('invents no tab for a conversation that has not started', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');

    // What the + button does: the agent store drops its session, then the strip
    // refreshes with no id. It used to append a `__new__` placeholder and light
    // it up, which is how a session nobody had opened ended up on the strip.
    useAgentStore.setState({ sessionId: null, timeline: [] });
    await useSessionsStore.getState().refresh(null, 'เซสชันใหม่');

    const state = useSessionsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1', 's2']);
    expect(state.activeId).toBeNull();
  });

  it('the + adds a tab of its own and leaves the others where they are', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');

    useSessionsStore.getState().newTab();

    const state = useSessionsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1', 's2', state.activeId]);
    expect(state.activeId).toMatch(/^__draft__/);
    // New, empty, and unnamed: a tab with nothing in it yet.
    expect(state.tabs.at(-1)?.title).toBe('');
    expect(state.drafts).toHaveLength(1);
  });

  it('empties the view for a new tab instead of overwriting the open conversation', () => {
    const clearSession = vi.fn();
    useAgentStore.setState({ clearSession } as any);

    useSessionsStore.getState().newTab();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(useSessionsStore.getState().tabs).toHaveLength(1);
  });

  it('hands the draft\'s slot to the session the first prompt creates', async () => {
    installBridge([session('s1', 'One')]);
    await useSessionsStore.getState().refresh('s1');
    useSessionsStore.getState().newTab();
    const draftId = useSessionsStore.getState().activeId!;

    // The prompt mints an id and the strip refreshes with it.
    await useSessionsStore.getState().refresh('s_fresh', 'เซสชันใหม่');

    const state = useSessionsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1', 's_fresh']);
    expect(state.activeId).toBe('s_fresh');
    expect(state.drafts).toHaveLength(0);
    expect(state.tabs.some((tab) => tab.id === draftId)).toBe(false);
  });

  it('closing a draft forgets the view and writes nothing to disk', async () => {
    installBridge([session('s1', 'One')]);
    await useSessionsStore.getState().refresh('s1');
    useSessionsStore.getState().newTab();
    const draftId = useSessionsStore.getState().activeId!;

    useSessionsStore.getState().close(draftId);

    const state = useSessionsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(['s1']);
    expect(state.drafts).toHaveLength(0);
    expect(state.closedIds).toEqual([]);
    expect((globalThis as any).window.electronAPI.updateSettings).not.toHaveBeenCalled();
  });

  it('drops empty tabs when a different project is opened', async () => {
    installBridge([session('s1', 'One')]);
    await useSessionsStore.getState().refresh('s1');
    useSessionsStore.getState().newTab();

    // A blank tab belongs to the folder it was opened in: carried across
    // projects it would be a tab with nowhere to write.
    useProjectStore.setState({ projectPath: 'F:\\another\\project' });
    await useSessionsStore.getState().refresh(null);

    expect(useSessionsStore.getState().drafts).toHaveLength(0);
    expect(useSessionsStore.getState().tabs).toEqual([]);
  });

  it('shows an empty strip when there is nothing stored and nothing live', async () => {
    installBridge([]);

    await useSessionsStore.getState().refresh(null, 'เซสชันใหม่');

    expect(useSessionsStore.getState().tabs).toEqual([]);
    expect(useSessionsStore.getState().activeId).toBeNull();
  });

  it('gives a brand new session the project that is open, so its badge can name it', async () => {
    useProjectStore.setState({ projectPath: 'F:\\work\\HuayD' });
    installBridge([]);

    // The first prompt mints the id; the row is not stored yet, so the tab has
    // no project of its own and must inherit the open folder.
    await useSessionsStore.getState().refresh('s_fresh', 'เซสชันใหม่');

    const tab = useSessionsStore.getState().tabs[0];
    expect(tab).toMatchObject({ id: 's_fresh', projectPath: 'F:\\work\\HuayD' });
    expect(useSessionsStore.getState().activeId).toBe('s_fresh');
  });

  it('clears the view and lights no tab when nothing is selected', async () => {
    installBridge([session('s1', 'One')]);
    await useSessionsStore.getState().refresh('s1');
    const clearSession = vi.fn();
    useAgentStore.setState({ clearSession } as any);

    await useSessionsStore.getState().select(null);

    expect(clearSession).toHaveBeenCalled();
    expect(useSessionsStore.getState().activeId).toBeNull();
  });

  it('keeps the active tab when the session cannot be replayed', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s1');
    useAgentStore.setState({ resumeSession: vi.fn(async () => false) });

    await useSessionsStore.getState().select('s2');

    expect(useSessionsStore.getState().activeId).toBe('s1');
  });
});

/**
 * The strip is one project's conversations, and a closed tab stays closed.
 *
 * Both were broken in the same way: `listSessions()` returns every session in
 * the database, the strip showed all of them, and `closedIds` lived only in this
 * process — so opening a project looked like it had undone every close, and a
 * window reload brought them all back.
 */
describe('session strip scoping and persistence', () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({ sessionId: null, timeline: [] });
  });

  it('lists only the sessions of the project that is open', async () => {
    useProjectStore.setState({ projectPath: 'F:\\D4IDE' });
    installBridge([
      session('s1', 'This project'),
      { ...session('s2', 'Another project'), projectPath: 'F:\\TestD4IDE' },
      { ...session('s3', 'Third'), projectPath: 'C:\\work\\acme' }
    ]);

    await useSessionsStore.getState().refresh(null);

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
  });

  it('compares project paths in either spelling', async () => {
    // Forward slashes and a trailing separator are the same folder. (Case is
    // normalised too, but only where the platform says paths are case-blind —
    // the test runner's user agent is not a Windows one.)
    useProjectStore.setState({ projectPath: 'F:/D4IDE/' });
    installBridge([{ ...session('s1', 'Same folder'), projectPath: 'F:\\D4IDE' }]);

    await useSessionsStore.getState().refresh(null);

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
  });

  it('shows every session while no project is open', async () => {
    installBridge([
      session('s1', 'One'),
      { ...session('s2', 'Two'), projectPath: 'F:\\Elsewhere' }
    ]);

    await useSessionsStore.getState().refresh(null);

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1', 's2']);
  });

  it('does not put a closed session back just because it is the live one', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s2');

    useSessionsStore.getState().close('s2');
    // The agent store still points at s2 until the switch finishes; refreshing in
    // that window used to re-pin it to the strip.
    await useSessionsStore.getState().refresh('s2');

    // The closed session is gone for good, and nothing takes its place: the tab
    // the user just closed never comes back, and no placeholder stands in for it.
    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
  });

  it('clears the conversation when the last tab is closed', async () => {
    installBridge([session('s1', 'Only one')]);
    await useSessionsStore.getState().refresh('s1');
    const clearSession = vi.fn();
    useAgentStore.setState({ clearSession } as any);

    useSessionsStore.getState().close('s1');

    // Without this the transcript of the session just closed stayed on screen.
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(useSessionsStore.getState().tabs).toEqual([]);
    // No session is open, so nothing is lit — not a stand-in for the next one.
    expect(useSessionsStore.getState().activeId).toBeNull();
  });

  it('selects what is left instead of clearing when other tabs remain', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    await useSessionsStore.getState().refresh('s2');
    const clearSession = vi.fn();
    const resumeSession = vi.fn(async () => true);
    useAgentStore.setState({ clearSession, resumeSession } as any);

    useSessionsStore.getState().close('s2');

    expect(clearSession).not.toHaveBeenCalled();
    expect(resumeSession).toHaveBeenCalledWith('s1');
  });

  it('remembers a close in the settings file', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    const updateSettings = vi.fn(async (partial: Partial<AppSettings>) => settingsWith(partial));
    (globalThis as any).window.electronAPI.updateSettings = updateSettings;
    useSettingsStore.setState({ settings: settingsWith() });
    await useSessionsStore.getState().refresh('s1');

    useSessionsStore.getState().close('s2');

    expect(updateSettings).toHaveBeenCalledWith({ closedSessionIds: ['s2'] });
  });

  it('hides a session closed in an earlier run, before anything is clicked', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two')]);
    useSettingsStore.setState({ settings: settingsWith({ closedSessionIds: ['s2'] }) });

    await useSessionsStore.getState().refresh(null);

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
    expect(useSessionsStore.getState().closedIds).toContain('s2');
  });

  it('un-closes a session that is opened on purpose, and says so on disk', async () => {
    installBridge([session('s1', 'One')]);
    const updateSettings = vi.fn(async (partial: Partial<AppSettings>) => settingsWith(partial));
    (globalThis as any).window.electronAPI.updateSettings = updateSettings;
    useSettingsStore.setState({ settings: settingsWith({ closedSessionIds: ['s1'] }) });
    useAgentStore.setState({ resumeSession: vi.fn(async () => true) } as any);

    await useSessionsStore.getState().refresh(null);
    await useSessionsStore.getState().select('s1');
    await useSessionsStore.getState().refresh('s1');

    expect(useSessionsStore.getState().tabs.map((tab) => tab.id)).toEqual(['s1']);
    expect(updateSettings).toHaveBeenCalledWith({ closedSessionIds: [] });
  });

  it('remembers the others when closing them all', async () => {
    installBridge([session('s1', 'One'), session('s2', 'Two'), session('s3', 'Three')]);
    const updateSettings = vi.fn(async (partial: Partial<AppSettings>) => settingsWith(partial));
    (globalThis as any).window.electronAPI.updateSettings = updateSettings;
    useSettingsStore.setState({ settings: settingsWith() });
    useAgentStore.setState({ resumeSession: vi.fn(async () => true), clearSession: vi.fn() } as any);
    await useSessionsStore.getState().refresh('s1');

    useSessionsStore.getState().closeOthers('s2');

    const persisted = updateSettings.mock.calls.find((call) => call[0].closedSessionIds)![0].closedSessionIds!;
    expect(persisted.sort()).toEqual(['s1', 's3']);
  });
});
