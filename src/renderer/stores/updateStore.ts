import { create } from 'zustand';
import { UpdateStatus } from '../../shared/types';
import { APP_VERSION } from '../../shared/version';
import { shouldAnnounceUpdate } from '../../shared/update-policy';
import i18n from '../lib/i18n';
import { useSettingsStore } from './settingsStore';
import { toast } from './toastStore';

/**
 * The renderer's view of the updater.
 *
 * It listens and it announces; it never decides *when* to look, because that
 * schedule belongs to the main process and has to survive a window reload. The
 * two things this store does own are the ones that need language and the screen:
 * saying once that a newer build exists, and remembering that the user asked to
 * stop hearing about a particular one.
 *
 * Nothing here can install anything. Every button calls a main-process handler
 * that the user's click triggered.
 */
interface UpdateState {
  status: UpdateStatus;
  /** A user-triggered action is in flight (check/download/install). */
  busy: boolean;
  started: boolean;
  /** Version whose card the user closed for now — not the same as skipping. */
  dismissedVersion: string;
  /** The user picked "update and restart", so the restart happens on completion. */
  autoInstall: boolean;
  /**
   * The last download was the user's own attempt. Only a failure of an attempt
   * earns a card: background checks fail on trains and are not news.
   */
  attempted: boolean;

  start: () => void;
  refresh: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  /** Download now, install and restart the moment it lands. */
  updateAndRestart: () => Promise<void>;
  install: () => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  dismiss: (version: string) => void;
}

/** Announced "ready to install" per version, so a reload does not repeat it. */
const readyAnnounced = new Set<string>();

export const currentVersion = APP_VERSION;

export const useUpdateStore = create<UpdateState>((set, get) => {
  const announce = async (status: UpdateStatus) => {
    if (status.state === 'available' && status.version) {
      const settings = useSettingsStore.getState().settings;
      const memory = {
        skippedVersion: settings?.skippedUpdateVersion || undefined,
        lastNotifiedVersion: settings?.lastNotifiedVersion || undefined
      };
      if (!shouldAnnounceUpdate(status.version, APP_VERSION, memory)) return;
      toast.info(i18n.t('update.available', { version: status.version }), i18n.t('update.announceDetail'));
      // Written down so the next launch does not repeat it for the same build.
      await useSettingsStore.getState().updateSettings({ lastNotifiedVersion: status.version });
      return;
    }

    if (status.state === 'ready' && status.version && !readyAnnounced.has(status.version)) {
      readyAnnounced.add(status.version);
      toast.success(i18n.t('update.ready', { version: status.version }), i18n.t('update.readyDetail'));
    }
  };

  const apply = (status: UpdateStatus | null | undefined) => {
    // Same rule as the catalogue: an empty answer must not replace a real one,
    // because every screen that shows the status then reads `state`.
    if (!status || typeof status.state !== 'string') return;
    set({ status });
    void announce(status);

    // "Update and restart" is one decision, not two: the second click is the one
    // the user already made. An install the main process refuses (an agent run is
    // in flight) comes back as an error on the same status, so the flag is
    // cleared either way and the card goes back to asking.
    if (status.state === 'ready' && get().autoInstall) {
      set({ autoInstall: false });
      void get().install();
      return;
    }

    // A failed download must not leave a restart armed for the next time an
    // update happens to land.
    if (status.state === 'error' && get().autoInstall) set({ autoInstall: false });
    if (status.state === 'idle') set({ attempted: false });
  };

  return {
    status: { state: 'idle' },
    busy: false,
    started: false,
    dismissedVersion: '',
    autoInstall: false,
    attempted: false,

    /**
     * Subscribe to the main process. Guarded rather than cleaned up: the store
     * lives as long as the window does, and React's double-invoked effects in
     * development would otherwise register the listener twice.
     */
    start: () => {
      if (get().started) return;
      if (!window.electronAPI) return;
      set({ started: true });
      void window.electronAPI.getUpdateStatus().then(apply);
      window.electronAPI.onUpdateStatus(apply);
    },

    refresh: async () => {
      const status = await window.electronAPI?.getUpdateStatus();
      if (status) apply(status);
    },

    check: async () => {
      if (!window.electronAPI) return;
      set({ busy: true });
      try {
        apply(await window.electronAPI.checkForUpdates());
      } finally {
        set({ busy: false });
      }
    },

    /** Step one of the manual flow — the user asked for exactly this. */
    download: async () => {
      if (!window.electronAPI) return;
      set({ busy: true, attempted: true });
      try {
        apply(await window.electronAPI.downloadUpdate());
      } finally {
        set({ busy: false });
      }
    },

    /**
     * One click, two acts: download, then restart into the new build.
     *
     * The restart is still the user's decision — this function is only reachable
     * from their click — and the flag is dropped if anything refuses it, so a
     * blocked install never leaves a restart waiting in the background.
     */
    updateAndRestart: async () => {
      if (!window.electronAPI) return;
      set({ autoInstall: true, attempted: true });
      await get().download();
    },

    /** Step two. Main refuses while an agent run is in flight, and says so. */
    install: async () => {
      if (!window.electronAPI) return;
      set({ busy: true });
      try {
        apply(await window.electronAPI.installUpdate());
      } finally {
        set({ busy: false });
      }
    },

    skipVersion: async (version: string) => {
      const next = await window.electronAPI?.skipUpdateVersion(version);
      if (next) apply(next);
    },

    dismiss: (version: string) => set({ dismissedVersion: version })
  };
});

/** Whether the status has something the user can act on right now. */
export function isActionable(status: UpdateStatus): boolean {
  return status.state === 'available' || status.state === 'downloading' || status.state === 'ready';
}
