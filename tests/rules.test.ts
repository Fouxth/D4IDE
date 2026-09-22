import { describe, expect, it } from 'vitest';
import {
  MAX_RULE_LINES,
  STANDING_LAWS,
  destructiveRequested,
  enforcedLaws,
  formatRulesBlock,
  formatStandingLaws,
  lawEnabled,
  mergeRuleFiles,
  outsideProjectRefusal,
  parseRuleLines,
  projectDeletionRefusal
} from '../src/shared/rules';

/**
 * The laws the user asked for in words — "ห้ามลบโปรเจกต์ทั้งหมดถ้าไม่ได้สั่ง",
 * "ไม่ให้ออกนอกลู่นอกทาง", "ทำตามคำสั่ง ไม่วนอยู่ที่เดิม" — stated once and
 * enforced elsewhere. These pin the text the model is told and the reading of
 * the user's own message that decides whether destruction was asked for.
 */
describe('standing laws', () => {
  it('covers the four things the user asked for, and locks the hard ones', () => {
    const ids = enforcedLaws().map((law) => law.id);
    expect(ids).toEqual(['stay-in-project', 'never-delete-the-project', 'confirm-recursive-delete', 'no-loops']);
  });

  it('has unique ids and both languages for every law', () => {
    const ids = STANDING_LAWS.map((law) => law.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const law of STANDING_LAWS) {
      expect(law.th.title.length, law.id).toBeGreaterThan(4);
      expect(law.th.body.length, law.id).toBeGreaterThan(40);
      expect(law.en.title.length, law.id).toBeGreaterThan(4);
      expect(law.en.body.length, law.id).toBeGreaterThan(40);
    }
  });

  it('names the enforced ones in the block the model reads', () => {
    const th = formatStandingLaws('th');
    expect(th).toContain('กฎบังคับของ D4IDE');
    expect(th).toContain('บังคับใช้โดยระบบ');
    expect(th).toContain('ห้ามลบโปรเจกต์ทั้งก้อน');
    const en = formatStandingLaws('en');
    expect(en).toContain('standing laws');
    expect(en).toContain('enforced by the engine');
    expect(en).toContain('Stay inside the open project');
  });
});

