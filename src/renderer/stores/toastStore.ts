import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  timestamp: number;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, detail?: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const AUTO_DISMISS_MS = 6000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (kind, message, detail) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, kind, message, detail, timestamp: Date.now() }] }));
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] })
}));

/** Convenience wrapper usable outside React components. */
export const toast = {
  success: (message: string, detail?: string) => useToastStore.getState().push('success', message, detail),
  error: (message: string, detail?: string) => useToastStore.getState().push('error', message, detail),
  info: (message: string, detail?: string) => useToastStore.getState().push('info', message, detail),
  warning: (message: string, detail?: string) => useToastStore.getState().push('warning', message, detail)
};
