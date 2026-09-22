/**
 * Knowing what the user has typed into a shell — without taking the shell over.
 *
 * A dev server started by hand in the terminal used to serve from whatever port
 * its tool defaults to, which is the one number everybody else's project is also
 * using. The fix is to hand the port to the command, and the only moment that is
 * possible is the moment the command is submitted: everything before Enter is
 * still just text in the shell's line editor.
 *
 * So this module keeps track of that text. It never holds keystrokes back and it
 * never rewrites them — the shell receives every byte as it is typed, exactly as
 * before — it only *reads* them, so that when Enter arrives we know whether the
 * line is a dev command and what to append to it.
 *
 * Uncertainty is the design rule: arrow keys recall history the shell owns, tab
 * completion inserts text this module never saw, and a paste can carry its own
 * newlines. In every one of those cases the line is marked unknown and the Enter
 * key is passed straight through, untouched. A missed port is a small annoyance;
 * appending an argument to the wrong command is not.
 */

/** Cap on the tracked line: a longer one is not a command anybody typed. */
const MAX_LINE = 512;

/** Control characters that mean "the line is not what it was a moment ago". */
const ABANDON = '\u0003\u0004\u001a'; // Ctrl+C, Ctrl+D, Ctrl+Z
const KILL_LINE = '\u0015'; // Ctrl+U
const BACKSPACE = '\u007f\b';

export class TypedLine {
  private buffer = '';
  private known = true;

  /**
   * Feeds one chunk of keystrokes and returns the completed line when this chunk
   * ended it with Enter — or null, which means "nothing to plan here".
   *
   * Null covers both "the line is still being typed" and "this line can no
   * longer be trusted", because the caller does the same thing either way: pass
   * the chunk straight to the shell.
   *
   * `pending` is the part of the chunk that came *before* the Enter and has
   * therefore not reached the shell yet. Keys normally arrive one at a time, so
   * it is empty; it carries text only when a whole command was delivered in the
   * same chunk as the key that submitted it.
   */
  feed(data: string): { line: string; pending: string } | null {
    if (!data) return null;

    const trailing = data.match(/[\r\n]+$/)?.[0] ?? '';
    // More than one newline in a chunk is a paste of several commands. Only the
    // last of them could be rewritten, and rewriting part of what somebody
    // pasted is worse than not rewriting any of it.
    if (trailing && data.slice(0, -trailing.length).includes('\n')) {
      this.reset();
      this.known = false;
      return null;
    }

    const body = trailing ? data.slice(0, -trailing.length) : data;
    for (const char of body) this.consume(char);

    if (!trailing) return null;
    const line = this.known ? this.buffer : null;
    this.reset();
    return line !== null && line.trim() ? { line, pending: body } : null;
  }

  private consume(char: string): void {
    if (char === '\u001b') {
      // Escape starts an arrow key, a history search, a bracketed paste: the
      // shell's own line editor is about to change the line behind our back.
      this.known = false;
      return;
    }
    if (ABANDON.includes(char) || char === KILL_LINE) {
      this.reset();
      return;
    }
    if (BACKSPACE.includes(char)) {
      this.buffer = this.buffer.slice(0, -1);
      return;
    }
    // Any other control character (Tab, Ctrl+A, Ctrl+W…) edits the line in a way
    // that is not tracked character by character.
    if (char < ' ') {
      this.known = false;
      return;
    }
    if (this.buffer.length >= MAX_LINE) {
      this.known = false;
      return;
    }
    this.buffer += char;
  }

  private reset(): void {
    this.buffer = '';
    this.known = true;
  }
}

/**
 * What to append to a typed line so that it serves from the project's port.
 *
 * The planner is the authority: it answers with the command that should actually
 * run, and the difference between that and what was typed is exactly the
 * arguments worth typing on the user's behalf. Everything else appends nothing —
 * a plan that leaves the command alone (a server told through `PORT`, or a tool
 * that takes no port at all), and a plan that moved the command somewhere else
 * rather than extending it.
 */
export function plannedSuffix(
  typed: string,
  plan: { command?: string | null } | null | undefined
): string {
  const line = (typed ?? '').trim();
  const planned = typeof plan?.command === 'string' ? plan.command.trim() : '';
  if (!line || !planned || planned === line) return '';
  if (!planned.startsWith(line)) return '';
  return planned.slice(line.length);
}

/**
 * The bytes that finally reach the shell when a line is submitted.
 *
 * `pending` is the part of the incoming chunk that the shell has not seen yet,
 * and it is the whole reason this is a function rather than a template in the
 * panel: keys arrive one at a time, so by the time Enter is pressed the command
 * has already been typed *and sent*, and writing it again would run it twice on
 * one line. A chunk that carried its own text has not been sent, and only that
 * text is owed back.
 */
export function submittedInput(
  pending: string,
  line: string,
  plan: { command?: string | null } | null | undefined
): string {
  return `${pending ?? ''}${plannedSuffix(line, plan)}\r`;
}
