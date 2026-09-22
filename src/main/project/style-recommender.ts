import { DESIGN_PROFILES, DesignStyle } from '../../shared/design-profiles';

/**
 * The AI's opinion, stated where the decision happens.
 *
 * The style chooser used to present four equal cards and let the user guess.
 * Most people opening a product brief have no idea what "modern SaaS" means for
 * their shop; the result was either a coin flip or a stall. The recommender
 * reads what the project already is — its words, its theme file — and commits to
 * one profile with a reason, which the card shows as a badge. The choice is
 * still the user's; the AI just stops pretending it has no view.
 *
 * Pure functions only: the tests run them against fixed strings, and the
 * runtime supplies the evidence it already has (the prompt, the project path).
 */

export type ExcludeAsk = Exclude<DesignStyle, 'ask'>;

export interface StyleEvidence {
  prompt: string;
  projectPath: string;
}

/** Words that signal each profile, Thai included. */
const SIGNALS: Array<{ style: ExcludeAsk; words: RegExp; weight: number }> = [
  {
    style: 'dark-premium',
    words: /\b(dashboard|admin|trading|crypto|wallet|ide|terminal|monitor|analytics|devtool|game|premium|backoffice)\b|แดชบอร์ด|แอดมิน|หลังบ้าน|เทรด|คริปโต|วอลเล็ต|เกม|พรีเมียม/i,
    weight: 3
  },
  {
    style: 'modern-saas',
    words: /\b(saas|startup|landing|marketing|crm|erp|pos|booking|platform|shop|store|rental|property|clinic|hotel)\b|ขาย|ร้าน|จอง|ลูกค้า|สตาร์ท|แพลตฟอร์ม|ธุรกิจ|อสังหา|ฟาร์ม|คลินิก|โรงแรม|รถเช่า|เช่า|โปรแกรม/i,
    weight: 2
  },
  {
    style: 'minimal',
    words: /\b(portfolio|docs|documentation|blog|resume|article|wiki)\b|พอร์ต|บล็อก|เอกสาร|บทความ|เรซู|สะอาด|เรียบ/i,
    weight: 2
  },
  {
    style: 'bold',
    words: /\b(promo|campaign|event|festival|launch|sale|banner|kids|party)\b|โปรโม|แคมเปญ|อีเวนต์|เทศกาล|ลดราคา|เด็ก|ปาร์ตี้|จัดจ้าน/i,
    weight: 2
  }
];

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

/**
 * Reads the project's own theme hints, if any. The first existing file wins;
 * a project that already picked a look is worth more than a keyword.
 */
export function readProjectStyleHints(projectPath: string): string {
  if (!projectPath) return '';
  const candidates = [
    path.join(projectPath, 'tailwind.config.js'),
    path.join(projectPath, 'tailwind.config.ts'),
    path.join(projectPath, 'src', 'index.css'),
    path.join(projectPath, 'src', 'App.css'),
    path.join(projectPath, 'package.json')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        if (raw.length > 0) return raw.slice(0, 20_000);
      }
    } catch {
      // Unreadable is the same as absent.
    }
  }
  return '';
}

/** True when the theme file already declares a dark palette. */
export function themeLooksDark(hints: string): boolean {
  if (!hints) return false;
  const dark =
    /#0[0-9a-fA-F]{2}\b|#1[0-9a-fA-F]{5}\b|darkMode|bg-gray-9|bg-neutral-9|bg-slate-9|rgba\(\s*0\s*,\s*0\s*,\s*0/i.test(
      hints
    );
  const light = /#f[f8]|#e[c-f]|bg-white|bg-gray-5|bg-slate-5/i.test(hints);
  return dark && !light;
}

/**
 * The recommendation: one profile. Deterministic on purpose — the same project
 * must get the same suggestion every time, or the badge teaches the user to
 * ignore it.
 */
