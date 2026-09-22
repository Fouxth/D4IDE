import { describe, expect, it } from 'vitest';
import { TypedLine, plannedSuffix, submittedInput } from '../src/renderer/lib/terminal-command';

/**
 * The terminal is the one place a dev server is started by hand, so it is the
 * one place a port has to be added to a command the app did not write. These pin
 * the two halves of that: reading the line the user typed, and knowing what to
 * add to it.
 *
 * The rule that matters most is the negative one. Arrow keys, tab completion and
 * pasted multi-line text all put things on the line that this cannot see, and in
 * every one of those cases the answer has to be "leave it alone" — appending an
 * argument to the wrong command is far worse than a server on its default port.
 */

/** Types a line the way a keyboard does: one key at a time, then Enter. */
function typeKeys(tracker: TypedLine, text: string) {
  for (const char of text) {
    const completed = tracker.feed(char);
    expect(completed).toBeNull();
  }
  return tracker.feed('\r');
}

describe('the line being typed', () => {
  it('collects keys and hands back the whole line on Enter', () => {
    const tracker = new TypedLine();
    expect(typeKeys(tracker, 'npm run dev')).toEqual({ line: 'npm run dev', pending: '' });
    // And starts over, so the next command is read on its own.
    expect(typeKeys(tracker, 'git status')).toEqual({ line: 'git status', pending: '' });
  });

  it('carries text that arrived in the same chunk as the Enter', () => {
    const tracker = new TypedLine();
    // A paste, or a client that batches: the keys were never sent to the shell,
    // so they are still owed to it.
    expect(tracker.feed('pnpm dev\r')).toEqual({ line: 'pnpm dev', pending: 'pnpm dev' });
  });

  it('follows backspace and gives up on the keys it cannot follow', () => {
    const tracker = new TypedLine();
    expect(typeKeys(tracker, 'npm run deve\u007f')).toEqual({ line: 'npm run dev', pending: '' });
    // Up-arrow recalls history the shell owns: the line is no longer knowable.
    const recalled = new TypedLine();
    expect(recalled.feed('\u001b[A')).toBeNull();
    expect(recalled.feed('\r')).toBeNull();
    // Tab completion inserts text that never came through here.
    const completed = new TypedLine();
    expect(completed.feed('npm run\t')).toBeNull();
    expect(completed.feed('\r')).toBeNull();
  });

  it('starts again after an abandoned line', () => {
    const tracker = new TypedLine();
    // ^C threw away whatever was half-typed…
    tracker.feed('npm run dev\u0003');
    // …so the next Enter must not be credited with it.
    expect(typeKeys(tracker, 'ls')).toEqual({ line: 'ls', pending: '' });
  });

  it('leaves a pasted block of commands alone', () => {
    const tracker = new TypedLine();
    expect(tracker.feed('cd app\nnpm run dev\r')).toBeNull();
  });

  it('ignores an empty line', () => {
    const tracker = new TypedLine();
    expect(tracker.feed('\r')).toBeNull();
    expect(tracker.feed('')).toBeNull();
  });
});

describe('the arguments typed on the user’s behalf', () => {
  it('takes exactly what the plan added', () => {
    expect(plannedSuffix('npm run dev', { command: 'npm run dev -- --port 1001' })).toBe(' -- --port 1001');
    expect(plannedSuffix('next dev', { command: 'next dev -p 1001' })).toBe(' -p 1001');
  });

  it('adds nothing when the command did not move', () => {
    expect(plannedSuffix('npm run dev', { command: 'npm run dev' })).toBe('');
    expect(plannedSuffix('vite --port 5173', { command: 'vite --port 5173' })).toBe('');
    expect(plannedSuffix('npm run dev', null)).toBe('');
    expect(plannedSuffix('', { command: 'npm run dev -- --port 1001' })).toBe('');
  });

  it('adds nothing when the plan rewrote the command instead of extending it', () => {
    // Anything that is not the typed line plus a suffix is not this module's to
    // type into a shell.
    expect(plannedSuffix('npm run dev', { command: 'PORT=1001 npm run dev' })).toBe('');
  });

  it('matches a line that was typed with trailing spaces', () => {
    expect(plannedSuffix('npm run dev   ', { command: 'npm run dev -- --port 1001' })).toBe(' -- --port 1001');
  });
});

describe('what finally reaches the shell', () => {
  it('sends only the arguments, because the keys are already there', () => {
    // Keys arrive one at a time and were forwarded as they were typed: writing
    // the command again would run it twice on the same line.
    expect(submittedInput('', 'npm run dev', { command: 'npm run dev -- --port 1000' })).toBe(
      ' -- --port 1000\r'
    );
    expect(submittedInput('', 'ls', null)).toBe('\r');
  });

  it('sends text that arrived with the Enter itself', () => {
    expect(submittedInput('pnpm dev', 'pnpm dev', { command: 'pnpm dev --port 1000' })).toBe(
      'pnpm dev --port 1000\r'
    );
  });
});
