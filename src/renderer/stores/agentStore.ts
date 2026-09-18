import { create } from 'zustand';
import i18n from '../lib/i18n';
import {
  AgentMode,
  AgentStatus,
  AgentTimelineItem,
  AgentTodo,
  PlanData,
  PlanScope,
  PlanStepDecision,
  PromptImage,
  SessionSummary
} from '../../shared/types';
import { DesignStyle } from '../../shared/design-profiles';
import { useProjectStore } from './projectStore';

/** The last run that never finished — offered for recovery on startup (spec §84). */
interface RecoverableSession {
  session: SessionSummary;
  events: number;
}

/**
 * A prompt that is waiting for a project folder.
 *
 * The agent edits real files, so it cannot start without knowing which folder
 * to work in — but the user's message is never thrown away while it asks.
 */
export interface PendingSend {
  text: string;
  images?: PromptImage[];
}

interface AgentState {
  mode: AgentMode;
  status: AgentStatus;
  /** Wall clock when the current run started, for the "responding" timer. */
  runStartedAt: number | null;
  prompt: string;
  timeline: AgentTimelineItem[];
  todos: AgentTodo[];
  currentPlan: PlanData | null;
  /** The conversation currently in the agent view; prompts continue this session. */
  sessionId: string | null;
  recoverableSession: RecoverableSession | null;
  /** Set when a prompt was sent before any project folder was open. */
  pendingSend: PendingSend | null;

