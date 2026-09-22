/**
 * Where a keystroke came from, for the app's global shortcuts.
 *
 * The terminal panel is a real shell with real bindings — readline reads Ctrl+T
 * as transpose-chars, Ctrl+W as delete-word — so a global shortcut that swallowed
 * those keys would break typing in the very panel that sits next to it. A
 * shortcut that is safe everywhere else has to ask first whether the event came
 * from inside an xterm.
 *
 * Written against a structural type rather than `Element` on purpose: the
 * renderer's unit tests run without a DOM, and a stray `instanceof Element` would
 * throw there instead of answering.
 */
export const insideTerminal = (target: unknown): boolean => {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (!element || typeof element.closest !== 'function') return false;
  return !!element.closest('.xterm');
};
