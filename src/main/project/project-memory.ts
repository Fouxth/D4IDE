import fs from 'fs';
import path from 'path';

/**
 * What this project is, remembered in the project itself.
 *
 * Every session used to start blind: the agent re-read package.json, guessed the
 * stack from the file tree, and asked the user what they were building — over
 * and over, paying for the exploration each time. A short file inside the
 * project fixes both problems at once: the agent knows what this is on turn one,
 * and it costs a few hundred tokens instead of thousands of rediscovery.
 *
 * It lives in the repository (`.d4ide/project.md`), not in the app's database,
 * for three reasons: it belongs to the project and should travel with it, a
 * human can read and correct it in any editor, and it is exactly what a teammate
 * would need to understand the work.
 */

export const MEMORY_DIR = '.d4ide';
export const MEMORY_FILE = 'project.md';
/** Hard ceiling, so a long-lived memory file cannot become a token problem. */
export const MAX_MEMORY_CHARS = 6000;

export interface ProjectMemory {
  /** Absolute path of the file, whether or not it exists yet. */
  file: string;
  exists: boolean;
  content: string;
  updatedAt: number | null;
}

export function memoryPath(projectPath: string): string {
  return path.join(projectPath, MEMORY_DIR, MEMORY_FILE);
}

export function readProjectMemory(projectPath: string): ProjectMemory {
  const file = memoryPath(projectPath);
  try {
    const stat = fs.statSync(file);
    const content = fs.readFileSync(file, 'utf8');
    return { file, exists: true, content, updatedAt: stat.mtimeMs };
  } catch {
    return { file, exists: false, content: '', updatedAt: null };
  }
}

/**
 * Writes the memory, keeping it within its ceiling.
 *
 * Over the limit the oldest lines go first: the top of the file holds what the
 * project *is* (which must survive), while run notes accumulate at the bottom.
 */
export function writeProjectMemory(projectPath: string, content: string): ProjectMemory {
  const file = memoryPath(projectPath);
  let body = String(content ?? '').trim();
  if (body.length > MAX_MEMORY_CHARS) {
    const head = body.slice(0, MAX_MEMORY_CHARS);
    const cut = head.lastIndexOf('\n');
    body = `${cut > 0 ? head.slice(0, cut) : head}\n\n_(older notes trimmed to keep this file small)_`;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body}\n`, 'utf8');
  return readProjectMemory(projectPath);
}

/**
 * A starting point for a project that has none.
 *
 * Deliberately short and mostly blank: the value is in the agent filling it from
 * the real code, not from a template full of questions nobody answers. A
 * skeleton with headings keeps the result consistent between projects.
 */
export function memorySkeleton(projectPath: string, language: 'th' | 'en'): string {
  const name = path.basename(projectPath);
  if (language === 'th') {
    return [
      `# ความจำโปรเจกต์ — ${name}`,
      '',
      '## โปรเจกต์นี้คืออะไร',
      '(รอเอเจนต์สรุปจากโค้ดจริง: ผลิตภัณฑ์คืออะไร ให้ใครใช้ แก้ปัญหาอะไร)',
      '',
      '## เทคโนโลยี',
      '(เฟรมเวิร์ก ภาษา ฐานข้อมูล ตัวรันแพ็กเกจ)',
      '',
      '## โครงสร้างสำคัญ',
      '(โฟลเดอร์/ไฟล์ที่ต้องรู้ก่อนแก้ ไม่ต้องไล่ทั้งโปรเจกต์)',
      '',
      '## ข้อตกลงของโปรเจกต์',
      '(สไตล์โค้ด การตั้งชื่อ วิธีรันทดสอบ คำสั่งที่ใช้บ่อย)',
      '',
      '## สถานะล่าสุด',
      '(สิ่งที่ทำเสร็จและสิ่งที่ค้างอยู่ — อัปเดตทุกครั้งที่จบงาน)'
    ].join('\n');
  }
  return [
    `# Project memory — ${name}`,
    '',
    '## What this is',
    '(to be filled by the agent from the real code: the product, who it is for, what it solves)',
    '',
    '## Stack',
    '(framework, language, database, package manager)',
    '',
    '## Layout that matters',
    '(the folders and files to know before editing — no need to rescan the tree)',
    '',
    '## Project conventions',
    '(code style, naming, how tests are run, commands used often)',
    '',
    '## Current state',
    '(what is done and what is left — updated at the end of each task)'
  ].join('\n');
}

/** The block injected into the system prompt. Empty when there is nothing to say. */
export function buildMemoryBlock(memory: ProjectMemory, language: 'th' | 'en'): string {
  if (!memory.exists || !memory.content.trim()) return '';
  const th = language === 'th';
  return [
    '',
    th ? '## ความจำโปรเจกต์ (.d4ide/project.md)' : '## Project memory (.d4ide/project.md)',
    th
      ? 'อ่านส่วนนี้ก่อนทำงาน — ไม่ต้องสำรวจโปรเจกต์ซ้ำในสิ่งที่รู้อยู่แล้ว ถ้าพบว่าผิดหรือล้าสมัยให้แก้ไฟล์นี้ทันที'
      : 'Read this before working — do not re-explore what is already known here. If anything is wrong or stale, correct the file immediately.',
    memory.content
  ].join('\n');
}

/**
 * The closing instruction that keeps the memory alive.
 *
 * Without it the file is written once and rots, which is worse than no file: a
 * stale memory makes the agent confidently wrong.
 */
export function memoryUpkeepRules(language: 'th' | 'en'): string {
  return language === 'th'
    ? 'ปิดท้ายทุกงาน: อัปเดต .d4ide/project.md ให้ตรงกับของจริง (โปรเจกต์คืออะไร เทคโนโลยี โครงสร้าง ข้อตกลง และสถานะล่าสุด) โดยเขียนทับหัวข้อเดิม ไม่ต้องต่อท้ายยาว ๆ ถ้าไฟล์ยังไม่มีให้สร้างจากข้อเท็จจริงที่เห็นในโค้ด ห้ามเดา'
    : 'At the end of every task: update .d4ide/project.md so it matches reality (what the project is, its stack, layout, conventions and current state). Rewrite the headings rather than appending endlessly; if the file does not exist, create it from facts you actually saw in the code — never guess.';
}

/**
 * The memory rule for a message that asks for nothing.
 *
 * The upkeep rule ends "every task" — and saying hello is not a task. Read
 * literally it turned a greeting into a survey: the memory file did not exist,
 * so the only way to obey was to go and read the codebase and write one. The
 * user asked for a hello back and got a project report.
 *
 * Nothing was changed, so there is nothing to record; the rule says that out
 * loud rather than leaving it to inference, because "do not update the memory"
 * is exactly the kind of absence a model fills in with exploration.
 */
export function memoryIdleRule(language: 'th' | 'en'): string {
  return language === 'th'
    ? 'ข้อความนี้ไม่ได้สั่งงานและไม่ได้แก้ไฟล์ใด ๆ: ไม่ต้องสร้างหรืออัปเดต .d4ide/project.md และไม่ต้องสำรวจโปรเจกต์เพื่อเตรียมข้อมูลสำหรับไฟล์นั้น'
    : 'This message asks for no work and changes no file: do not create or update .d4ide/project.md, and do not explore the project to gather material for it.';
}
