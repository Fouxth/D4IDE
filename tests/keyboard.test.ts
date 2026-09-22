import { describe, expect, it } from 'vitest';
import { insideTerminal } from '../src/renderer/lib/keyboard';

/**
 * A stand-in for a DOM node: the helper only ever asks an event target whether it
 * is inside a shell, so what it needs is `closest`, not a document.
 */
const node = (chain: Record<string, boolean>) => ({
  closest: (selector: string) => (chain[selector] ? { selector } : null)
});

describe('insideTerminal', () => {
  it('is true for the prompt itself and for anything inside it', () => {
    expect(insideTerminal(node({ '.xterm': true }))).toBe(true);
  });

  it('is false for the rest of the window', () => {
    expect(insideTerminal(node({}))).toBe(false);
  });

  it('answers for a null target, a bare object and a non-element target', () => {
    // `window` and `document` are not Elements: they have no `closest`, and the
    // keystroke they carry is the app's to handle.
    expect(insideTerminal(null)).toBe(false);
    expect(insideTerminal(undefined)).toBe(false);
    expect(insideTerminal({})).toBe(false);
    expect(insideTerminal({ closest: 'not a function' })).toBe(false);
  });
});
