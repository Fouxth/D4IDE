import { describe, expect, it } from 'vitest';
import { composeSkillFile, isShippedSkillId, skillScopeOf, skillSlug, splitSkillFile } from '../src/shared/skills';

/**
 * Skill files.
 *
 * A skill is `<id>.md`: the first meaningful line is the description the UI
 * shows, the rest is the instruction. The settings page edits those two as
 * fields, so the round trip is what has to hold — a save that dropped the
 * description would quietly empty every row in the list.
 */
describe('skill files', () => {
  it('reads the description off the first meaningful line', () => {
    const { description, body } = splitSkillFile('Review the diff carefully\n\nThen report bugs.');
    expect(description).toBe('Review the diff carefully');
    expect(body).toBe('Then report bugs.');
  });

  it('reads past a heading to find the description, and keeps the heading', () => {
    const { description, body } = splitSkillFile('# Migration helper\n\nWrite an idempotent migration.');
    // The reader in the main process ignores `#` lines the same way, so the list
    // and this form never disagree about what a skill is called.
    expect(description).toBe('Write an idempotent migration.');
    expect(body).toBe('# Migration helper');

    // Writing it back keeps both pieces and stays stable on the next read.
    const file = composeSkillFile(description, body);
    const again = splitSkillFile(file);
    expect(again.description).toBe(description);
    expect(again.body).toBe(body);
  });

  it('survives a round trip', () => {
    const file = composeSkillFile('Ship it with evidence', 'Run the tests, then report the exact command.');
    const back = splitSkillFile(file);
    expect(back.description).toBe('Ship it with evidence');
    expect(back.body).toBe('Run the tests, then report the exact command.');
    expect(composeSkillFile(back.description, back.body)).toBe(file);
  });

  it('does not stack summaries when the same skill is saved twice', () => {
    const once = composeSkillFile('Guard the schema', 'Never drop user data silently.');
    const twice = composeSkillFile('Guard the schema', splitSkillFile(once).body);
    expect(twice).toBe(once);
  });

  it('replaces the previous summary rather than keeping both', () => {
    // The editor hands back what `splitSkillFile` returned, which is how the old
    // summary stops being part of the body in the first place.
    const before = composeSkillFile('Old summary', 'Do the work.');
    const after = composeSkillFile('New summary', splitSkillFile(before).body);
    expect(after).toBe('New summary\n\nDo the work.\n');
  });

  it('handles an empty description and an empty body', () => {
    expect(composeSkillFile('', 'Only a body.')).toBe('Only a body.\n');
    expect(composeSkillFile('Only a summary', '')).toBe('Only a summary\n');
    expect(composeSkillFile('', '')).toBe('');
    expect(splitSkillFile('')).toEqual({ description: '', body: '' });
  });
});

describe('skill scope', () => {
  it('names shipped commands, the machine’s own skills and the project’s', () => {
    expect(skillScopeOf({ id: 'review', isGlobal: true })).toBe('builtin');
    expect(skillScopeOf({ id: 'my-house-style', isGlobal: true })).toBe('global');
    expect(skillScopeOf({ id: 'my-house-style', isGlobal: false })).toBe('project');
  });

  it('treats a project skill that overrides a shipped one as the project’s own', () => {
    expect(skillScopeOf({ id: 'review', isGlobal: false })).toBe('project');
    expect(isShippedSkillId('review')).toBe(true);
    expect(isShippedSkillId('review-mine')).toBe(false);
  });
});

describe('skill slugs', () => {
  it('turns a title into a file name', () => {
    expect(skillSlug('Deploy Checklist')).toBe('deploy-checklist');
    expect(skillSlug('  Release   notes  ')).toBe('release-notes');
    expect(skillSlug('fix(api): null token')).toBe('fixapi-null-token');
  });

  it('keeps Thai letters, which is what a Thai skill name is made of', () => {
    expect(skillSlug('ตรวจความปลอดภัย')).toBe('ตรวจความปลอดภัย');
    expect(skillSlug('ตรวจ ความปลอดภัย')).toBe('ตรวจ-ความปลอดภัย');
  });

  it('never returns something that cannot be a file name', () => {
    expect(skillSlug('///')).toBe('');
    expect(skillSlug('- leading and trailing -')).toBe('leading-and-trailing');
    expect(skillSlug('x'.repeat(200)).length).toBe(64);
  });
});