describe('parseRuleLines', () => {
  it('keeps what a person would call a rule and drops the markdown around it', () => {
    const parsed = parseRuleLines(
      ['# Project rules', '', '- ใช้ TypeScript เท่านั้น', '* ห้ามใช้ any', '1. อธิบายสั้น', '<!-- a note to a human -->', '   '].join('\n')
    );
    expect(parsed).toEqual(['ใช้ TypeScript เท่านั้น', 'ห้ามใช้ any', 'อธิบายสั้น']);
  });

  it('drops a line said twice and caps how many cost tokens', () => {
    expect(parseRuleLines('- ห้ามลบ\n- ห้ามลบ\n- อีกข้อ')).toEqual(['ห้ามลบ', 'อีกข้อ']);
    const many = Array.from({ length: 200 }, (_, i) => `- rule ${i}`).join('\n');
    expect(parseRuleLines(many)).toHaveLength(MAX_RULE_LINES);
  });

  it('truncates a rule that is really an essay', () => {
    const [line] = parseRuleLines(`- ${'ก'.repeat(900)}`);
    expect(line.length).toBeLessThanOrEqual(401);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('formatRulesBlock', () => {
  it('always carries the laws, even with no rules files at all', () => {
    const block = formatRulesBlock({ language: 'th' });
    expect(block).toContain('กฎบังคับของ D4IDE');
    expect(block).not.toContain('กฎของโปรเจกต์นี้');
  });

  it('labels the user’s rules and the project’s separately', () => {
    const block = formatRulesBlock({
      language: 'en',
      userRules: '- prices are in THB',
      projectRules: '- never touch src/legacy'
    });
    expect(block).toContain('Rules the user set (all projects)');
    expect(block).toContain('- prices are in THB');
    expect(block).toContain("This project's rules");
    expect(block).toContain('- never touch src/legacy');
  });
});

describe('laws the user switched off', () => {
  const lawTitle = (id: string, language: 'th' | 'en') => {
    const law = STANDING_LAWS.find((entry) => entry.id === id)!;
    return language === 'th' ? law.th.title : law.en.title;
  };

  it('reports every law as in force by default', () => {
    for (const law of STANDING_LAWS) {
      expect(lawEnabled(law.id, [])).toBe(true);
      expect(lawEnabled(law.id, undefined)).toBe(true);
    }
  });

  it('reports exactly the switched-off law as out of force', () => {
    expect(lawEnabled('stay-in-project', ['stay-in-project'])).toBe(false);
    expect(lawEnabled('never-delete-the-project', ['stay-in-project'])).toBe(true);
  });

  it('leaves a switched-off law out of the prompt entirely', () => {
    // Not "marked off": a prompt that explains which rule does not apply invites
    // the model to argue about it, and the engine is not enforcing it anyway.
    const block = formatRulesBlock({ language: 'en', disabledLaws: ['stay-in-project'] });
    expect(block).not.toContain(lawTitle('stay-in-project', 'en'));
    expect(block).toContain(lawTitle('never-delete-the-project', 'en'));
  });

  it('drops the laws section altogether when nothing is enforced', () => {
    const all = STANDING_LAWS.map((law) => law.id);
    const block = formatRulesBlock({ language: 'th', disabledLaws: all, userRules: '- ใช้ TypeScript เท่านั้น' });
    expect(block).not.toContain('กฎบังคับของ D4IDE');
    // The user's own rules are not laws and survive every toggle.
    expect(block).toContain('ใช้ TypeScript เท่านั้น');
  });

  it('never drops a law the user did not name, whatever else is off', () => {
    const block = formatRulesBlock({
      language: 'en',
      disabledLaws: ['confirm-recursive-delete', 'no-such-law']
    });
    expect(block).toContain(lawTitle('stay-in-project', 'en'));
    expect(block).toContain(lawTitle('no-loops', 'en'));
  });
});

describe('mergeRuleFiles', () => {
  it('keeps every rule file, not just the first one found', () => {
    // The bug this replaces: adding `.d4ide/rules.md` silently dropped D4IDE.md.
    const merged = mergeRuleFiles([
      { name: '.d4ide/rules.md', content: 'ห้ามแตะ legacy' },
      { name: 'D4IDE.md', content: 'โปรเจกต์นี้คือระบบอสังหา' }
    ]);
    expect(merged).toContain('.d4ide/rules.md');
    expect(merged).toContain('ห้ามแตะ legacy');
    expect(merged).toContain('D4IDE.md');
    expect(merged).toContain('ระบบอสังหา');
  });

  it('contributes nothing for empty files and stays inside its budget', () => {
    expect(mergeRuleFiles([{ name: 'a', content: '   ' }])).toBe('');
    const merged = mergeRuleFiles([{ name: 'big', content: 'x'.repeat(9000) }], 1000);
    expect(merged.length).toBeLessThanOrEqual(1000);
  });
});

describe('destructiveRequested', () => {
  it('reads an explicit order to remove the project', () => {
    expect(destructiveRequested('ลบโปรเจกต์นี้ทิ้งทั้งหมด')).toBe(true);
    expect(destructiveRequested('เริ่มโปรเจกต์ใหม่ทั้งหมดเลย')).toBe(true);
    expect(destructiveRequested('delete the whole project and start over')).toBe(true);
    expect(destructiveRequested('wipe everything in this repo')).toBe(true);
  });

  it('does not mistake ordinary work for permission to destroy', () => {
    expect(destructiveRequested('ลบไฟล์เก่าที่ไม่ใช้แล้ว')).toBe(false);
    expect(destructiveRequested('delete the unused import in app.ts')).toBe(false);
    expect(destructiveRequested('เพิ่มหน้าล็อกอินให้โปรเจกต์')).toBe(false);
    expect(destructiveRequested('')).toBe(false);
    expect(destructiveRequested(null)).toBe(false);
  });

  it('reads a refusal as the opposite of permission', () => {
    expect(destructiveRequested('อย่าลบโปรเจกต์นี้นะ')).toBe(false);
    expect(destructiveRequested('ห้ามลบทั้งโปรเจกต์เด็ดขาด')).toBe(false);
    expect(destructiveRequested('do not delete the project')).toBe(false);
  });
});

describe('refusals the user actually reads', () => {
  it('says what was refused and how to proceed on purpose', () => {
    const th = projectDeletionRefusal('th', 'F:\\HuayD');
    expect(th).toContain('ห้ามลบ');
    expect(th).toContain('F:\\HuayD');
    const en = projectDeletionRefusal('en', 'F:\\HuayD');
    expect(en).toContain('refused in every mode');

    const outside = outsideProjectRefusal('th', 'C:\\Windows', 'F:\\HuayD');
    expect(outside).toContain('C:\\Windows');
    expect(outside).toContain('F:\\HuayD');
  });
});
