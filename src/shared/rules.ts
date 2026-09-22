/**
 * The laws every run obeys, whatever model is answering.
 *
 * Two different things have to agree here, and they are deliberately in one
 * file so they cannot drift apart:
 *
 *   1. What the model is *told*, in the system prompt. A model with no rules
 *      improvises: it deletes the folder it was handed, wanders into a second
 *      project to "check something", and reports a fix it never ran.
 *   2. What the engine *enforces*, in `security/scope-guard.ts` +
 *      `security/permission-engine.ts`. A rule that is only a sentence in a
 *      prompt holds until a model decides otherwise, so the laws marked
 *      `enforced: true` are also checked against the real tool call — on every
 *      provider, in every permission mode.
 *
 * Everything in this module is pure: no fs, no Electron, no provider. The texts
 * are bilingual because the user reads Thai and the model must be told the same
 * thing either way.
 */
export type RuleLanguage = 'th' | 'en';

/**
 * Is this law in force?
 *
 * The laws the engine enforces can be switched off by the user (settings →
 * กฎ). Everything downstream — the prompt block, the permission engine, the
 * runtime's loop guard — asks this one function, so a law can never be enforced
 * while the UI shows it as off, or vice versa.
 */
export function lawEnabled(id: string, disabled?: string[] | null): boolean {
  if (!Array.isArray(disabled) || disabled.length === 0) return true;
  return !disabled.includes(id);
}

export interface StandingLaw {
  id: string;
  /** The engine blocks or gates the action, not just the prompt. */
  enforced: boolean;
  th: { title: string; body: string };
  en: { title: string; body: string };
}

