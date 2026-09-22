import { create } from 'zustand';
import { CatalogStatus } from '../../shared/types';
import i18n from '../lib/i18n';
import { toast } from './toastStore';

/**
 * The renderer's view of the model catalogue.
 *
 * Mirrors `updateStore` on purpose, because it is the same promise: the main
 * process is allowed to ask the providers what they serve, and nothing about the
 * user's configuration changes until a button here is pressed. What this store
 * adds is the announcement, said once per finished check.
 */
interface CatalogState {
  status: CatalogStatus;
  busy: boolean;
  started: boolean;

  start: () => void;
  check: () => Promise<void>;
  apply: () => Promise<void>;
  discard: () => Promise<void>;
  undo: () => Promise<void>;
}

/** Checks already announced, by timestamp, so reloading the window stays quiet. */
const announced = new Set<number>();

export const useCatalogStore = create<CatalogState>((set, get) => {
  const receive = (status: CatalogStatus | null | undefined) => {
    // A bridge that answers nothing is not a catalogue state. Taking the store
    // down to `null` here is what blanked the whole Updates screen — one missing
    // reply is not worth a black window.
    if (!status || typeof status.state !== 'string') return;
    set({ status });
    if (status.state !== 'changes' || !status.diff) return;
    if (announced.has(status.diff.checkedAt)) return;
    announced.add(status.diff.checkedAt);
    const { added, changed } = status.diff.totals;
    // Only a check that actually found something is worth interrupting for.
    if (added === 0 && changed === 0) return;
    toast.info(
      i18n.t('catalog.foundTitle', { added, changed }),
      i18n.t('catalog.foundBody')
    );
  };

  const run = async (action: () => Promise<CatalogStatus | undefined>) => {
    set({ busy: true });
    try {
      const status = await action();
      if (status) receive(status);
    } finally {
      set({ busy: false });
    }
  };

  return {
    status: { state: 'idle', undoAvailable: false },
    busy: false,
    started: false,

    start: () => {
      if (get().started) return;
      if (!window.electronAPI) return;
      set({ started: true });
      void window.electronAPI.getCatalogStatus?.().then(receive);
      window.electronAPI.onCatalogStatus?.(receive);
    },

    check: () => run(() => window.electronAPI!.checkCatalog()),
    apply: () =>
      run(async () => {
        const status = await window.electronAPI!.applyCatalog();
        toast.success(i18n.t('catalog.applied'));
        return status;
      }),
    discard: () => run(() => window.electronAPI!.discardCatalog()),
    undo: () =>
      run(async () => {
        const status = await window.electronAPI!.undoCatalog();
        toast.info(i18n.t('catalog.undone'));
        return status;
      })
  };
});
