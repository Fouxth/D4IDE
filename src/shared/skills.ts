import { BUILTIN_COMMANDS } from './builtin-commands';
import { SkillItem } from './types';

/**
 * Skills as files, and the page that edits them.
 *
 * A skill is a markdown file — `<id>.md`, whose body is the instruction and
 * whose *first meaningful line* is the description the UI shows. That is a
 * readable format and a terrible one to edit blindly: the description is not a
 * field anywhere, so a form with a separate description box has to write it back
 * into the body, and a form that forgets loses it on the first save.
 *
 * Everything here is pure, so `splitSkillFile(composeSkillFile(d, b))` can be
 * pinned by a test instead of by opening the app and reading a list.
 */

export type SkillScope = 'builtin' | 'global' | 'project';

/** Shipped with the app (and therefore replaceable, not editable in place). */
export function isShippedSkillId(id: string): boolean {
  return BUILTIN_COMMANDS.some((command) => command.id === id);
}

/**
 * Where a skill comes from.
 *
 * A shipped command that the user has *not* overridden answers global, because
 * it lives in the app rather than in a folder — the distinction the page shows is
 * "can I delete this file", and for a shipped command there is no file.
 */
export function skillScopeOf(skill: Pick<SkillItem, 'id' | 'isGlobal'>): SkillScope {
  if (skill.isGlobal && isShippedSkillId(skill.id)) return 'builtin';
  return skill.isGlobal ? 'global' : 'project';
}

const firstMeaningfulLine = (content: string): string =>
  (content || '')
    .split('\n')
    .find((line) => line.trim() && !line.trim().startsWith('#'))
    ?.trim() ?? '';

/**
 * The file, as the two fields a form can edit.
 *
 * The description is the first meaningful line; the body is everything after it.
 * A file that starts with a heading keeps the whole heading in the body, because
 * a `#` line was never the description to begin with.
 */
export function splitSkillFile(content: string): { description: string; body: string } {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const index = lines.findIndex((line) => line.trim() && !line.trim().startsWith('#'));
  if (index < 0) return { description: '', body: (content || '').trim() };
  const description = lines[index].trim();
  const body = [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n').trim();
  return { description, body };
}

/**
 * The two fields, as the file.
 *
 * Idempotent on purpose: an old copy of the description is dropped before the
 * new one is written, so saving the same skill three times leaves one summary
 * rather than three stacked at the top of the instruction.
 */
export function composeSkillFile(description: string, body: string): string {
  const summary = (description || '').trim();
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && (!lines[0].trim() || lines[0].trim() === summary)) lines.shift();
  const rest = lines.join('\n').trim();
  if (!summary) return rest ? `${rest}\n` : '';
  return rest ? `${summary}\n\n${rest}\n` : `${summary}\n`;
}

/**
 * A file-safe id from whatever the user typed as a name.
 *
 * Thai is kept: skill names in this app are routinely Thai, and stripping the
 * letters out of "ตรวจความปลอดภัย" would leave an empty id and a skill that
 * cannot be saved at all.
 */
export function skillSlug(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0E00-\u0E7F_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64);
}