export const STANDING_LAWS: StandingLaw[] = [
  {
    id: 'stay-in-project',
    enforced: true,
    th: {
      title: 'อยู่แต่ในโปรเจกต์ที่เปิด',
      body:
        'ทุกไฟล์ที่อ่าน เขียน แก้ ลบ หรือย้าย ต้องอยู่ใต้โฟลเดอร์โปรเจกต์นี้เท่านั้น ห้ามแตะไฟล์ของโปรเจกต์อื่น ไดรฟ์อื่น หรือโฟลเดอร์ระบบ ถ้าจำเป็นต้องดูข้อมูลนอกโปรเจกต์จริง ๆ ให้บอกผู้ใช้และรออนุญาตก่อน'
    },
    en: {
      title: 'Stay inside the open project',
      body:
        'Every file you read, write, edit, delete or move must be inside this project folder. Never touch another project, another drive or a system folder. If you truly need something outside it, ask the user and wait.'
    }
  },
  {
    id: 'never-delete-the-project',
    enforced: true,
    th: {
      title: 'ห้ามลบโปรเจกต์ทั้งก้อน',
      body:
        'ห้ามลบรากโปรเจกต์ โฟลเดอร์ที่ครอบโปรเจกต์ หรือไฟล์ทั้งหมดของโปรเจกต์ (เช่น `rm -rf .`, `rm -rf *`, `git clean -xfd` ที่ราก) — ระบบจะปฏิเสธคำสั่งนี้ทุกโหมด การลบทั้งโปรเจกต์ทำได้เฉพาะเมื่อผู้ใช้สั่งลบชัดเจนในคำขอของงานนั้น และยังต้องได้รับการยืนยัน'
    },
    en: {
      title: 'Never delete the project itself',
      body:
        'Never delete the project root, a folder that contains it, or every file in the project (`rm -rf .`, `rm -rf *`, `git clean -xfd` at the root). The engine refuses these in every mode. Deleting the project is allowed only when the user asked for that in the request itself, and still needs confirmation.'
    }
  },
  {
    id: 'confirm-recursive-delete',
    enforced: true,
    th: {
      title: 'ลบแบบเรียกซ้ำต้องยืนยัน',
      body:
        'การลบไฟล์เดียวให้ทำได้ตามงานที่สั่ง แต่การลบโฟลเดอร์หรือลบหลายไฟล์พร้อมกันแบบเรียกซ้ำ ต้องได้รับการยืนยันจากผู้ใช้ก่อนเสมอ และให้บอกด้วยว่าจะลบอะไรบ้าง'
    },
    en: {
      title: 'Recursive deletes need confirmation',
      body:
        'Deleting a single file is part of the task, but deleting a folder or a recursive batch always needs the user to confirm first — say exactly what would be removed.'
    }
  },
  {
    id: 'obey-the-request',
    enforced: false,
    th: {
      title: 'ทำตามคำสั่งเท่านั้น',
      body:
        'ทำในสิ่งที่ผู้ใช้สั่ง ไม่ขยายขอบเขตเอง ไม่รื้อหรือรีแฟกเตอร์ส่วนที่ไม่มีใครขอ และไม่เปลี่ยนสิ่งที่ผู้ใช้กำหนดไว้ (ชื่อ ดีไซน์ ราคา ขอบเขตงาน) ถ้าคำขอไม่ชัด หรือขัดกับกฎข้ออื่น ให้ถามสั้น ๆ ก่อนลงมือ'
    },
    en: {
      title: 'Do what was asked — nothing more',
      body:
        'Do what the user asked. Do not widen the scope, do not refactor or "improve" what nobody asked about, and do not change what the user specified (names, design, prices, scope). If the request is unclear or conflicts with a law, ask one short question first.'
    }
  },
  {
    id: 'plan-then-act',
    enforced: false,
    th: {
      title: 'คิดก่อนลงมือ',
      body:
        'ก่อนแก้ไฟล์ทุกครั้ง ให้ระบุสั้น ๆ ว่าจะแก้ไฟล์ไหน ทำไม และคาดว่าจะได้อะไร แล้วจึงลงมือ — ห้ามแก้แบบลองเดาไปเรื่อย ๆ'
    },
    en: {
      title: 'Plan before you touch anything',
      body:
        'Before every change, state briefly which files you will touch, why, and what should happen. Then act — never edit on a guess and see what sticks.'
    }
  },
  {
    id: 'no-loops',
    enforced: true,
    th: {
      title: 'ห้ามวนอยู่ที่เดิม',
      body:
        'ถ้าแก้ปัญหาเดิมไม่สำเร็จ 2 ครั้ง ให้หยุด เปลี่ยนวิธี และรายงานสาเหตุที่แท้จริงพร้อมทางเลือก ห้ามลองวิธีเดิมซ้ำ และห้ามเรียกคำสั่งหรืออ่านไฟล์เดิมซ้ำด้วยเหตุผลเดิม'
    },
    en: {
      title: 'Never loop on the same failure',
      body:
        'If the same fix fails twice, stop, change the approach and report the real cause with options. Never repeat the same attempt, and never re-run a command or re-read a file for the reason you already used.'
    }
  },
  {
    id: 'finish-in-one-pass',
    enforced: false,
    th: {
      title: 'ทำงานเป็นระเบียบ จบในรอบเดียว',
      body:
        'เรียงลำดับงานให้ชัด ทำตามลำดับ ตรวจงานด้วยบิลด์ เทสต์ หรือการเปิดหน้าเว็บจริงก่อนบอกว่าเสร็จ และทำงานให้จบสมบูรณ์ — ถ้าติดข้อจำกัดจริง (สิทธิ์ แพ็กเกจ อินเทอร์เน็ต คีย์) ให้ทำส่วนที่ทำได้ให้เสร็จทั้งหมดแล้วบอกชัดว่าติดอะไร'
    },
    en: {
      title: 'Work in order and finish the job',
      body:
        'Keep the steps in order, verify with a build, a test or the real page before calling anything done, and finish the whole task. If something truly blocks you (permissions, a package, the network, a key), complete everything else and say exactly what is blocked.'
    }
  },
  {
    id: 'report-with-evidence',
    enforced: false,
    th: {
      title: 'รายงานสั้น พร้อมหลักฐาน',
      body:
        'รายงานผลครั้งเดียว ตรงประเด็น บอกไฟล์ที่แก้และผลของคำสั่งที่รันจริง ไม่รายงานความหวัง และไม่อ้างว่าเสร็จในสิ่งที่ยังไม่ได้ตรวจ'
    },
    en: {
      title: 'Report once, with evidence',
      body:
        'Report the result once, to the point: which files changed and what the commands actually printed. Do not report hope, and never claim something works without having checked it.'
    }
  }
];

