import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DESIGN_PROFILES,
  DESIGN_STYLE_IDS,
  buildDesignBrief,
  designQuestion,
  isDesignStyle
} from '../src/shared/design-profiles';
import {
  MAX_MEMORY_CHARS,
  buildMemoryBlock,
  memoryPath,
  memorySkeleton,
  readProjectMemory,
  writeProjectMemory
} from '../src/main/project/project-memory';
import { readProjectDesign, writeProjectDesign } from '../src/main/project/design-store';

/**
 * The reason the interface looked generic: nothing in the prompt said what a
 * good screen is for this project. A profile has to be concrete enough to
 * implement from — real colours, real spacing — and it has to survive being
 * written to, and read back from, the project itself.
 */
describe('design profiles', () => {
  it('ships the four styles plus the ask-first option', () => {
    expect(DESIGN_STYLE_IDS).toEqual(['minimal', 'modern-saas', 'dark-premium', 'bold', 'ask']);
    for (const profile of Object.values(DESIGN_PROFILES)) {
      expect(profile.colors.accent).toMatch(/^#|^rgba/);
      expect(profile.fonts.thai.length).toBeGreaterThan(2);
      expect(profile.rules.length).toBeGreaterThanOrEqual(4);
      expect(profile.type.body).toContain('1.');
    }
  });

  it('writes a brief an implementation can be checked against', () => {
    const brief = buildDesignBrief('modern-saas', 'en');
    // Colour roles, spacing and type have to be in the text, or the model is
    // back to inventing values.
    expect(brief).toContain(DESIGN_PROFILES['modern-saas'].colors.accent);
    expect(brief).toContain('Radius');
    expect(brief).toContain('Spacing');
    expect(brief).toContain('Type scale');
    expect(brief).toMatch(/do not invent colours/i);
  });

  it('builds the brief and the question in Thai too, not just English', () => {
    const thaiBrief = buildDesignBrief('minimal', 'th');
    expect(thaiBrief).toContain('มินิมอล');
    expect(thaiBrief).toContain('ระยะห่าง');
    const question = designQuestion('th');
    expect(question).toContain('ยังไม่ได้เลือกสไตล์หน้าจอ');
    for (const profile of Object.values(DESIGN_PROFILES)) {
      expect(question).toContain(profile.label.th);
    }
  });

  it('carries the anti-AI-slop bans in every profile, in both languages', () => {
    for (const style of ['minimal', 'modern-saas', 'dark-premium', 'bold'] as const) {
      const en = buildDesignBrief(style, 'en');
      const th = buildDesignBrief(style, 'th');
      // The tells users actually notice must be banned in the language the
      // model is addressed in — a ban the model never reads is not a ban.
      expect(en).toContain('Ban 1:');
      expect(en).toContain('purple-blue gradients');
      expect(en).toContain('emoji as icons');
      expect(th).toContain('ห้าม 1:');
      expect(th).toContain('เกรเดียนต์ม่วง-น้ำเงิน');
      expect(th).toContain('อีโมจิแทนไอคอน');
    }
  });

  it('only accepts known style ids from stored data', () => {
    expect(isDesignStyle('minimal')).toBe(true);
    expect(isDesignStyle('ask')).toBe(true);
    expect(isDesignStyle('neon')).toBe(false);
    expect(isDesignStyle(undefined)).toBe(false);
  });
});

describe('project memory and design store', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-mem-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('reports a project with no memory as missing, and offers a skeleton', () => {
    const memory = readProjectMemory(project);
    expect(memory.exists).toBe(false);
    expect(memory.content).toBe('');
    expect(memorySkeleton(project, 'th')).toContain('โปรเจกต์นี้คืออะไร');
    expect(memorySkeleton(project, 'en')).toContain('What this is');
  });

  it('writes the memory inside the project, where it belongs', () => {
    writeProjectMemory(project, '# Rental SaaS\n\nA Thai rental management product.');
    const file = memoryPath(project);
    expect(file).toContain(path.join('.d4ide', 'project.md'));
    expect(fs.existsSync(file)).toBe(true);

    const memory = readProjectMemory(project);
    expect(memory.exists).toBe(true);
    expect(memory.content).toContain('Rental SaaS');
    expect(memory.updatedAt).toBeGreaterThan(0);
  });

  it('keeps the memory inside its ceiling, because it is sent in every request', () => {
    writeProjectMemory(project, 'line\n'.repeat(4000));
    const memory = readProjectMemory(project);
    expect(memory.content.length).toBeLessThan(MAX_MEMORY_CHARS + 200);
    expect(memory.content).toContain('trimmed to keep this file small');
  });

  it('injects nothing into the prompt when there is no memory yet', () => {
    expect(buildMemoryBlock(readProjectMemory(project), 'en')).toBe('');
    writeProjectMemory(project, 'Some facts.');
    expect(buildMemoryBlock(readProjectMemory(project), 'en')).toContain('Some facts.');
    expect(buildMemoryBlock(readProjectMemory(project), 'th')).toContain('ความจำโปรเจกต์');
  });

  it('remembers the chosen style per project, and defaults to asking', () => {
    expect(readProjectDesign(project).style).toBe('ask');

    const saved = writeProjectDesign(project, { style: 'dark-premium', notes: 'keep the glow subtle' });
    expect(saved.style).toBe('dark-premium');
    expect(saved.chosenAt).toBeGreaterThan(0);

    const reread = readProjectDesign(project);
    expect(reread.style).toBe('dark-premium');
    expect(reread.notes).toBe('keep the glow subtle');
  });

  it('ignores a junk style file instead of failing the run', () => {
    fs.mkdirSync(path.join(project, '.d4ide'), { recursive: true });
    fs.writeFileSync(path.join(project, '.d4ide', 'design.json'), '{ not json at all');
    expect(readProjectDesign(project).style).toBe('ask');
  });

  it('does not force a style on a project that cannot store one', () => {
    // A read-only project must still work: the choice simply does not persist.
    const saved = writeProjectDesign(path.join(project, 'does', 'not', 'exist', 'x'), { style: 'bold' });
    expect(saved.style).toBe('bold');
  });
});
