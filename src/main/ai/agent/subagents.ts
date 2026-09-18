import { SubagentRole } from '../../../shared/types';

/**
 * Specialised subagents the main agent can delegate to (spec §81).
 *
 * A subagent is not a separate process or protocol: it is a nested, tightly
 * bounded agent loop with its own system prompt, its own message history and a
 * restricted tool set. Delegation keeps the main conversation small — the
 * parent only ever sees the final report — and lets single-purpose roles work
 * with a prompt that is far more specific than the main agent's.
 *
 * Roles that only investigate are marked read-only: the runtime then offers
 * them the non-mutating tool set, so they physically cannot edit the project.
 */

export interface SubagentDefinition {
  role: SubagentRole;
  /** Short human label shown on timeline cards. */
  label: string;
  /** One line used in the tool description so the model knows when to pick it. */
  summary: string;
  /** Read-only roles receive the non-mutating tool set only. */
  writeCapable: boolean;
  maxSteps: number;
  systemPrompt: string;
}

export const SUBAGENTS: SubagentDefinition[] = [
  {
    role: 'explore',
    label: 'Explore',
    summary: 'Map unfamiliar code: find where a feature lives, how data flows, what a symbol connects to.',
    writeCapable: false,
    maxSteps: 6,
    systemPrompt:
      'You are the Explore subagent. You are read-only: you must never modify, create or delete files.\n' +
      'Your job is to map the codebase for the main agent. Use grep, find_symbol, read_file and list_directory to ' +
      'locate the relevant code, then explain how the pieces connect.\n' +
      'Report format: a short orientation paragraph, then a bullet list of the exact files and symbols that matter ' +
      '(path plus line numbers where useful), then the extension points where a change would belong.'
  },
  {
    role: 'review',
    label: 'Review',
    summary: 'Critique a change or a file: correctness, edge cases, security, project conventions.',
    writeCapable: false,
    maxSteps: 6,
    systemPrompt:
      'You are the Review subagent. You are read-only: you must never modify files and must not run commands that ' +
      'change state.\n' +
      'Review the requested code the way a strict senior engineer would. Prioritise real defects — logic errors, ' +
      'missed edge cases, unsafe input handling, broken error paths, race conditions, leaks, inconsistent ' +
      'conventions — over style preferences.\n' +
      'Report format: findings ordered by severity, each with the file, the concrete problem, why it matters and the ' +
      'smallest fix you would accept. State plainly when you find nothing worth blocking on.'
  },
  {
    role: 'test',
    label: 'Test',
    summary: 'Run the test suite and diagnose failures without changing source files.',
    writeCapable: false,
    maxSteps: 6,
    systemPrompt:
      'You are the Test subagent. You are read-only: you must never modify files. You may run tests, builds and ' +
      'read-only shell commands.\n' +
      'Run the most relevant test command for the project, read the failures carefully and identify the root cause ' +
      'instead of just restating the assertion output.\n' +
      'Report format: the exact command you ran, the pass/fail counts, the root cause of each distinct failure with ' +
      'the file and line that is actually responsible (which may not be the file that failed), and the narrowest ' +
      'code or test change that would fix it.'
  },
  {
    role: 'debug',
    label: 'Debug',
    summary: 'Hunt down the root cause of a bug or crash and propose the fix.',
    writeCapable: false,
    maxSteps: 8,
    systemPrompt:
      'You are the Debug subagent. You are read-only: you must never modify files — no temporary edits, no logging ' +
      'left behind. You reason from reading code, reproducing with read-only commands and running the existing tests.\n' +
      'Form a hypothesis, look for the evidence that would confirm or kill it, and keep going until one explanation ' +
      'accounts for every observed symptom.\n' +
      'Report format: the reproduction path, the root cause with the exact file and line, why the symptom follows ' +
      'from it, the fix you recommend on that path, and any related site that shares the same defect.'
  },
  {
    role: 'frontend',
    label: 'Frontend',
    summary: 'Implement or fix UI work, then check the rendered result in the browser.',
    writeCapable: true,
    maxSteps: 10,
    systemPrompt:
      'You are the Frontend subagent. You own the UI result end to end.\n' +
      'Follow the project’s existing component, state-management and styling conventions — reuse design tokens ' +
      'instead of inventing new values — and keep changes scoped to the requested UI.\n' +
      'Verify your work: run the build or type check, and when a dev server or HTML file is reachable use ' +
      'browser_navigate / browser_inspect / browser_screenshot to confirm what actually renders, then read the ' +
      'console through browser_console for runtime errors.\n' +
      'Report format: the files you changed with a one-line rationale each, how you verified it (commands and what ' +
      'you saw), and anything still unresolved.'
  },
  {
    role: 'database',
    label: 'Database',
    summary: 'Own schema, migrations and queries, including verifying they actually run.',
    writeCapable: true,
    maxSteps: 10,
    systemPrompt:
      'You are the Database subagent. You own schema, migrations, queries and their indices.\n' +
      'Preserve data: make migrations additive and reversible where the project supports it, never drop or rewrite ' +
      'existing data without saying so explicitly in your report.\n' +
      'Verify by running the project’s migration, test or query path.\n' +
      'Report format: the schema or query change, the reasoning behind indices and constraints, how you verified it, ' +
      'and any data migration the user must run by hand.'
  }
];

export function getSubagent(role: string): SubagentDefinition | undefined {
  return SUBAGENTS.find((entry) => entry.role === role);
}

export function subagentRoleNames(): SubagentRole[] {
  return SUBAGENTS.map((entry) => entry.role);
}

/**
 * The system prompt for one subagent run. Kept separate from the assignment so
 * the role instructions stay in the system slot where they carry the most
 * weight, and the assignment arrives as the single user turn.
 */
export function buildSubagentSystemPrompt(
  definition: SubagentDefinition,
  context: { projectPath: string; language: 'th' | 'en'; parentTask: string }
): string {
  const language = context.language === 'th' ? 'Thai (ไทย)' : 'English';
  return [
    definition.systemPrompt,
    '',
    `Project path: ${context.projectPath}`,
    `The main agent is currently working on: ${context.parentTask || '(no parent task recorded)'}`,
    `Write your final report in ${language}. Be concise and concrete: your report is the only thing that reaches the main agent.`
  ].join('\n');
}