  setMode: (mode: AgentMode) => void;
  setPrompt: (text: string) => void;
  startAgent: (customPrompt?: string, images?: PromptImage[]) => Promise<void>;
  /** Abandons a prompt that was waiting for a folder (the draft is kept). */
  clearPendingSend: () => void;
  /** Sends the waiting prompt, now that a folder has been opened. */
  resumePendingSend: () => Promise<void>;
  cancelAgent: () => Promise<void>;
  approvePlan: (scope?: PlanScope) => Promise<void>;
  /** Sends the plan back with notes instead of approving or discarding it. */
  revisePlan: (feedback: string) => Promise<void>;
  rejectPlan: () => Promise<void>;
  /** Records the style picked from the design chooser and resumes the run. */
  chooseDesignStyle: (style: Exclude<DesignStyle, 'ask'>) => Promise<void>;
  /** Answers the gate between build steps (continue / run the rest / stop). */
  planStepDecision: (decision: PlanStepDecision) => Promise<void>;
  addTimelineItem: (item: AgentTimelineItem) => void;
  updateStatus: (status: AgentStatus) => void;
  setTodos: (todos: AgentTodo[]) => void;
  /** Starts a brand new session (the "New Session" action). */
  clearSession: () => void;
  /** Replays a stored session and keeps talking in it (spec §45). */
  resumeSession: (sessionId: string) => Promise<boolean>;
  /** Looks for an interrupted run left behind by a crash (spec §84). */
  checkForRecovery: () => Promise<void>;
  dismissRecovery: () => void;
}

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const RESUME_DIVIDER_ID = 'resume-divider';

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: 'build',
  status: 'idle',
  runStartedAt: null,
  prompt: '',
  timeline: [],
  todos: [],
  currentPlan: null,
  sessionId: null,
  recoverableSession: null,
  pendingSend: null,

  setMode: (mode: AgentMode) => set({ mode }),
  setPrompt: (prompt: string) => set({ prompt }),

  clearPendingSend: () => set({ pendingSend: null }),

  resumePendingSend: async () => {
    const pending = get().pendingSend;
    if (!pending) return;
    set({ pendingSend: null });
    await get().startAgent(pending.text, pending.images);
  },

  startAgent: async (customPrompt?: string, images?: PromptImage[]) => {
    const text = customPrompt ?? get().prompt;
    if ((!text.trim() && !images?.length) || !window.electronAPI) return;

    const projectPath = useProjectStore.getState().projectPath;
    if (!projectPath) {
      // Never `alert()` here. A native modal dialog is the one thing that can
      // leave a frameless window looking completely dead, and a silent no-op
      // reads as "the app is broken". Instead the shell asks for a folder in
      // its own UI and sends this very prompt the moment one is chosen.
      set({ pendingSend: { text, images } });
      return;
    }
    set({ pendingSend: null });

    const { mode, timeline } = get();
    // One session per conversation: every follow-up prompt continues it, so the
    // history, usage and transcript stay together (spec §45).
    const sessionId = get().sessionId ?? newSessionId();

    const userItem: AgentTimelineItem = {
      id: `user_${Date.now()}`,
      type: 'message',
      title: 'User Prompt',
      content: text,
      timestamp: Date.now()
    };

    set({
      timeline: [...timeline, userItem],
      prompt: '',
      status: mode === 'plan' ? 'planning' : 'running',
      runStartedAt: Date.now(),
      sessionId
    });

    try {
      await window.electronAPI.startAgent({
        prompt: text,
        mode,
        projectPath,
        sessionId,
        images
      });
    } catch (e) {
      console.error('Failed to start agent:', e);
      set({ status: 'failed', runStartedAt: null });
    }
  },

  cancelAgent: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.cancelAgent();
    set({ status: 'cancelled', runStartedAt: null });
  },

  approvePlan: async (scope: PlanScope = 'full') => {
    if (!window.electronAPI) return;
    await window.electronAPI.approvePlan(scope);
    set({ status: 'running', mode: 'build' });
  },

  revisePlan: async (feedback: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.revisePlan(feedback);
    set({ status: 'planning' });
  },

  rejectPlan: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.rejectPlan();
    set({ status: 'cancelled', runStartedAt: null });
  },

  chooseDesignStyle: async (style) => {
    if (!window.electronAPI?.chooseDesignStyle) return;
    await window.electronAPI.chooseDesignStyle(style);
    set({ status: 'running' });
  },

  planStepDecision: async (decision: PlanStepDecision) => {
    if (!window.electronAPI) return;
    await window.electronAPI.planStepDecision(decision);
    set({ status: decision === 'stop' ? 'paused' : 'running' });
  },

  addTimelineItem: (item: AgentTimelineItem) => {
    set((state) => ({
      timeline: [...state.timeline, item],
      // A step gate also arrives as a plan item, but it carries no plan body —
      // only a complete plan should replace the one on screen.
      currentPlan: item.type === 'plan' && item.details?.summary ? item.details : state.currentPlan
    }));
  },

  updateStatus: (status: AgentStatus) => set({ status }),
  setTodos: (todos: AgentTodo[]) => set({ todos }),

  clearSession: () =>
    set({
      timeline: [],
      todos: [],
      currentPlan: null,
      status: 'idle',
      runStartedAt: null,
      sessionId: null,
      recoverableSession: null
    }),

  resumeSession: async (sessionId: string) => {
    const api = window.electronAPI;
    if (!api) return false;

    const transcript = await api.getSessionTranscript(sessionId);
    if (!transcript) return false;

    // A resumed session belongs to its own project; switch over when it differs.
    const currentProject = useProjectStore.getState().projectPath;
    if (transcript.projectPath && transcript.projectPath !== currentProject) {
      const opened = await api.openProjectPath(transcript.projectPath).catch(() => false);
      if (opened) useProjectStore.getState().setProjectPath(transcript.projectPath);
    }

    const divider: AgentTimelineItem = {
      id: `${RESUME_DIVIDER_ID}_${Date.now()}`,
      type: 'thinking',
      title: i18n.t('agent.resumedTitle'),
      content: i18n.t('agent.resumedBody', {
        events: transcript.timeline.length,
        date: new Date(transcript.updatedAt).toLocaleString()
      }),
      timestamp: Date.now()
    };

    set({
      timeline: [...transcript.timeline, divider],
      todos: transcript.todos ?? [],
      currentPlan: transcript.plan ?? null,
      sessionId: transcript.sessionId,
      status: 'idle',
      runStartedAt: null,
      recoverableSession: null
    });

    return true;
  },

  checkForRecovery: async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const sessions = await api.listSessions();
      const latest: SessionSummary | undefined = sessions?.[0];
      if (!latest) return;

      const transcript = await api.getSessionTranscript(latest.id);
      // No transcript means nothing to restore; endedCleanly means it finished.
      if (!transcript || transcript.endedCleanly) return;

      set({ recoverableSession: { session: latest, events: transcript.timeline.length } });
    } catch (e) {
      console.warn('Session recovery check failed:', e);
    }
  },

  dismissRecovery: () => set({ recoverableSession: null })
}));
