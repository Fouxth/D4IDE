import { AgentMode, SkillItem } from './types';

/**
 * The command set D4IDE ships with (spec §34 / §41).
 *
 * These are ordinary skills — a name, a description and the prompt body — with
 * one difference: they live in the app rather than in a file, so a fresh install
 * already has a useful set of commands and they improve with the app instead of
 * going stale in someone's `%APPDATA%`. User skills in `<dataDir>/skills` and
 * `<project>/.d4ide/skills` still win on a name clash, so anything here can be
 * replaced.
 *
 * The prompt bodies are deliberately written in English: they are instructions
 * to the model, and the agent is separately told to answer in the UI language.
 */
export type CommandCategory = 'plan' | 'code' | 'quality' | 'git' | 'docs' | 'ops';

/**
 * Commands that change a setting rather than only wording.
 *
 * `/thrift` used to expand into a paragraph asking the model to be careful,
 * which changed nothing in the engine: the same prompt budget, the same step
 * ceiling, the same reasoning effort. The user paid for a longer prompt and got
 * the same bill. A command that claims to save money has to move a real dial.
 */
export type CommandAction = 'toggle-thrift' | 'set-thrift-on' | 'set-thrift-off' | 'open-design' | 'set-mission';

export interface BuiltinCommand {
  id: string;
  category: CommandCategory;
  /** Composer mode the command expects — `/plan` switches the run to Plan Mode. */
  mode?: AgentMode;
  summary: { en: string; th: string };
  /**
   * Text placed in the composer when the command is chosen. `{input}` is the
   * rest of what the user typed after the command name, or `{input}`'s
   * placeholder text when they typed nothing.
   */
  prompt: string;
  /** A real setting this command flips, applied before the prompt is sent. */
  action?: CommandAction;
  /**
   * True when choosing the command should send it straight away instead of only
   * placing the text in the composer — right for commands whose whole job is the
   * setting, with nothing left for the user to complete.
   */
  immediate?: boolean;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    id: 'goal',
    category: 'plan',
    action: 'set-mission',
    summary: {
      en: 'Set this session’s mission — the statement the work is measured against',
      th: 'ตั้งภารกิจของเซสชันนี้ — ข้อความที่ใช้ยึดในการทำงาน'
    },
    prompt:
      'Session mission (bind for the whole task):\n\n{input}\n\nWork to that mission from here on: state what "done" means for it, do the work, and prove it with the exact command or test result rather than a summary. Say so before acting if something in this request conflicts with the mission.\n\n{input}'
  },
  {
    id: 'plan',
    category: 'plan',
    mode: 'plan',
    summary: {
      en: 'Plan a change before any code is written',
      th: 'วางแผนงานก่อนแตะโค้ด'
    },
    prompt:
      'Inspect the project and produce an implementation plan for this request, then stop for approval:\n\n{input}'
  },
  {
    id: 'review',
    category: 'quality',
    summary: {
      en: 'Review the current git diff for bugs and regressions',
      th: 'ตรวจ diff ล่าสุด หาบั๊กและความเสี่ยง'
    },
    prompt:
      'Review the current git diff (unstaged and staged) as a careful reviewer. Report bugs, type errors, security issues, missing edge cases and behaviour changes. Do not modify files unless I ask.\n\n{input}'
  },
  {
    id: 'verify',
    category: 'quality',
    summary: {
      en: 'Prove the change works: build, tests, and a real run',
      th: 'พิสูจน์ว่าแก้นั้นใช้ได้จริง: บิลด์ เทสต์ และรันจริง'
    },
    prompt:
      'Verify the most recent change end to end. Run the build and the test suite, and actually exercise the changed behaviour. Report exact commands and their output, and say clearly what you could not verify.\n\n{input}'
  },
  {
    id: 'test',
    category: 'quality',
    summary: {
      en: 'Run the test suite and fix what fails',
      th: 'รันเทสต์แล้วซ่อมที่พัง'
    },
    prompt:
      'Run the project test suite. For each failure, find the root cause, fix it properly (not by relaxing the assertion), and re-run until green. Add a regression test for anything that was not covered.\n\n{input}'
  },
  {
    id: 'debug',
    category: 'code',
    summary: {
      en: 'Reproduce a bug, find the cause, fix it, add a test',
      th: 'ทำบั๊กให้ซ้ำได้ หาสาเหตุ แก้ และเพิ่มเทสต์'
    },
    prompt:
      'Reproduce this problem first, then find the root cause, fix it, and add a regression test that fails before the fix. Show the evidence for the cause, not just the fix.\n\n{input}'
  },
  {
    id: 'simplify',
    category: 'code',
    summary: {
      en: 'Make the code simpler without changing behaviour',
      th: 'ทำให้โค้ดเรียบง่ายขึ้นโดยพฤติกรรมเดิม'
    },
    prompt:
      'Simplify the code in scope: remove duplication, delete dead paths, flatten nesting, and name things clearly. Behaviour must not change. Run the tests afterwards.\n\n{input}'
  },
  {
    id: 'refactor',
    category: 'code',
    summary: {
      en: 'Restructure the code along a cleaner design',
      th: 'จัดโครงโค้ดใหม่ให้ออกแบบสะอาดขึ้น'
    },
    prompt:
      'Refactor the code in scope to a cleaner design: separate responsibilities, shrink interfaces, and move logic to where it belongs. Keep behaviour identical, run the tests, and describe the before/after structure.\n\n{input}'
  },
  {
    id: 'explain',
    category: 'docs',
    summary: {
      en: 'Explain how something works, from the real code',
      th: 'อธิบายการทำงานจากโค้ดจริง'
    },
    prompt:
      'Read the real code and explain how this works: the data flow, the key functions, and the decisions behind them. Point at file and line references. Do not change anything.\n\n{input}'
  },
  {
    id: 'document',
    category: 'docs',
    summary: {
      en: 'Write or refresh documentation for this area',
      th: 'เขียน/อัปเดตเอกสารของส่วนนี้'
    },
    prompt:
      'Write or update the documentation for this area. Document what exists today, with runnable examples, and remove anything now wrong. Match the existing docs style and language.\n\n{input}'
  },
  {
    id: 'security',
    category: 'quality',
    summary: {
      en: 'Audit for security problems and fix the real ones',
      th: 'ตรวจความปลอดภัยและปิดช่องที่จริง'
    },
    prompt:
      'Audit the code in scope for security problems: injection, unvalidated input, secrets in logs or storage, unsafe file paths, over-permissive permissions, and dependency risk. Fix the real issues; for anything you judge out of scope, explain why.\n\n{input}'
  },
  {
    id: 'performance',
    category: 'quality',
    summary: {
      en: 'Find and fix a real performance bottleneck',
      th: 'หาคอขวดประสิทธิภาพจริงแล้วแก้'
    },
    prompt:
      'Look for performance problems in scope — repeated work, unnecessary I/O, unbounded loops or queries, missing indexes, needless re-renders. Measure where you can, fix the ones that matter, and do not trade correctness for speed.\n\n{input}'
  },
  {
    id: 'mobile',
    category: 'code',
    summary: {
      en: 'Make the screens in scope work as mobile UI first',
      th: 'จัดหน้าจอในขอบเขตให้เป็น Mobile UI ก่อน'
    },
    prompt:
      'Rework the screens in scope as mobile-first UI: one column at 360px, touch-sized targets, no fixed widths, nothing overflowing a small viewport. Then let it scale up naturally to tablet and desktop. Verify with a narrow-viewport screenshot and report it.'
      + '\n\n{input}'
  },
  {
    id: 'responsive',
    category: 'code',
    summary: {
      en: 'Make the screens in scope responsive across breakpoints',
      th: 'ทำหน้าจอในขอบเขตให้ Responsive ทุก breakpoint'
    },
    prompt:
      'Make the screens in scope responsive: mobile 360px, tablet 768px, laptop 1280px, desktop 1440px+. Use fluid layout (no px-fixed widths), collapse grids and sidebars sensibly, keep tables scrollable, and prove it with screenshots at a narrow and a wide viewport.'
      + '\n\n{input}'
  },
  {
    id: 'responsive-all',
    category: 'code',
    summary: {
      en: 'Responsive audit and fix across every screen of the project',
      th: 'ตรวจและแก้ Responsive ทุกหน้าจอของโปรเจกต์'
    },
    prompt:
      'Audit every screen of this project for responsive correctness on all devices (mobile 360px, tablet 768px, laptop 1280px, desktop 1440px+). Fix every overflow, cramped row, fixed width and broken navigation found, then verify with screenshots at a narrow and a wide viewport and list what you fixed per screen.'
      + '\n\n{input}'
  },
  {
    id: 'a11y',
    category: 'quality',
    summary: {
      en: 'Check accessibility and keyboard use of this screen',
      th: 'ตรวจการเข้าถึงและใช้คีย์บอร์ดของหน้านี้'
    },
    prompt:
      'Review this screen for accessibility: labels, roles, focus order, keyboard operation, contrast, and screen-reader text. Fix what is broken and list anything you could not verify.\n\n{input}'
  },
  {
    id: 'commit',
    category: 'git',
    summary: {
      en: 'Draft a conventional commit for the current changes',
      th: 'ร่างข้อความ commit ตามแบบแผน'
    },
    prompt:
      'Analyze the git diff and draft a concise conventional commit message: one subject line under 72 characters explaining why the change exists, then a short body if it needs one. Show the message; do not commit unless I ask.\n\n{input}'
  },
  {
    id: 'open-pr',
    category: 'git',
    summary: {
      en: 'Prepare a pull-request title and description',
      th: 'เตรียมชื่อและคำอธิบาย pull request'
    },
    prompt:
      'Summarize the changes on this branch and write a pull-request title and description: what changed, why, how it was verified, and what reviewers should look at first. Do not open the PR.\n\n{input}'
  },
  {
    id: 'migration',
    category: 'ops',
    summary: {
      en: 'Change a database schema safely',
      th: 'แก้โครงสร้างฐานข้อมูลอย่างปลอดภัย'
    },
    prompt:
      'Make this database change safely: a versioned migration that is idempotent, a compatible path for existing data, a backup before it runs, and a test that covers the upgrade. Never drop user data silently.\n\n{input}'
  },
  {
    id: 'thrift',
    category: 'ops',
    action: 'toggle-thrift',
    summary: {
      en: 'Cheap mode: smaller prompt, fewer steps, token ceiling per task',
      th: 'โหมดประหยัด: คำขอเล็กลง ขั้นตอนน้อยลง และมีเพดานโทเคนต่องาน'
    },
    prompt:
      'Work in token-thrifty mode: state the plan in one line, then read only the specific files or line ranges you need, never run the same command twice, and never retry the same fix more than once. Prefer one targeted change over rewriting a file, keep reasoning short, and report once at the end. If a step turns out unnecessary, skip it and say so instead of doing it for completeness.\n\n{input}'
  },
  {
    id: 'design',
    category: 'code',
    action: 'open-design',
    summary: {
      en: 'Design mode: apply the project’s screen style and prove it by screenshot',
      th: 'โหมดออกแบบ: ใช้สไตล์หน้าจอของโปรเจกต์ แล้วพิสูจน์ด้วยภาพจริง'
    },
    prompt:
      'Treat this as UI work with the project’s screen style in force. Read .d4ide/design.json first; if no style is chosen, ask me once which one to use and stop. Then build the interface strictly from those tokens (colour roles, radius, shadow, spacing, type scale), render it, take a screenshot with browser_screenshot, read the rendered text and console for errors, and fix what the render reveals before reporting. Report with the screenshot path and the exact tokens you used.\n\n{input}'
  },
  {
    id: 'finish',
    category: 'quality',
    summary: {
      en: 'Drive the task to fully done, with evidence',
      th: 'ทำจนจบสมบูรณ์ พร้อมหลักฐาน'
    },
    prompt:
      'Take this to 100% completion in this run, and do not stop at a plausible step. First define what "done" means for this task, then do the work, then prove it by running the build, the tests, or the real app and reporting the exact command and result. Do not report success for anything you have not verified, and if something genuinely cannot be finished (permissions, missing package, network, or a decision only the user can make), finish everything else and state precisely what remains and why.\n\n{input}'
  },
  {
    id: 'cleanup',
    category: 'ops',
    summary: {
      en: 'Remove dead code, unused files and stale config',
      th: 'เก็บโค้ดตาย ไฟล์ที่ไม่ใช้ และคอนฟิกค้าง'
    },
    prompt:
      'Find and remove dead code, unused files, stale configuration and abandoned feature flags in scope. Prove each removal is unused before deleting, and run the build and tests afterwards.\n\n{input}'
  }
];

