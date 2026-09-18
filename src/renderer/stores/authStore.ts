import { create } from 'zustand';
import { AuthState } from '../../shared/types';

/**
 * The app-wide sign-in state (spec §7).
 *
 * `locked` is what the shell renders on: while it is true the IDE is replaced by
 * the sign-in screen, so a locked app cannot be used by reaching a route the way
 * a hidden dialog could be dismissed. The check runs against the main process,
 * which is also the side that re-validates the stored token.
 */
interface AuthStore {
  state: AuthState | null;
  loading: boolean;
  /** True while a sign-in flow is in progress. */
  signingIn: boolean;
  load: () => Promise<void>;
  signIn: (provider: 'github' | 'google') => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  /** True when the gate is on and nobody is signed in. */
  isLocked: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  state: null,
  loading: true,
  signingIn: false,

  load: async () => {
    if (!window.electronAPI) {
      set({ state: null, loading: false });
      return;
    }
    try {
      const state = (await window.electronAPI.authStatus()) as AuthState;
      set({ state, loading: false });
    } catch {
      // If the check itself fails we keep the last known state rather than
      // locking someone out of an app that is merely having a bad moment.
      set({ loading: false });
    }
  },

  signIn: async (provider) => {
    if (!window.electronAPI) return { ok: false, error: 'unavailable' };
    set({ signingIn: true });
    try {
      const result = await window.electronAPI.authSignIn(provider);
      if (result?.success) {
        set({ state: result.state, signingIn: false });
        return { ok: true };
      }
      set({ signingIn: false });
      return { ok: false, error: result?.error };
    } catch (error) {
      set({ signingIn: false });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  signOut: async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.authSignOut();
    await get().load();
  },

  isLocked: () => {
    const state = get().state;
    if (!state) return false;
    return state.required && !state.signedIn;
  }
}));
