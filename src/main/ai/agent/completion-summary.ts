/**
 * Completion summary (spec §88).
 *
 * The end of a task should read like a report, not a victory lap: what changed,
 * what was actually validated, what it cost. Validation is listed from the
 * commands that really ran, with their real exit status — a build that failed is
 * reported as failed here, because a summary that claims success the user cannot
 * reproduce is worse than no summary at all.
 *
 * Pure on purpose: the runtime only assembles the inputs, so every branch of the
 * text can be tested without running an agent.
 */

export interface ValidationRun {
  command: string;
  ok: boolean;
}

export interface CompletionSummaryInput {
  language: 'th' | 'en';
  /** Project-relative paths the run changed, in the order they were touched. */
  changedFiles: string[];
  /** Build/test commands that ran during the run, in order. */
  validations: ValidationRun[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cost: number;
  };
}

/** Token counters can be missing or NaN for a provider that omits usage. */
const number = (value: number) =>
  (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0).toLocaleString('en-US');

export function buildCompletionSummary(input: CompletionSummaryInput): string {
  const { language, changedFiles, validations, usage } = input;

  const fileLines = changedFiles.length
    ? changedFiles.map((file) => `- ${file}`).join('\n')
    : language === 'th'
      ? '- ไม่มีการแก้ไขไฟล์'
      : '- No files modified';

  const validationLines = validations.length
    ? validations.map((entry) => `- \`${entry.command}\` ${entry.ok ? '✓' : '✗ failed'}`).join('\n')
    : language === 'th'
      ? '- ไม่มีคำสั่งตรวจสอบที่รัน (ไม่มีสคริปต์ build/test หรือไม่มีไฟล์ถูกแก้)'
      : '- No validation command ran (no build/test script, or no files changed)';

  const usageLines =
    language === 'th'
      ? [
          `- Tokens: Input ${number(usage.inputTokens)}, Output ${number(usage.outputTokens)}, Cached ${number(usage.cachedInputTokens)}`,
          `- ค่าใช้จ่ายประมาณการ: $${usage.cost.toFixed(4)}`
        ].join('\n')
      : [
          `- Tokens: Input ${number(usage.inputTokens)}, Output ${number(usage.outputTokens)}, Cached ${number(usage.cachedInputTokens)}`,
          `- Estimated Cost: $${usage.cost.toFixed(4)}`
        ].join('\n');

  if (language === 'th') {
    return [
      '### ดำเนินการเสร็จสมบูรณ์',
      '',
      '**ไฟล์ที่แก้ไข:**',
      fileLines,
      '',
      '**การตรวจสอบ:**',
      validationLines,
      '',
      '**การใช้ทรัพยากร:**',
      usageLines
    ].join('\n');
  }

  return [
    '### Task Completed',
    '',
    '**Changed files:**',
    fileLines,
    '',
    '**Validation:**',
    validationLines,
    '',
    '**Usage:**',
    usageLines
  ].join('\n');
}