/** The command set as skills, described in the UI language. */
export function builtinCommandSkills(language: 'th' | 'en'): SkillItem[] {
  return BUILTIN_COMMANDS.map((command) => ({
    id: command.id,
    name: command.id,
    description: command.summary[language] ?? command.summary.en,
    content: command.prompt,
    isGlobal: true
  }));
}

/**
 * Fills a command prompt with whatever the user typed after the command name,
 * so `/debug the login hangs` arrives as a complete instruction.
 */
export function expandCommandPrompt(command: BuiltinCommand, input: string): string {
  const detail = input.trim();
  if (!detail) {
    return command.prompt.replace(/\{input\}/g, '').trim();
  }
  return command.prompt.replace(/\{input\}/g, detail).trim();
}

/**
 * Which command chip, if any, an outgoing prompt was built from.
 *
 * The timeline shows the user's turn the way the composer showed it: a small
 * bold /chip above their own words. Matched on the template's prefix, so the
 * answer survives the user editing their detail text afterwards.
 */
export function commandChipFor(outgoing: string): { id: string; detail: string } | null {
  const text = outgoing.trim();
  for (const command of BUILTIN_COMMANDS) {
    const prefix = command.prompt.split('{input}')[0].replace(/\s+/g, ' ').trim();
    if (!prefix) continue;
    const flat = text.replace(/\s+/g, ' ');
    if (flat.startsWith(prefix)) {
      const rest = flat.slice(prefix.length).trim();
      return { id: command.id, detail: rest };
    }
  }
  return null;
}
