import { create } from 'zustand';
import i18n from '../lib/i18n';
import { toast } from './toastStore';
import { useSettingsStore } from './settingsStore';

/**
 * The renderer's side of the local-LLM nudge.
 *
 * The main process probes `localhost:11434` once per launch and pushes an
 * offer; this store holds it, turns the acceptance into the same
 * `localProvidersEnabled` flip the composer's toggle writes, and records
 * "not now" so the question is never asked again. Like everything local:
 * detecting is the app's job, deciding stays the user's.
 */
interface LocalLlmState {
  offer: { vendor: string; modelCount: number } | null;
  /** The user answered, so the banner stays gone for this session too. */
  dismissed: boolean;
  /** Acceptance is in flight (settings write + provider test). */
  busy: boolean;
  start: () => void;
  accept: () => Promise<void>;
  dismiss: () => Promise<void>;
}

export const useLocalLlmStore = create<LocalLlmState>((set, get) => ({
  offer: null,
  dismissed: false,
  busy: false,

  /** Subscribe once; the main process decides *whether* an offer is ever pushed. */
  start: () => {
    if (!window.electronAPI?.onLocalLlmFound) return;
    window.electronAPI.onLocalLlmFound((offer) => {
      if (!get().dismissed) set({ offer });
    });
  },

  accept: async () => {
    if (!window.electronAPI?.enableLocalLlm || get().busy) return;
    set({ busy: true });
    try {
      const { settings, providers } = await window.electronAPI.enableLocalLlm();
      // The response is the same sanitized shape the other provider paths
      // return — adopt it wholesale so the hub, the picker and the AI team
      // all see Ollama's models on the next render.
      useSettingsStore.getState().applyProviders(providers);
      const current = useSettingsStore.getState().settings;
      if (settings) useSettingsStore.setState({ settings: { ...(current ?? {}), ...settings } });
      set({ offer: null, dismissed: true });
      toast.success(i18n.t('localLlm.enabled'), i18n.t('localLlm.enabledDetail'));
    } finally {
      set({ busy: false });
    }
  },

  dismiss: async () => {
    set({ offer: null, dismissed: true });
    // Written down so the next launch does not ask again — "not now" means "not
    // ever", or the nudge becomes the nag.
    await useSettingsStore.getState().updateSettings({ localLlmPromptDismissedAt: Date.now() });
  }
}));
