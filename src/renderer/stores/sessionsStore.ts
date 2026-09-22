import { create } from 'zustand';
import { SessionSummary } from '../../shared/types';
import { useAgentStore } from './agentStore';
import { useProjectStore } from './projectStore';
import { useSettingsStore } from './settingsStore';
import { buildStrip, moveInOrder, StripTab } from '../lib/session-order';
import { samePath } from '../lib/paths';

/**
 * Open sessions, presented the way a browser presents tabs (spec §45).
 *
 * A tab is a *view* of a stored session, not a second copy of it: selecting a
 * tab replays that session's transcript into the agent view, and every new
 * prompt keeps writing to the session the active tab points at. Closing a tab
 * only forgets the view — nothing is deleted until the user deletes the session
 * from Settings, and a closed tab stays closed across refreshes.
 *
 * The order is stable: entries run by creation time and selecting one leaves it
 * exactly where it was, because a strip that reshuffles itself under the cursor
 * means the entry you were reaching for has already moved. The user can drag an
 * entry somewhere else, and that order is remembered (`sessionOrder` in the
 * settings file) rather than kept in this process.
 */
export interface SessionTab extends StripTab {
  title: string;
  projectPath?: string;
}

/**
 * The tab a renderer-only preview shows when there is no Electron bridge.
 *
 * It exists because that mode has no stored sessions at all — not as a
 * placeholder for a real one.
 */
const LOCAL_TAB_ID = '__local__';

/**
 * A tab the user opened with the +, which has no session behind it yet.
 *
 * This is the difference between a tab and a session: a session is something the
 * database knows about, and a draft is a place the user is about to write one.
 * It exists *only* because somebody pressed + — never at launch and never after
 * the last tab is closed, which is what the strip used to do wrong. The moment
 * the first prompt mints a session id, the draft is replaced by that session in
 * the same slot. Nothing is stored for a draft, and closing one keeps nothing.
 */
const DRAFT_PREFIX = '__draft__';
let draftCounter = 0;

/** True for a tab that stands for no stored session: a draft, or the preview. */
export const isUnsavedTab = (id: string): boolean => id.startsWith('__');

interface SessionsState {
  tabs: SessionTab[];
  activeId: string | null;
  /** Tabs opened with the + that no session has been written to yet. */
  drafts: SessionTab[];
  /**
   * The folder the drafts were opened in.
   *
   * An empty tab belongs to the project that was open when the + was pressed, so
   * opening a different folder drops them: a blank tab carried across projects
   * would be a tab with no project to write into.
   */
  draftsProject: string | null;
  /** Tabs the user closed; they are not resurrected by the next refresh. */
  closedIds: string[];
  /** The order the user dragged into place, oldest first. */
  order: string[];
  /** Pulls the stored session list and keeps the current session pinned. */
  refresh: (activeId?: string | null, fallbackTitle?: string) => Promise<void>;
  /**
   * Opens a new tab, the way a browser does: empty, selected, and independent of
   * the conversation that was on screen — which keeps its own tab and its own
   * transcript exactly where it was.
   */
  newTab: () => void;
  select: (id: string | null) => Promise<boolean>;
  close: (id: string) => void;
  /**
   * Keeps one tab and forgets the rest of the views.
   *
   * Closing a tab only forgets a *view* — the sessions stay in the database — so
   * "close the others" is safe to offer: it is the same act repeated, not a
   * deletion. Without it, tidying up a strip of fifteen open conversations is
   * fifteen clicks.
   */
  closeOthers: (id: string) => void;
  /** Renames a stored session — the strip first, then the database. */
  rename: (id: string, title: string) => Promise<void>;
  /** Puts a closed session back in the strip, wherever it is opened from. */
  reopen: (id: string) => void;
  setActive: (id: string | null) => void;
  /** Puts `movingId` where `targetId` is, and remembers it. */
  reorder: (movingId: string, targetId: string) => void;
}

const label = (session: SessionSummary): string => {
  const title = (session.title || '').trim();
  if (title) return title;
  const project = session.projectPath ? session.projectPath.split(/[/\\]/).pop() : '';
  return project || session.id;
};

/** The persisted drag order, if the settings file has one. */
function storedOrder(): string[] {
  const order = useSettingsStore.getState().settings?.sessionOrder;
  return Array.isArray(order) ? order : [];
}

/**
 * Sessions the user closed in an earlier run of the app.
 *
 * Reading this on every refresh (rather than once at import) matters: the
 * settings file arrives after the store is created, so a store built only from
 * memory would show every closed tab again on the first refresh of a launch.
 */
