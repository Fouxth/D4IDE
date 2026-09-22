import { useAgentStore } from './stores/agentStore';
import { useProjectStore } from './stores/projectStore';
import { useSessionsStore } from './stores/sessionsStore';
import { useUiStore } from './stores/uiStore';
import { useUpdateStore } from './stores/updateStore';

/**
 * A read/write window handle onto the real stores, for verification harnesses
 * that drive the app from outside (`window.__d4ide`). The agent's live pill and
 * the tab presence dot respond to store transitions; asserting that through
 * the keyboard is flaky (a prompt needs a configured provider), so a harness
 * flips the same `updateStatus` action a real run uses and the components must
 * still react. The bridge only exists when the bundle is built with
 * `D4IDE_DEBUG_BRIDGE=1` — normal and packaged builds never expose it, and a
 * test pins that gate.
 *
 * The update store is here for the same reason: an update card can only be seen
 * when a real feed publishes a newer version, and the three faces of that card
 * (offered, downloading, downloaded) must all be checkable without shipping a
 * release for each one. `setState` is zustand's own, so the harness writes the
 * same shape the main process sends — it does not bypass any rule in the card.
 */
export function installDebugBridge(): void {
  if (!import.meta.env.VITE_DEBUG_BRIDGE) return;
  (window as unknown as Record<string, unknown>).__d4ide = {
    agent: useAgentStore,
    sessions: useSessionsStore,
    update: useUpdateStore,
    // Which folder is open decides which sessions the strip may show, so a
    // harness has to be able to set it directly and then read the strip back.
    project: useProjectStore,
    ui: useUiStore
  };
}