export function recommendedStyleFor(evidence: StyleEvidence): ExcludeAsk {
  const scores = new Map<ExcludeAsk, number>();
  for (const signal of SIGNALS) {
    if (signal.words.test(evidence.prompt || '')) {
      scores.set(signal.style, (scores.get(signal.style) ?? 0) + signal.weight);
    }
  }

  const hints = readProjectStyleHints(evidence.projectPath);
  if (themeLooksDark(hints)) {
    scores.set('dark-premium', (scores.get('dark-premium') ?? 0) + 4);
  }

  let best: ExcludeAsk = 'modern-saas';
  let bestScore = 0;
  for (const [style, score] of scores) {
    if (score > bestScore) {
      best = style;
      bestScore = score;
    }
  }
  // No signal at all: the product-shaped default, not the first card.
  return bestScore > 0 ? best : 'modern-saas';
}

/** The one-line why, in the session's language. */
export function styleRecommendation(style: ExcludeAsk, language: 'th' | 'en'): string {
  const th = language === 'th';
  const label = DESIGN_PROFILES[style].label[language];
  const reasons: Record<ExcludeAsk, { th: string; en: string }> = {
    'dark-premium': {
      th: 'งานประเภทจอคอยดู (แดชบอร์ด/แอดมิน/เครื่องมือ) อ่านสบายตาในที่แสงน้อย และดูโปร่งไม่อวดตกแต่ง',
      en: 'Screen-heavy tools (dashboards/admin/devtools) read calmly in low light and keep the chrome out of the way'
    },
    'modern-saas': {
      th: 'งานธุรกิจ/ขายของ/ลูกค้าทั่วไป ได้ความน่าเชื่อถือและอ่านภาษาไทยลื่นที่สุด',
      en: 'Business and customer-facing products get credibility and the most comfortable Thai reading'
    },
    minimal: {
      th: 'งานที่เนื้อหาเป็นพระเอก (เอกสาร/บล็อก/พอร์ต) อ่านง่าย โหลดเร็ว ไม่ล้าสมัย',
      en: 'Content-led work (docs/blog/portfolio) reads cleanly, loads fast, and ages well'
    },
    bold: {
      th: 'งานที่ต้องดึงดูดทันที (โปรโมชัน/อีเวนต์) ตัวหนังสือใหญ่ตัดกันชัด',
      en: 'Attention-first work (promotions/events) — heavy type, loud contrast'
    }
  };
  return th ? `AI แนะนำ: ${label} — ${reasons[style].th}` : `AI suggests: ${label} — ${reasons[style].en}`;
}

/*
 * The three signals an interface order is recognised by: a verb that asks for
 * work, and a word that names either a screen or a product that has screens.
 *
 * Judged from the *request*, not from the folder it lands in. Reading the
 * project instead meant a greeting in any project that already held a `.tsx`
 * file raised the style chooser — the single loudest complaint about the card —
 * because "this folder has components" was taken as "this task is about them".
 */
const ORDER_VERBS =
  /(สร้าง|ทำ|เขียน|แก้|ปรับ|เพิ่ม|เปลี่ยน|ออกแบบ|พัฒนา|อัปเดต|อัพเดต|ต่อยอด|ช่วย|อยากได้|ต้องการ|ขอ)|\b(build|create|make|add|write|design|redesign|implement|develop|update|fix|change|adjust|restyle|style|generate|revamp)\b/i;

/** Words that name a screen, a piece of one, or the look of one. */
const SCREEN_WORDS =
  /(หน้าจอ|หน้าเว็บ|หน้าแรก|หน้า|ปุ่ม|ฟอร์ม|เมนู|การ์ด|ธีม|ฟอนต์|สี|ดีไซน์|สไตล์|หน้าตา|เลย์เอาต์|แถบ|ป๊อปอัป|โมดัล|แอนิเมชัน|แดชบอร์ด)|\b(ui|ux|page|screen|landing|hero|layout|design|style|component|button|form|dashboard|website|web app|storefront|admin|saas|navbar|menu|modal|card|theme|font|css|tailwind|frontend|interface|view)\b/i;

/** A product brief: what is being built has screens even when it says no interface. */
const PRODUCT_WORDS =
  /(โปรแกรม|แอป|เว็บ|เว็บไซต์|ระบบ|แพลตฟอร์ม|ร้าน|ขายของ|จอง|คลินิก|โรงแรม|อสังหา|พอร์ต|บล็อก|หลังบ้าน)|\b(app|application|platform|shop|store|booking|crm|erp|pos|portfolio|blog|saas)\b/i;

