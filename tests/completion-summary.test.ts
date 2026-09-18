import { describe, expect, it } from 'vitest';
import { buildCompletionSummary } from '../src/main/ai/agent/completion-summary';

/**
 * The completion summary is the last thing a user reads before trusting a change
 * (spec §88). These tests pin the parts that must never drift: the structure, an
 * honest validation list, and the fact that a failed command is not reported as
 * a pass.
 */
const usage = { inputTokens: 43_000, outputTokens: 6_000, cachedInputTokens: 1_200, cost: 0.19 };

describe('completion summary', () => {
  it('reports changed files, validation and cost in the documented order', () => {
    const summary = buildCompletionSummary({
      language: 'en',
      changedFiles: ['src/auth.ts', 'src/api/client.ts'],
      validations: [
        { command: 'pnpm run build', ok: true },
        { command: 'pnpm test', ok: true }
      ],
      usage
    });

    expect(summary).toContain('### Task Completed');
    expect(summary.indexOf('**Changed files:**')).toBeLessThan(summary.indexOf('**Validation:**'));
    expect(summary.indexOf('**Validation:**')).toBeLessThan(summary.indexOf('**Usage:**'));
    expect(summary).toContain('- src/auth.ts');
    expect(summary).toContain('- `pnpm test` ✓');
    expect(summary).toContain('Input 43,000');
    expect(summary).toContain('Estimated Cost: $0.1900');
  });

  it('marks a failed command as failed instead of claiming success', () => {
    const summary = buildCompletionSummary({
      language: 'en',
      changedFiles: ['src/a.ts'],
      validations: [{ command: 'pnpm test', ok: false }],
      usage
    });

    expect(summary).toContain('- `pnpm test` ✗ failed');
    expect(summary).not.toContain('`pnpm test` ✓');
  });

  it('says plainly when nothing changed and nothing ran', () => {
    const summary = buildCompletionSummary({ language: 'en', changedFiles: [], validations: [], usage });

    expect(summary).toContain('- No files modified');
    expect(summary).toContain('- No validation command ran');
  });

  it('keeps the same shape in Thai', () => {
    const summary = buildCompletionSummary({
      language: 'th',
      changedFiles: ['src/a.ts'],
      validations: [{ command: 'pnpm test', ok: true }],
      usage
    });

    expect(summary).toContain('### ดำเนินการเสร็จสมบูรณ์');
    expect(summary).toContain('**การตรวจสอบ:**');
    expect(summary).toContain('ค่าใช้จ่ายประมาณการ: $0.1900');
    expect(summary).not.toContain('Task Completed');
  });

  it('never prints a negative or absurd token count', () => {
    const summary = buildCompletionSummary({
      language: 'en',
      changedFiles: [],
      validations: [],
      usage: { inputTokens: -5, outputTokens: Number.NaN as unknown as number, cachedInputTokens: 12.7, cost: 0 }
    });

    expect(summary).toContain('Input 0');
    expect(summary).toContain('Output 0');
    expect(summary).toContain('Cached 13');
  });
});
