import { useAgentStore } from './stores/agentStore';
import { useSessionsStore } from './stores/sessionsStore';

/**
 * A read/write window handle onto the real stores, for verification harnesses
 * that drive the app from outside (`window.__d4ide`). The agent's live pill and
 * the tab presence dot respond to store transitions; asserting that through
 * the keyboard is flaky (a prompt needs a configured provider), so a harness
 * flips the same `updateStatus` action a real run uses and the components must
 * still react. The bridge only exists when the bundle is built with
 * `D4IDE_DEBUG_BRIDGE=1` — normal and packaged builds never expose it, and a
 * test pins that gate.
 */
export function installDebugBridge(): void {
  if (!import.meta.env.VITE_DEBUG_BRIDGE) return;
  (window as unknown as Record<string, unknown>).__d4ide = {
    agent: useAgentStore,
    sessions: useSessionsStore
  };
}
