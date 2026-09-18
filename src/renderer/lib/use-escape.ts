import { useEffect } from 'react';

/**
 * Escape closes an overlay from anywhere (spec §61).
 *
 * Attaching the handler to an input only works while that input has focus —
 * click anywhere else inside a dialog and Escape silently stops working, which
 * makes a keyboard-first app feel broken. One window listener per overlay fixes
 * that without every dialog re-implementing it.
 */
export function useEscapeToClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop here so an overlay does not also trigger a shortcut underneath it.
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, onClose]);
}
