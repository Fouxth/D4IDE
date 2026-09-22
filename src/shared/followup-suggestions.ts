/**
 * The next-move chips under a finished run (spec §5's suggested prompts).
 *
 * What makes one worth showing is that it is grounded in what *this run* just
 * did: a failed build asks to be fixed, a half-done task asks to be continued,
 * a clean change asks to be reviewed or committed. A static list of prompts
 * would be the same three buttons on every conversation, which is furniture —
 * the value is the connection to the work on screen.
 *
 * Pure on purpose: the runtime assembles the inputs, so every branch can be
 * tested without running an agent. Labels are written here (not looked up in
 * the renderer's i18n) because the suggestion crosses IPC as a finished thing —
 * the chip shows `label`, and clicking it sends `prompt` verbatim.
 */

export interface FollowUpSuggestion {
  /** Stable identity for React keys and tests. */
  id: string;
  /** Short text shown on the chip. */
  label: string;
  /** The full prompt a click sends to the agent. */
  prompt: string;
}

export interface FollowUpInput {
  language: 'th' | 'en';
  /** Project-relative paths this run changed, in the order they were touched. */
  changedFiles: string[];
  /** Build/test commands this run executed, with their real exit status. */
  validations: { command: string; ok: boolean }[];
  /** The task list as the run left it. */
  todos: { text: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }[];
  /** True when the run stopped at its step ceiling with work still open. */
  unfinished?: boolean;
  /** The prompt that failed — offered back as a one-click retry. */
  retryPrompt?: string;
}

/** Never more chips than a row can hold; the first ones are the urgent ones. */
const MAX_SUGGESTIONS = 3;

export function buildFollowUpSuggestions(input: FollowUpInput): FollowUpSuggestion[] {
  const { language, changedFiles, validations, todos, unfinished, retryPrompt } = input;
  const th = language === 'th';

  const suggestions: FollowUpSuggestion[] = [];

  if (retryPrompt && retryPrompt.trim()) {
    suggestions.push({
      id: 'retry',
      label: th ? 'ส่งงานเดิมใหม่อีกครั้ง' : 'Retry this task',
      prompt: retryPrompt.trim()
    });
  }

  // A command that failed earlier in the session but passed on its latest run
  // is fixed — only its most recent verdict counts, or a chip would keep asking
  // to repair something that already passes.
  const latestVerdict = new Map<string, boolean>();
  for (const entry of validations) latestVerdict.set(entry.command, entry.ok);
  const failedValidation = Array.from(latestVerdict.entries()).find(([, ok]) => !ok);
  if (failedValidation) {
    const command = failedValidation[0];
    suggestions.push({
      id: 'fix-validation',
      label: th ? `แก้ให้ \`${command}\` ผ่าน` : `Fix \`${command}\``,
      prompt: th
        ? `คำสั่ง \`${command}\` ล้มเหลว หาสาเหตุ แก้ให้ผ่าน แล้วรันตรวจสอบซ้ำอีกครั้ง`
        : `The command \`${command}\` failed. Find the root cause, fix it until it passes, then run the checks again.`
    });
  }

  const hasOpenTodos = todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'failed');
  if (unfinished || hasOpenTodos) {
    suggestions.push({
      id: 'continue',
      label: th ? 'ทำต่อจากที่ค้าง' : 'Continue where you left off',
      prompt: th
        ? 'ทำต่อจากงานที่ค้างอยู่โดยไม่ต้องเริ่มใหม่ แล้วสรุปสิ่งที่เหลือต้องทำ'
        : 'Continue the unfinished work without starting over, then summarise what is left.'
    });
  }

  if (changedFiles.length > 0) {
    const anyValidationRan = validations.length > 0;
    if (!anyValidationRan) {
      suggestions.push({
        id: 'verify',
        label: th ? 'รันเทสต์ให้ผ่าน' : 'Run the checks',
        prompt: th
          ? 'รัน build และเทสต์ของโปรเจกต์ แก้จนผ่าน แล้วสรุปผลให้ฟัง'
          : 'Run the project build and tests, fix anything that fails, then summarise the result.'
      });
    }
    suggestions.push({
      id: 'review-diff',
      label: th ? 'รีวิวโค้ดที่เพิ่งแก้' : 'Review the changes',
      prompt: th
        ? 'รีวิว diff ของการแก้ไขล่าสุดทั้งหมด แล้วบอกจุดที่ควรปรับปรุง ทั้งความถูกต้องและความสะอาดของโค้ด'
        : 'Review the full diff of the latest changes and point out what should be improved, both correctness and code quality.'
    });
    suggestions.push({
      id: 'commit',
      label: th ? 'เขียน commit งานนี้' : 'Commit this work',
      prompt: th
        ? 'เขียน commit message ที่สรุปการแก้ไขล่าสุดแล้ว commit ให้หน่อย (แค่ commit อย่างเดียว ยังไม่ต้อง push)'
        : 'Write a commit message summarising the latest changes and commit them (commit only, do not push).'
    });
  } else {
    suggestions.push({
      id: 'explore',
      label: th ? 'สำรวจโปรเจกต์' : 'Explore this project',
      prompt: th
        ? 'สำรวจโปรเจกต์นี้แล้วสรุปโครงสร้าง ส่วนสำคัญ และจุดที่ควรรู้ก่อนแก้โค้ด'
        : 'Explore this project and summarise its structure, the important parts, and what to know before changing code.'
    });
    suggestions.push({
      id: 'propose',
      label: th ? 'เสนองานถัดไป' : 'Suggest next tasks',
      prompt: th
        ? 'เสนอ 3 งานที่ควรทำต่อในโปรเจกต์นี้ พร้อมเหตุผลสั้น ๆ ว่าทำไมงานนั้นสำคัญ'
        : 'Propose 3 tasks worth doing next in this project, with a short reason for each.'
    });
  }

  // One idea, one chip: a suggestion that repeats itself is noise, however many
  // routes produced it.
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => {
      if (seen.has(suggestion.prompt)) return false;
      seen.add(suggestion.prompt);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}
