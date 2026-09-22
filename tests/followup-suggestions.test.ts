import { describe, expect, it } from 'vitest';
import { buildFollowUpSuggestions, FollowUpInput } from '../src/shared/followup-suggestions';

/**
 * The chips under a finished run are only worth clicking when they describe
 * *that* run, so the branches here are the run outcomes a user actually sees:
 * a failed build, a half-done task, a clean change, an empty conversation.
 * The label language follows the app language, and a chip must always carry
 * the full prompt it sends — the label is the preview, the prompt is the act.
 */

const base: FollowUpInput = {
  language: 'th',
  changedFiles: [],
  validations: [],
  todos: []
};

describe('buildFollowUpSuggestions', () => {
  it('offers to fix the command that actually failed', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/app.ts'],
      validations: [{ command: 'pnpm test', ok: false }]
    });
    expect(result.map((s) => s.id)).toContain('fix-validation');
    const fix = result.find((s) => s.id === 'fix-validation')!;
    expect(fix.prompt).toContain('pnpm test');
  });

  it('does not offer to fix validations that all passed', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/app.ts'],
      validations: [{ command: 'pnpm test', ok: true }]
    });
    expect(result.map((s) => s.id)).not.toContain('fix-validation');
  });

  it('lets the latest verdict of a command retire its earlier failure', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/app.ts'],
      validations: [
        { command: 'pnpm test', ok: false },
        { command: 'pnpm test', ok: true }
      ]
    });
    expect(result.map((s) => s.id)).not.toContain('fix-validation');
  });

  it('offers verification when files changed but nothing was checked', () => {
    const result = buildFollowUpSuggestions({ ...base, changedFiles: ['src/a.ts'] });
    expect(result.map((s) => s.id)).toContain('verify');
    expect(result.map((s) => s.id)).not.toContain('explore');
  });

  it('skips the verify chip when a check already ran', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/a.ts'],
      validations: [{ command: 'pnpm build', ok: true }]
    });
    expect(result.map((s) => s.id)).not.toContain('verify');
  });

  it('offers to continue when todos are left open', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      todos: [{ text: 'done bit', status: 'completed' }, { text: 'remaining work', status: 'pending' }]
    });
    expect(result.map((s) => s.id)).toContain('continue');
  });

  it('offers to continue when the run hit its step ceiling even with a clean todo list', () => {
    const result = buildFollowUpSuggestions({ ...base, unfinished: true });
    expect(result.map((s) => s.id)).toContain('continue');
  });

  it('offers a retry carrying the original prompt when a run failed', () => {
    const prompt = 'แก้ระบบ login ให้รองรับ refresh token';
    const result = buildFollowUpSuggestions({ ...base, retryPrompt: prompt });
    expect(result[0].id).toBe('retry');
    expect(result[0].prompt).toBe(prompt);
  });

  it('explores and proposes when nothing changed', () => {
    const result = buildFollowUpSuggestions(base);
    expect(result.map((s) => s.id)).toContain('explore');
    expect(result.map((s) => s.id)).toContain('propose');
    expect(result.map((s) => s.id)).not.toContain('review-diff');
    expect(result.map((s) => s.id)).not.toContain('commit');
  });

  it('offers review and commit after files changed', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/a.ts', 'src/b.ts'],
      validations: [{ command: 'pnpm test', ok: true }]
    });
    expect(result.map((s) => s.id)).toEqual(expect.arrayContaining(['review-diff', 'commit']));
  });

  it('caps the offer at three chips, urgent ones first', () => {
    const result = buildFollowUpSuggestions({
      ...base,
      changedFiles: ['src/a.ts'],
      validations: [{ command: 'pnpm test', ok: false }],
      retryPrompt: 'the task',
      unfinished: true
    });
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0].id).toBe('retry');
  });

  it('never repeats the same prompt twice', () => {
    const result = buildFollowUpSuggestions({ ...base, changedFiles: ['src/a.ts'] });
    const prompts = result.map((s) => s.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('writes labels in English when the app language is English', () => {
    const result = buildFollowUpSuggestions({ ...base, language: 'en', changedFiles: ['src/a.ts'] });
    expect(result.find((s) => s.id === 'commit')!.label).toBe('Commit this work');
  });

  it('ignores a blank retry prompt', () => {
    const result = buildFollowUpSuggestions({ ...base, retryPrompt: '   ' });
    expect(result.map((s) => s.id)).not.toContain('retry');
  });
});
