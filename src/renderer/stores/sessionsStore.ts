import { create } from 'zustand';
import { SessionSummary } from '../../shared/types';
import { useAgentStore } from './agentStore';
import { useSettingsStore } from './settingsStore';
import { buildStrip, moveInOrder, StripTab } from '../lib/session-order';

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
 * Tab standing for "a new session that has not been saved yet".
 *
 * `clearSession()` on the agent store leaves no session id at all, so the strip
 * showed nothing new and then quietly re-activated the newest stored session —
 * which is why pressing + looked like a dead button: the view cleared, but the
 * strip and the highlighted tab did not change. A placeholder tab gives that
 * state something visible to point at.
 */
const NEW_SESSION_TAB_ID = '__new__';

interface SessionsState {
  tabs: SessionTab[];
  activeId: string | null;
  /** Tabs the user closed; they are not resurrected by the next refresh. */
  closedIds: string[];
  /** The order the user dragged into place, oldest first. */
  order: string[];
  /** Pulls the stored session list and keeps the current session pinned. */
  refresh: (activeId?: string | null, fallbackTitle?: string) => Promise<void>;
  select: (id: string | null) => Promise<boolean>;
  close: (id: string) => void;
  /** Renames a stored session — the strip first, then the database. */
  rename: (id: string, title: string) => Promise<void>;
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

export const useSessionsStore = create<SessionsState>((set, get) => ({
  tabs: [],
  activeId: null,
  closedIds: [],
  order: storedOrder(),

  refresh: async (activeId, fallbackTitle = 'D4IDE') => {
    const api = window.electronAPI;
    if (!api) {
      // Renderer-only preview: keep the strip honest instead of empty.
      set({ tabs: [{ id: '__local__', title: fallbackTitle }], activeId: '__local__' });
      return;
    }

    let sessions: SessionSummary[] = [];
    try {
      sessions = (await api.listSessions()) || [];
    } catch {
      sessions = [];
    }

    const { closedIds, tabs: previous, order } = get();
    const known = new Map(previous.map((tab) => [tab.id, tab]));
    const stored: SessionTab[] = sessions
      .filter((session) => !closedIds.includes(session.id))
      .map((session) => ({
        id: session.id,
        title: label(session),
        projectPath: session.projectPath,
        createdAt: session.createdAt
      }));

    // The live session is the one the agent view is talking in, or the
    // placeholder standing for a brand new one. Either way it is kept — but at
    // its own position, not at the front.
    const live: SessionTab = activeId
      ? {
          id: activeId,
          title: known.get(activeId)?.title || currentTitle() || fallbackTitle,
          projectPath: known.get(activeId)?.projectPath,
          createdAt: known.get(activeId)?.createdAt ?? sessions.find((s) => s.id === activeId)?.createdAt
        }
      : { id: NEW_SESSION_TAB_ID, title: fallbackTitle };

    const tabs = buildStrip(stored, order, live);
    set({ tabs, activeId: live.id });
  },

  select: async (id) => {
    if (!id || id === NEW_SESSION_TAB_ID) {
      useAgentStore.getState().clearSession();
      set({ activeId: NEW_SESSION_TAB_ID });
      return true;
    }
    if (id === get().activeId) return true;

    const resumed = await useAgentStore.getState().resumeSession(id);
    if (resumed) set({ activeId: id });
    return resumed;
  },

  close: (id) => {
    const { tabs, activeId, closedIds } = get();
    // The placeholder tab of a renderer-only preview is not a real session.
    const remaining = tabs.filter((tab) => tab.id !== id);
    set({
      tabs: remaining,
      closedIds: id.startsWith('__') ? closedIds : [...closedIds, id],
      activeId: activeId === id ? remaining[0]?.id ?? null : activeId
    });

    if (activeId === id && remaining[0]) void get().select(remaining[0].id);
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
   * A "new space" leaves no session id at all. The strip must still point
   * somewhere: the placeholder tab is what the user sees as the room they just
   * opened, and an activeId of null would leave every tab unhighlighted until
   * the first prompt happened to refresh the strip.
   */
  setActive: (activeId) =>
    set((state) => ({
      activeId: activeId ?? state.tabs.find((tab) => tab.id === NEW_SESSION_TAB_ID)?.id ?? state.activeId
    })),

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