/**
 * The laws as a numbered block for the system prompt.
 *
 * A law the user switched off is left out entirely rather than marked "off": a
 * prompt that explains which rule does not apply invites a model to argue about
 * it. Off means the model is never told the rule and the engine never enforces
 * it, so both sides of the app agree.
 */
export function formatStandingLaws(language: RuleLanguage, disabledLaws?: string[] | null): string {
  const header = language === 'th' ? '## กฎบังคับของ D4IDE (ทุกโมเดล ทุกโหมด)' : '## D4IDE standing laws (every model, every mode)';
  const enforcedTag = language === 'th' ? 'บังคับใช้โดยระบบ' : 'enforced by the engine';
  const lines = STANDING_LAWS.filter((law) => lawEnabled(law.id, disabledLaws)).map((law, index) => {
    const text = language === 'th' ? law.th : law.en;
    const tag = law.enforced ? ` [${enforcedTag}]` : '';
    return `${index + 1}. ${text.title}${tag} — ${text.body}`;
  });
  return [header, ...lines].join('\n');
}

/** The laws the engine enforces, for the UI to show with a lock. */
export function enforcedLaws(): StandingLaw[] {
  return STANDING_LAWS.filter((law) => law.enforced);
}

export interface RulesBlockInput {
  projectRules?: string;
  userRules?: string;
  language: RuleLanguage;
  /** Standing laws the user switched off; absent means every law applies. */
  disabledLaws?: string[] | null;
}

/**
 * The whole rules section of the system prompt: the standing laws, then the
 * user's own rules, then the project's. Empty sections contribute nothing, so a
 * project with no rules file does not spend tokens on empty headings.
 */
export function formatRulesBlock({ projectRules, userRules, language, disabledLaws }: RulesBlockInput): string {
  // A heading over an empty list is worse than nothing: when the user has
  // switched every law off, the section is left out and the block starts at
  // their own rules.
  const parts: string[] = STANDING_LAWS.some((law) => lawEnabled(law.id, disabledLaws))
    ? [formatStandingLaws(language, disabledLaws)]
    : [];

  const user = parseRuleLines(userRules ?? '');
  if (user.length > 0) {
    const header = language === 'th' ? '## กฎที่ผู้ใช้ตั้งไว้ (ทุกโปรเจกต์)' : '## Rules the user set (all projects)';
    parts.push([header, ...user.map((line) => `- ${line}`)].join('\n'));
  }

  const project = parseRuleLines(projectRules ?? '');
  if (project.length > 0) {
    const header = language === 'th' ? '## กฎของโปรเจกต์นี้' : "## This project's rules";
    parts.push([header, ...project.map((line) => `- ${line}`)].join('\n'));
  }

  return `\n${parts.join('\n\n')}`;
}

/** How many of the user's own rules are carried into the prompt. */
export const MAX_RULE_LINES = 60;
/** Longer than this and a "rule" is really a document. */
export const MAX_RULE_LENGTH = 400;

/**
 * Turns a rules file into the lines worth sending.
 *
 * Markdown headings are dropped — the file's title is not a rule — and bullets
 * and numbering are stripped so the prompt does not end up with `- - 1. …`. The
 * cap protects the token budget: a rules file that grew into an essay must not
 * quietly cost more than the task.
 */
export function parseRuleLines(text: string, max: number = MAX_RULE_LINES): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s*/, '').trim())
    // An HTML comment is a note to a human, not an instruction to a model.
    .filter((line) => line.length > 0 && !line.startsWith('<!--'))
    .map((line) => (line.length > MAX_RULE_LENGTH ? `${line.slice(0, MAX_RULE_LENGTH)}…` : line));

  // Later duplicates are the same rule said twice; keep the first.
  const seen = new Set<string>();
  const unique = lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, max);
}

/** The rule files a project may keep, in the order they are read. */
export const PROJECT_RULE_FILES = ['.d4ide/rules.md', 'D4IDE.md', '.cursorrules'] as const;

/**
 * Combines several rule files into one body.
 *
 * `loadProjectRules` used to return the *first* file it found, so adding a
 * `.d4ide/rules.md` silently threw away everything in `D4IDE.md` — the project's
 * own documentation — with nothing said about it. Every file is now kept, each
 * labelled with where it came from so a surprising rule can be traced back.
 */
