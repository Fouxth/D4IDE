import { describe, it, expect } from 'vitest';
import { BUILTIN_COMMANDS, builtinCommandSkills, expandCommandPrompt } from '../src/shared/builtin-commands';

/**
 * The shipped commands are user-visible API: they appear in the skills panel and
 * in the `/` menu. A duplicate id would silently hide a command, and a missing
 * placeholder would drop whatever the user typed after the command name.
 */
describe('built-in commands', () => {
  it('ships a useful set with unique ids', () => {
    expect(BUILTIN_COMMANDS.length).toBeGreaterThanOrEqual(10);
    const ids = BUILTIN_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names commands the way someone would type them', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(command.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(command.id).not.toContain(' ');
    }
  });

  it('carries a real instruction with room for the user’s words', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(command.prompt.trim().length).toBeGreaterThan(40);
      expect(command.prompt).toContain('{input}');
    }
  });

  it('is described in both UI languages', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(command.summary.en.trim().length).toBeGreaterThan(3);
      expect(command.summary.th.trim().length).toBeGreaterThan(3);
      expect(command.summary.th).not.toBe(command.summary.en);
    }
  });

  it('switches to plan mode for the planning command only', () => {
    const plan = BUILTIN_COMMANDS.find((command) => command.id === 'plan');
    expect(plan?.mode).toBe('plan');
    const others = BUILTIN_COMMANDS.filter((command) => command.id !== 'plan' && command.mode);
    expect(others.map((command) => command.id)).toEqual([]);
  });
});

describe('command prompt expansion', () => {
  const plan = BUILTIN_COMMANDS.find((command) => command.id === 'plan')!;
  const explain = BUILTIN_COMMANDS.find((command) => command.id === 'explain')!;

  it('drops the placeholder when the user gave no detail', () => {
    const expanded = expandCommandPrompt(plan, '   ');
    expect(expanded).not.toContain('{input}');
    expect(expanded).toBe(plan.prompt.replace('{input}', '').trim());
  });

  it('keeps the user’s own words when they gave some', () => {
    const expanded = expandCommandPrompt(explain, 'the auth gate');
    expect(expanded).toContain('the auth gate');
    expect(expanded).not.toContain('{input}');
  });

  it('does not leak the placeholder for a command with no arguments', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(expandCommandPrompt(command, 'x')).not.toContain('{input}');
      expect(expandCommandPrompt(command, '')).not.toContain('{input}');
    }
  });
});

describe('commands as skills', () => {
  it('describes them in the requested language', () => {
    const thai = builtinCommandSkills('th');
    const english = builtinCommandSkills('en');

    expect(thai).toHaveLength(BUILTIN_COMMANDS.length);
    expect(thai[0].description).toBe(BUILTIN_COMMANDS[0].summary.th);
    expect(english[0].description).toBe(BUILTIN_COMMANDS[0].summary.en);
    expect(thai.every((skill) => skill.isGlobal)).toBe(true);
    expect(thai.every((skill) => skill.content.trim().length > 0)).toBe(true);
  });
});