/**
 * Talk that is not an order at all: a greeting, thanks, an acknowledgement.
 *
 * Anchored at the start and *stripped* rather than treated as a veto, because
 * "สวัสดีครับ ช่วยทำหน้าโปรไฟล์ใหม่" is a real order with a hello in front of it.
 * What gets refused is the message that is only a greeting.
 */
const CHIT_CHAT =
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ดีจ้า|ขอบคุณ|ขอบใจ|ขอโทษ|โอเค|โอเคเลย|ครับ|ค่ะ|จ้า|ทดสอบ|เทสต์|hi|hello|hey|yo|sup|thanks|thank you|ok|okay|good morning|good evening|good afternoon|what's up|how are you)/i;

/**
 * A question is someone asking what something is, not ordering a screen built —
 * and the agent answers those *about* the interface all the time.
 *
 * Anchored at the start for the same reason as the greeting: "how do I build a
 * page like this?" is a question, while "add the button that shows how many
 * results there are" is an order that merely contains the word "how".
 */
const ASKING =
  /^(ทำไม|อย่างไร|ยังไง|อะไร|ที่ไหน|เมื่อไหร่|ใคร|คือ|สรุป|อธิบาย|ช่วยอธิบาย|บอก|what|why|how|when|where|which|who|explain|describe|tell me|summarise|summarize)/i;

/**
 * Is this prompt asking for interface work?
 *
 * The style chooser is a real interruption — it stops the run and asks a
 * question — so it may only appear when the answer would change what is about to
 * be built. Three things have to hold: the message asks for work, it names a
 * screen or a product that has screens, and it is not small talk, a question, or
 * a continuation of a task already under way.
 *
 * Pure, and deliberately narrow: a false negative costs one card that simply
 * does not appear (the style stays `ask` and the next real UI request raises it),
 * while a false positive stops a run the user never asked to be stopped.
 */
export function isUiWorkRequest(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;

  // Leading greeting and punctuation are removed, not fatal: what is left is the
  // actual request, and a message with nothing left is just someone saying hello.
  const body = text.replace(CHIT_CHAT, '').replace(/^[\s,.;:!?'"–—-]+/, '').trim();
  if (body.length < 4) return false;
  if (ASKING.test(body)) return false;
  if (isContinuationPrompt(body)) return false;
  if (!ORDER_VERBS.test(body)) return false;
  return SCREEN_WORDS.test(body) || PRODUCT_WORDS.test(body);
}

/**
 * Is this prompt a continuation of work already under way?
 *
 * "ทำต่อ" and friends resume an existing task; they carry no new design
 * decision, so asking for a screen style on them was the single most-reported
 * annoyance: the user says "finish it" and gets a style picker instead. The
 * match is deliberately narrow — short phrases that mean "go on" — because a
 * false positive would silence a real first ask.
 */
/**
 * The verdict itself now lives in `shared/`, because the composer needs the very
 * same answer to decide whether Build/Plan are a choice at all — and two copies
 * of this rule would eventually disagree. Re-exported so the runtime and the
 * existing tests keep their import path.
 */
export { isSmallTalkOnly } from '../../shared/small-talk';

export function isContinuationPrompt(prompt: string): boolean {
  const text = (prompt || '').trim().toLowerCase();
  if (!text) return false;
  if (text.length > 120) return false;
  return (
    /^(ทำต่อ|ต่อไป|ต่อจากเดิม|ต่อเลย|ทำต่อจากที่ค้าง|ทำตามแผนเดิม|เดินหน้าต่อ|ไปต่อ|ทำให้เสร็จ|ทำจนจบ|เสร็จให้ครบ|ดำเนินการต่อ)\b/.test(
      text
    ) ||
    /^(continue|keep going|go on|resume|proceed|carry on|finish it|finish the|complete the)\b/.test(text) ||
    text === 'ต่อ'
  );
}