function storedClosed(): string[] {
  const ids = useSettingsStore.getState().settings?.closedSessionIds;
  return Array.isArray(ids) ? ids : [];
}

/** Writes the closed list back so it survives a reload and a restart. */
function persistClosed(ids: string[]): void {
  void useSettingsStore.getState().updateSettings({ closedSessionIds: ids });
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  tabs: [],
  activeId: null,
  drafts: [],
  draftsProject: null,
  closedIds: [],
  order: storedOrder(),

  refresh: async (activeId, fallbackTitle = 'D4IDE') => {
    const api = window.electronAPI;
    if (!api) {
      // Renderer-only preview: keep the strip honest instead of empty.
      set({ tabs: [{ id: LOCAL_TAB_ID, title: fallbackTitle }], activeId: LOCAL_TAB_ID, drafts: [], draftsProject: null });
      return;
    }

    let sessions: SessionSummary[] = [];
    try {
      sessions = (await api.listSessions()) || [];
    } catch {
      sessions = [];
    }

    const closedIds = Array.from(new Set([...get().closedIds, ...storedClosed()]));
    // Closed sessions stay closed, and the strip only lists the project that is
    // open: the database holds every session of every project, so showing them
    // all made choosing a folder look like it had reopened everything.
    const project = useProjectStore.getState().projectPath;
    const { tabs: previous, order, activeId: previousActive } = get();
    const drafts = project === get().draftsProject ? get().drafts : [];
    const known = new Map(previous.map((tab) => [tab.id, tab]));
    const stored: SessionTab[] = sessions
      .filter((session) => !closedIds.includes(session.id))
      .filter((session) => !project || samePath(session.projectPath, project))
      .map((session) => ({
        id: session.id,
        title: label(session),
        projectPath: session.projectPath,
        createdAt: session.createdAt
      }));

    // The live session is the one the agent view is talking in. It is kept — but
    // at its own position, not at the front. A session the user closed is *not*
    // live any more: pinning it back was how a closed tab returned.
    //
    // With no live session there is no tab at all. The strip used to end with a
    // placeholder for "the session the + would make", which put a session on
    // screen at launch and after the last tab was closed — a conversation nobody
    // had started. Nothing is open, so nothing is listed; the first prompt mints
    // the id and the tab appears then.
    const live: SessionTab | null = activeId && !closedIds.includes(activeId)
      ? {
          id: activeId,
          title: known.get(activeId)?.title || currentTitle() || fallbackTitle,
          // A session that has just been minted is not stored yet, so it has no
          // project of its own: it belongs to the folder that is open.
          projectPath: known.get(activeId)?.projectPath ?? project ?? undefined,
          createdAt: known.get(activeId)?.createdAt ?? sessions.find((s) => s.id === activeId)?.createdAt
        }
      : null;

    // A draft is where a new session lands: the tab stays exactly where it is
    // and the real conversation takes its slot. The draft being typed in is the
    // one consumed; failing that (the user switched tabs mid-answer) a brand new
    // session takes the last empty tab, which is the one that would have held it.
    const liveIsNew = live != null && !previous.some((tab) => tab.id === live.id);
    const consumed = !live
      ? null
      : drafts.some((draft) => draft.id === previousActive)
        ? previousActive
        : liveIsNew && drafts.length > 0
          ? drafts[drafts.length - 1].id
          : null;
    const keptDrafts = drafts.filter((draft) => draft.id !== consumed);

    const tabs = [...buildStrip(stored, order, live), ...keptDrafts];
    const active = keptDrafts.some((draft) => draft.id === previousActive) ? previousActive : live?.id ?? null;
    set({ tabs, drafts: keptDrafts, draftsProject: project ?? null, activeId: active, closedIds });
  },

  newTab: () => {
    const draft: SessionTab = { id: `${DRAFT_PREFIX}${++draftCounter}`, title: '' };
    // Emptying the view is what makes the tab independent: what was on screen
    // belongs to its own tab, and switching back replays it from the database.
    useAgentStore.getState().clearSession();
    const project = useProjectStore.getState().projectPath ?? null;
    const drafts = [...get().drafts, draft];
    set({ drafts, draftsProject: project, tabs: [...get().tabs, draft], activeId: draft.id });
  },

  select: async (id) => {
    // "Nothing is open" is a state the strip can be in, and it has no tab: the
    // transcript clears and no badge is lit.
    if (!id) {
      useAgentStore.getState().clearSession();
      set({ activeId: null });
      return true;
    }
    // A tab with nothing behind it yet — a draft, or the renderer-only preview —
    // has no transcript to replay: selecting it shows the empty view.
    if (isUnsavedTab(id)) {
      if (get().activeId !== id) useAgentStore.getState().clearSession();
      set({ activeId: id });
      return true;
    }
    // Opening a session on purpose — from the strip, the rail or the session
    // list in Settings — is what "unclosed" means.
    get().reopen(id);
    // Only a no-op when the tab is already active *and* the view already holds
    // that session. After closing the active tab the highlight moves to the
    // next tab before the replay finishes, and comparing against `activeId`
    // alone made that replay skip — leaving the closed conversation on screen.
    if (id === get().activeId && id === useAgentStore.getState().sessionId) return true;

    const resumed = await useAgentStore.getState().resumeSession(id);
    if (resumed) set({ activeId: id });
    return resumed;
  },

  close: (id) => {
    const { tabs, activeId, closedIds, drafts } = get();
    // A draft, and the preview tab of a renderer-only session, are not stored
    // ones: closing them forgets a view, and there is nothing to close on disk.
    const remaining = tabs.filter((tab) => tab.id !== id);
    const nextDrafts = drafts.filter((draft) => draft.id !== id);
    const nextClosed = isUnsavedTab(id) ? closedIds : Array.from(new Set([...closedIds, id]));
    const successor = remaining[0];
    set({
      tabs: remaining,
      drafts: nextDrafts,
      closedIds: nextClosed,
      activeId: activeId === id ? successor?.id ?? null : activeId
    });
    if (!isUnsavedTab(id)) persistClosed(nextClosed);

    if (activeId !== id) return;
    if (successor && successor.id !== LOCAL_TAB_ID) {
      void get().select(successor.id);
      return;
    }
    // Nothing left to show. Without this the transcript of the session that was
    // just closed stayed on screen — it looked like the close had not happened —
    // and the strip stays empty rather than growing a session nobody opened.
    useAgentStore.getState().clearSession();
    set({ activeId: successor?.id ?? null });
  },

  reopen: (id) => {
    const { closedIds } = get();
    if (!closedIds.includes(id)) return;
    const next = closedIds.filter((entry) => entry !== id);
    set({ closedIds: next });
    persistClosed(next);
  },

  closeOthers: (id) => {
    const { tabs, closedIds, drafts } = get();
    const keep = tabs.find((tab) => tab.id === id);
    if (!keep) return;
    const forgotten = tabs
      .filter((tab) => tab.id !== id && !isUnsavedTab(tab.id))
      .map((tab) => tab.id);
    const nextClosed = Array.from(new Set([...closedIds, ...forgotten]));
    set({ tabs: [keep], drafts: drafts.filter((draft) => draft.id === id), closedIds: nextClosed, activeId: id });
    persistClosed(nextClosed);
    void get().select(id);
  },

  /**
   * A rename is visible immediately in the strip and survives refresh because
   * the stored session row is updated too: the next run would otherwise write
   * its auto title back over the user's name.
   */
  rename: async (id, title) => {
    const clean = title.trim();
    if (!clean) return;
    set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, title: clean } : tab)) });

    const api = window.electronAPI;
    if (!api || id.startsWith('__')) return;
    try {
      const sessions: SessionSummary[] = (await api.listSessions()) || [];
      const session = sessions.find((s: SessionSummary) => s.id === id);
      if (session) await api.upsertSession({ ...session, title: clean });
    } catch {
      // The strip already shows the new name; the write is retried on the next
      // rename rather than surfacing an error for a cosmetic change.
    }
  },

  /**
   * Points the highlight at a session — or at nothing.
   *
   * `null` is a real state: no conversation is open, so no tab is lit and the
   * empty state is what the user sees. It used to be folded into a placeholder
   * tab, which is how a session that had never been started ended up on screen.
   */
  setActive: (activeId) => set({ activeId }),

  /**
   * A drag writes the order of what is on screen, then saves it. The full id
   * list is stored rather than a delta, so a strip whose contents changed since
   * the drag still lands somewhere sensible.
   */
  reorder: (movingId, targetId) => {
    const { tabs } = get();
    const ids = tabs.map((tab) => tab.id);
    const next = moveInOrder(ids, movingId, targetId);
    if (next.join('|') === ids.join('|')) return;

    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    set({ tabs: next.map((id) => byId.get(id)!).filter(Boolean), order: next });
    void useSettingsStore.getState().updateSettings({ sessionOrder: next });
  }
}));

function currentTitle(): string {
  const lastPrompt = [...useAgentStore.getState().timeline]
    .reverse()
    .find((item) => item.title === 'User Prompt' && item.content);
  return lastPrompt?.content?.trim().slice(0, 40) ?? '';
}