export function mergeRuleFiles(files: { name: string; content: string }[], limit = 6000): string {
  const blocks: string[] = [];
  let used = 0;
  for (const file of files) {
    const body = (file.content ?? '').trim();
    if (!body) continue;
    const labelled = `<!-- ${file.name} -->\n${body}`;
    if (used + labelled.length > limit) {
      const room = Math.max(0, limit - used);
      if (room < 200) break;
      blocks.push(labelled.slice(0, room));
      break;
    }
    blocks.push(labelled);
    used += labelled.length;
  }
  return blocks.join('\n\n');
}

/** A refusal to destroy something is the opposite of permission to do it. */
const DESTRUCTION_REFUSED =
  /(อย่า|ห้าม|ไม่ต้อง|ไม่ให้|ไม่เอา|ไม่ลบ|never|don'?t|do not|without)\s*[^\n]{0,24}?(ลบ|ลบทิ้ง|ล้าง|รีเซ็ต|delete|remove|wipe|erase|reset|clear)/i;

/** A verb that destroys something. */
const DESTROY_VERB = /(ลบทิ้ง|ลบทั้ง|ลบทั้งหมด|ลบออกทั้งหมด|ล้างโปรเจ|รีเซ็ตโปรเจ|เริ่มโปรเจ[กค]ต์ใหม่|ลบโปรเจ|ลบโฟลเดอร์โปรเจ|delete|remove|wipe|erase|reset|clear|start over|from scratch)/i;
/** An object big enough to be the project itself rather than one file. */
const WHOLE_PROJECT_OBJECT =
  /(ทั้งหมด|ทั้งโปรเจ|ทั้งโฟลเดอร์|ทั้งโปรเจ[กค]ต์|ทุกไฟล์|ทั้งก้อน|โปรเจ[กค]ต์นี้|the (whole |entire )?(project|repo|repository|app|folder)|everything|all files|all the files|the codebase)/i;

/**
 * Did *this* request ask for the project to be destroyed?
 *
 * The law is "never delete the project **unless instructed**", so the engine has
 * to be able to read that instruction out of the user's own words rather than
 * trust the model's summary of them. Both parts are required: a destroying verb
 * *and* an object that means the whole project — `ลบไฟล์เก่า` is ordinary work,
 * `ลบโปรเจกต์ทิ้ง` is not. A refusal ("อย่าลบ…", "do not delete…") is read as
 * the opposite of permission.
 */
export function destructiveRequested(text: string | null | undefined): boolean {
  const body = (text ?? '').trim();
  if (!body) return false;
  if (DESTRUCTION_REFUSED.test(body)) return false;
  return DESTROY_VERB.test(body) && WHOLE_PROJECT_OBJECT.test(body);
}

/** The sentence that explains a refusal, so the user is never left guessing. */
export function projectDeletionRefusal(language: RuleLanguage, target: string): string {
  return language === 'th'
    ? `กฎบังคับ: ห้ามลบโฟลเดอร์โปรเจกต์หรือสิ่งที่ครอบโปรเจกต์ (${target}) ระบบปฏิเสธคำสั่งนี้ทุกโหมด — ถ้าต้องการลบทั้งโปรเจกต์จริง ๆ ให้สั่งชัดเจนในข้อความของคุณเอง แล้วยืนยันอีกครั้ง`
    : `Standing law: deleting the project folder or anything that contains it (${target}) is refused in every mode. If you really want the whole project removed, say so explicitly in your own message and confirm it once more.`;
}

export function outsideProjectRefusal(language: RuleLanguage, target: string, projectPath: string): string {
  return language === 'th'
    ? `กฎบังคับ: ทำงานได้เฉพาะในโปรเจกต์ที่เปิด (${projectPath}) — เส้นทาง ${target} อยู่นอกโปรเจกต์ ระบบปฏิเสธ ถ้าจำเป็นจริง ๆ ให้ผู้ใช้เป็นคนจัดการไฟล์นั้นเอง`
    : `Standing law: work stays inside the open project (${projectPath}) — ${target} is outside it, so this is refused. If it is genuinely needed, the user should handle that file.`;
}
