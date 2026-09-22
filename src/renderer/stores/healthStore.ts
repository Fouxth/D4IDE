import { create } from 'zustand';
import type { ProviderHealthStatus } from '../../shared/types';
import i18n from '../lib/i18n';
import { providerErrorLabel } from '../lib/format';
import { toast } from './toastStore';
import { useSettingsStore } from './settingsStore';
import { notify } from '../lib/notify';

/**
 * The renderer's view of the provider health watch.
 *
 * Like the update store, it listens and announces — the schedule lives in the
 * main process. What this store owns is the part that needs a screen and a
 * language: naming the provider that just stopped answering, staying quiet
 * about it once it has been said, and saying "it's back" exactly once when it
 * recovers. A warning repeated every ten minutes teaches people to ignore it.
 */
interface HealthState {
  status: ProviderHealthStatus;
  started: boolean;
  /** A user-triggered probe is in flight. */
  busy: boolean;
  /** The current `down` episode has been announced — do not repeat it. */
  announcedDown: boolean;
  /** The fallback in the current episode was already accepted or dismissed. */
  fallbackHandled: boolean;
  /** The user closed the banner for this outage — silence until it recovers
   * and fails again; a fresh episode resets this. */
  dismissed: boolean;

  start: () => void;
  /** Probe now (opening the hub, or the banner's "check again"). */
  probe: () => Promise<void>;
  /** Apply the suggested fallback: switch provider + model, then probe it. */
  acceptFallback: () => Promise<boolean>;
  /** Stop showing the switch button for this episode. */
  dismissFallback: () => void;
  /** Close the banner for this outage; recovery plus a new failure reopens it. */
  dismiss: () => void;
}

export const useHealthStore = create<HealthState>((set, get) => {
  const announce = (status: ProviderHealthStatus) => {
    const th = i18n.language === 'th' || !i18n.language;
    if (status.state === 'down' && !get().announcedDown) {
      set({ announcedDown: true, fallbackHandled: false, dismissed: false });
      const name = status.providerName || i18n.t('providers.healthFallbackUnknown');
      const kindLabel = status.errorKind ? providerErrorLabel(status.errorKind, th ? 'th' : 'en') : '';
      toast.error(i18n.t('providers.healthDownTitle', { name }), kindLabel || status.error || undefined);
      // The popup only lands when the window is not focused (see `notify`), so
      // a user watching the app is not ALSO Windows-notified about it.
      notify(i18n.t('providers.healthDownTitle', { name }), kindLabel, 'error');
      // The main process follows this push with a second one carrying a tested
      // fallback (if any candidate answered), so nothing is asked for here.
    } else if (status.state === 'ok' && get().announcedDown) {
      set({ announcedDown: false, fallbackHandled: true });
      toast.success(i18n.t('providers.healthRecovered', { name: status.providerName || '' }));
    }
    set({ status });
  };

  return {
    status: { state: 'unknown' },
    started: false,
    busy: false,
    announcedDown: false,
    fallbackHandled: false,
    dismissed: false,

    start: () => {
      if (get().started || !window.electronAPI?.onProviderHealthStatus) return;
      set({ started: true });
      window.electronAPI.onProviderHealthStatus((status) => announce(status));
    },

    probe: async () => {
      if (!window.electronAPI?.probeProviderHealth || get().busy) return;
      set({ busy: true });
      try {
        const status = await window.electronAPI.probeProviderHealth();
        announce(status);
      } finally {
        set({ busy: false });
      }
    },

    acceptFallback: async () => {
      const { status } = get();
      if (!status.fallbackProviderId || !window.electronAPI) return false;
      await useSettingsStore
        .getState()
        .updateSettings({ activeProviderId: status.fallbackProviderId, activeModelId: status.fallbackModelId || 'auto' });
      set({ fallbackHandled: true });
      toast.success(
        i18n.t('providers.healthSwitched', { name: status.fallbackProviderName || status.fallbackProviderId })
      );
      // Prove the new choice works before the user builds on it.
      await get().probe();
      return get().status.state !== 'down';
    },

    dismissFallback: () => set({ fallbackHandled: true }),

    dismiss: () => set({ dismissed: true })
  };
});
