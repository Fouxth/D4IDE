/**
 * The design system D4IDE builds with.
 *
 * There was none before, and it showed: asked for a page, the agent produced a
 * green button on white cards with default spacing, because "make it beautiful"
 * was the only instruction it had and nothing in the prompt said what beautiful
 * means. A style is not a matter of taste the model should invent per file — it
 * is a small, explicit set of decisions (type scale, spacing, colour roles,
 * radii, shadows) applied consistently.
 *
 * Each profile below is concrete enough to implement without taste, and the
 * brief built from it is short enough to sit in every UI request.
 */

export type DesignStyle = 'minimal' | 'modern-saas' | 'dark-premium' | 'bold' | 'ask';

export interface DesignProfile {
  id: Exclude<DesignStyle, 'ask'>;
  label: { th: string; en: string };
  summary: { th: string; en: string };
  /** Font families to load: [Latin, Thai]. */
  fonts: { latin: string; thai: string };
  /** Colour roles, as CSS values usable in any framework. */
  colors: Record<string, string>;
  radius: Record<'sm' | 'md' | 'lg' | 'full', string>;
  shadow: Record<'sm' | 'md' | 'lg', string>;
  /** Spacing scale used for section rhythm and card padding. */
  space: string;
  type: { display: string; h1: string; h2: string; body: string; small: string };
  /** Non-negotiable rules that make the result look deliberate. */
  rules: string[];
}

export const DESIGN_PROFILES: Record<Exclude<DesignStyle, 'ask'>, DesignProfile> = {
  minimal: {
    id: 'minimal',
    label: { th: 'มินิมอล ขาวสะอาด', en: 'Minimal, clean white' },
    summary: {
      th: 'พื้นขาว เส้นบาง ตัวอักษรใหญ่ เว้นระยะโปร่ง เน้นเนื้อหามากกว่าตกแต่ง',
      en: 'White surfaces, hairline borders, large type, generous gaps — content over decoration'
    },
    fonts: { latin: 'Inter', thai: 'IBM Plex Sans Thai' },
    colors: {
      bg: '#ffffff',
      surface: '#fafafa',
      border: '#e8e8e6',
      text: '#141414',
      muted: '#6b6b6b',
      accent: '#1f6f5c',
      'accent-soft': '#eaf4f0'
    },
    radius: { sm: '6px', md: '12px', lg: '20px', full: '999px' },
    shadow: {
      sm: '0 1px 2px rgba(20,20,20,.04)',
      md: '0 6px 24px rgba(20,20,20,.06)',
      lg: '0 24px 64px rgba(20,20,20,.08)'
    },
    space: '4 / 8 / 16 / 24 / 40 / 64 / 96 px — sections get 96px, cards 32px, text gaps 12–16px',
    type: {
      display: 'clamp(40px, 6vw, 68px) / 1.15 / 700',
      h1: '40px / 1.2 / 700',
      h2: '28px / 1.3 / 600',
      body: '17px / 1.7 / 400',
      small: '14px / 1.6 / 400'
    },
    rules: [
      'เส้นขอบ 1px สีอ่อนเท่านั้น ห้ามใส่เงาหนัก',
      'ใช้สีเน้น (accent) ไม่เกิน 2 จุดต่อหน้าจอ',
      'ความกว้างเนื้อหาสูงสุด 1200px และจัดกลาง',
      'หัวข้อกับเนื้อหาต้องต่างกันด้วยขนาด ไม่ใช่ด้วยสีจัด',
      'ปุ่มหลักมีปุ่มเดียวต่อหนึ่งหน้าจอ ที่เหลือเป็นปุ่มขอบหรือลิงก์'
    ]
  },
  'modern-saas': {
    id: 'modern-saas',
    label: { th: 'โมเดิร์น SaaS พรีเมียม', en: 'Modern SaaS, premium' },
    summary: {
      th: 'การ์ดมุมนุ่ม เงานุ่ม ไล่เฉดสีแบรนด์ ตัวอักษรไทยอ่านสบาย',
      en: 'Soft cards, gentle depth, brand gradients, comfortable Thai type'
    },
    fonts: { latin: 'Inter', thai: 'LINE Seed Sans TH' },
    colors: {
      bg: '#f7f8fa',
      surface: '#ffffff',
      border: '#e6e9ef',
      text: '#0f1729',
      muted: '#5c667a',
      accent: '#2f6df6',
      'accent-2': '#7c4dff',
      'accent-soft': '#eef3ff'
    },
    radius: { sm: '10px', md: '16px', lg: '28px', full: '999px' },
    shadow: {
      sm: '0 1px 2px rgba(15,23,41,.05)',
      md: '0 12px 32px rgba(15,23,41,.08)',
      lg: '0 32px 80px rgba(15,23,41,.12)'
    },
    space: '8 / 12 / 20 / 32 / 48 / 80 / 120 px — hero 120px, sections 80px, cards 28–32px',
    type: {
      display: 'clamp(44px, 6.4vw, 76px) / 1.08 / 800',
      h1: '44px / 1.15 / 750',
      h2: '30px / 1.25 / 700',
      body: '17px / 1.75 / 400',
      small: '14px / 1.6 / 500'
    },
    rules: [
      'การ์ดใช้ radius 16–28px กับเงา md เท่านั้น อย่าใส่เส้นขอบหนา',
      'ไล่เฉดสีใช้กับพื้นหลังหรือขอบเท่านั้น อย่าไล่สีตัวอักษร',
      'ระยะห่างแนวตั้งต้องเป็นระบบ 4/8 ไม่มีเลขมั่ว',
      'ปุ่มหลักมีความสูง 44–52px มี hover/focus ชัดเจน',
      'ตัวอักษรไทยต้องมี line-height อย่างน้อย 1.7 เพื่อไม่ให้วรรณยุกต์ชนกัน'
    ]
  },
  'dark-premium': {
    id: 'dark-premium',
    label: { th: 'ดาร์กพรีเมียม', en: 'Dark premium' },
    summary: {
      th: 'พื้นเข้มไล่เฉด ไฟเน้นเฉพาะจุด ขอบบาง ๆ ให้ความลึก',
      en: 'Dark layered surfaces, focused glow, hairline highlights for depth'
    },
    fonts: { latin: 'Inter', thai: 'Noto Sans Thai' },
    colors: {
      bg: '#08090c',
      surface: '#111319',
      border: '#22252e',
      text: '#f5f7fa',
      muted: '#9aa3b2',
      accent: '#7cf5c4',
      'accent-2': '#8ea2ff',
      'accent-soft': 'rgba(124,245,196,.12)'
    },
    radius: { sm: '8px', md: '14px', lg: '24px', full: '999px' },
    shadow: {
      sm: '0 1px 0 rgba(255,255,255,.04) inset',
      md: '0 18px 48px rgba(0,0,0,.55)',
      lg: '0 40px 120px rgba(0,0,0,.65)'
    },
    space: '8 / 12 / 20 / 32 / 48 / 80 / 120 px',
    type: {
      display: 'clamp(42px, 6vw, 72px) / 1.1 / 700',
      h1: '42px / 1.15 / 700',
      h2: '28px / 1.3 / 650',
      body: '17px / 1.75 / 400',
      small: '14px / 1.6 / 400'
    },
    rules: [
      'ห้ามใช้ดำสนิทเป็นพื้นการ์ด ให้ใช้ชั้นสีที่สว่างขึ้นเล็กน้อย',
      'ใช้สีเน้นแบบเรืองแสงได้ แต่เฉพาะกับข้อความสั้นหรือไอคอน',
      'ขอบใช้ rgba(255,255,255,.06–.12) เพื่อให้เห็นขอบในที่มืด',
      'ตัวอักษรบนพื้นเข้มต้องมี contrast อย่างน้อย 4.5:1',
      'ห้ามใช้เงานุ่มสีขาว ให้ใช้เงานอกสีดำเท่านั้น'
    ]
  },
  bold: {
    id: 'bold',
    label: { th: 'โบลด์ สีจัดจ้าน', en: 'Bold and vivid' },
    summary: {
      th: 'สีตัดกันแรง ตัวอักษรหนาใหญ่ กราฟิกหนัก เหมาะหน้าโปรโมท',
      en: 'High contrast, heavy type, loud graphics — built for launches'
    },
    fonts: { latin: 'Space Grotesk', thai: 'Anuphan' },
    colors: {
      bg: '#fff8e7',
      surface: '#ffffff',
      border: '#141414',
      text: '#141414',
      muted: '#4a4a4a',
      accent: '#ff4d2e',
      'accent-2': '#1451ff',
      'accent-soft': '#ffe9a8'
    },
    radius: { sm: '4px', md: '10px', lg: '18px', full: '999px' },
    shadow: {
      sm: '2px 2px 0 #141414',
      md: '6px 6px 0 #141414',
      lg: '12px 12px 0 #141414'
    },
    space: '8 / 16 / 24 / 40 / 64 / 96 px',
    type: {
      display: 'clamp(48px, 8vw, 96px) / 1.02 / 800',
      h1: '48px / 1.1 / 800',
      h2: '32px / 1.2 / 750',
      body: '18px / 1.7 / 450',
      small: '15px / 1.6 / 500'
    },
    rules: [
      'ใช้เงาแบบทึบ (offset 4–12px) แทนเงาฟุ้ง',
      'ขอบ 2px สีดำเข้ม ใช้กับการ์ดและปุ่ม',
      'ตัวอักษรหัวข้อต้องหนา 750 ขึ้นไป',
      'ใช้สีพื้นสดได้ แต่ต้องมีข้อความดำอ่านชัดบนสีนั้น',
      'จัดวางแบบไม่สมมาตรได้ แต่ต้องมีเส้นนำสายตาชัด'
    ]
  }
};

/** Every style id that can be stored, including "ask". */
export const DESIGN_STYLE_IDS: DesignStyle[] = ['minimal', 'modern-saas', 'dark-premium', 'bold', 'ask'];

export const isDesignStyle = (value: unknown): value is DesignStyle =>
  typeof value === 'string' && (DESIGN_STYLE_IDS as string[]).includes(value);

/**
 * Rules that stop UI work from reading as generated-by-default.
 *
 * These are the tells users actually notice: a purple-blue gradient hero,
 * every card in the same radius, emoji used as icons, glass blur over
 * everything. They apply on top of every profile, because slop is not a
 * style — it is the absence of decisions.
 */
export const ANTI_AI_SLOP_RULES_TH: string[] = [
  'ห้ามใช้เกรเดียนต์ม่วง-น้ำเงิน หรือเกรเดียนต์เด่น ๆ ทั้งหน้า เว้นแต่สไตล์ที่เลือกกำหนดไว้ชัดเจน',
  'ห้ามใช้อีโมจิแทนไอคอน — ใช้ไอคอนจากชุดเดียวที่โปรเจกต์มีอยู่ และขนาดน้ำหนักต้องตรงกันทั้งหน้า',
  'ห้ามใส่ glassmorphism / backdrop-blur กับทุกการ์ด เลือกใส่เฉพาะจุดที่มีเหตุผลเชิงชั้นข้อมูล',
  'ห้ามทำทุกการ์ดเหมือนกันหมด — ลำดับความสำคัญต้องเห็นจากขนาด น้ำหนัก และพื้นที่ว่าง ไม่ใช่กล่องเรียงแถว',
  'ห้ามใช้ฟอนต์ Inter/Roboto เป็นตัวเอก ถ้าโปรไฟล์กำหนดฟอนต์อื่น — หัวข้อต้องมีบุคลิกตามโปรไฟล์',
  'ห้ามเขียนข้อความ placeholder ลอย ๆ อย่าง "Lorem" หรือประโยคการตลาดกลวง ใช้เนื้อหาจริงหรือข้อความจำลองที่มีความหมายกับโดเมน',
  'ห้ามเติมตกแต่งที่ไม่ทำหน้าที่ (แถบสีลอย, blob, จุดกริดประ) — ทุกองค์ประกอบต้องมีเหตุผลด้านการใช้งาน',
  'ก่อนเขียน ให้อ่านโค้ดหน้าเป้าหมายก่อนเสมอ แล้วต่อยอดระบบที่โปรเจกต์มีอยู่ ไม่ใช่ทับด้วยเทมเพลตใหม่'
];

export const ANTI_AI_SLOP_RULES_EN: string[] = [
  'No purple-blue gradients or a dominant full-page gradient unless the chosen profile defines one',
  'Never use emoji as icons — use the icon set the project already has, at one size and weight across the page',
  'Do not put glassmorphism / backdrop-blur on every card; reserve it for places with a real layering reason',
  'Do not make every card identical — hierarchy must come from size, weight and whitespace, not rows of equal boxes',
  'Do not make Inter/Roboto the identity font when the profile specifies another — headings must carry the profile character',
  'No floating placeholder copy like Lorem or empty marketing filler; use real content or domain-meaningful sample data',
  'No decoration that does no work (floating colour bars, blobs, dotted grids) — every element earns its place',
  'Before writing, read the target page code and extend the system the project already has instead of overwriting it with a fresh template'
];

/**
 * Builds the block that goes into the request for UI work.
 *
 * Written as constraints an implementation can be checked against, because that
 * is what changes the output: "make it beautiful" cannot be verified, "sections
 * get 80px and cards use radius 16–28px" can.
 */
export function buildDesignBrief(style: Exclude<DesignStyle, 'ask'>, language: 'th' | 'en'): string {
  const profile = DESIGN_PROFILES[style];
  const th = language === 'th';
  const colors = Object.entries(profile.colors)
    .map(([name, value]) => `${name} ${value}`)
    .join(' · ');

  return [
    th ? `ดีไซน์ที่ต้องใช้: ${profile.label.th}` : `Design system in force: ${profile.label.en}`,
    th ? `แนวทาง: ${profile.summary.th}` : `Direction: ${profile.summary.en}`,
    `${th ? 'ฟอนต์' : 'Fonts'}: ${profile.fonts.latin} (Latin) + ${profile.fonts.thai} (Thai)`,
    `${th ? 'สี' : 'Colour roles'}: ${colors}`,
    `${th ? 'มุมโค้ง' : 'Radius'}: sm ${profile.radius.sm} · md ${profile.radius.md} · lg ${profile.radius.lg}`,
    `${th ? 'เงา' : 'Shadow'}: sm ${profile.shadow.sm} · md ${profile.shadow.md} · lg ${profile.shadow.lg}`,
    `${th ? 'ระยะห่าง' : 'Spacing'}: ${profile.space}`,
    `${th ? 'ขนาดตัวอักษร' : 'Type scale'}: display ${profile.type.display} · h1 ${profile.type.h1} · h2 ${profile.type.h2} · body ${profile.type.body} · small ${profile.type.small}`,
    th ? 'กฎที่ต้องทำตาม:' : 'Rules that must hold:',
    ...profile.rules.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    th ? 'ข้อห้ามกันหน้าตาแบบงาน AI (ตรวจได้ทุกข้อ):' : 'Anti-generated-look bans (each one checkable):',
    ...(th ? ANTI_AI_SLOP_RULES_TH : ANTI_AI_SLOP_RULES_EN).map((rule, index) => `${th ? 'ห้าม' : 'Ban'} ${index + 1}: ${rule}`),
    '',
    th
      ? 'โทเคนที่ต้องใช้จริง (คัดลอกลงไฟล์ธีมของโปรเจกต์ แล้วอ้างอิงผ่านชื่อตัวแปรเท่านั้น):'
      : 'Exact tokens to use (put these in the project theme file and refer to them by name only):',
    designTokensCss(style),
    '',
    th
      ? 'ทุกค่าต้องมาจากชุดนี้ ห้ามคิดค่าสี/ระยะ/เงาใหม่เอง ถ้าจำเป็นต้องเพิ่ม ให้เพิ่มเป็นโทเคนในไฟล์ธีมเดียว แล้วใช้โทเคนนั้นทุกที่'
      : 'Every value must come from this set — do not invent colours, spacing or shadows. If something new is genuinely needed, add it as a token in one theme file and use that token everywhere.',
    th
      ? 'ต้องใช้จริงกับ Tailwind (หรือ CSS variables) ให้สอดคล้องทั้งโปรเจกต์ และห้ามใช้ค่าที่ขัดกับตารางนี้เพียงเพราะเขียนเร็วกว่า'
      : 'Apply it through Tailwind theme extensions or CSS variables so it is consistent across the project, and never use an off-scale value just because it is quicker to type.'
  ].join('\n');
}

/**
 * The profile as literal, copy-pasteable tokens.
 *
 * A brief in prose still leaves room to drift — "soft cards" can become 6px
 * radius and a grey border. Giving the model the exact CSS variables and the
 * matching Tailwind extension removes that room: the values either appear in the
 * theme file or they do not, and the file can be read back to check. This is the
 * difference between a style described and a style implemented.
 */
export function designTokensCss(style: Exclude<DesignStyle, 'ask'>): string {
  const profile = DESIGN_PROFILES[style];
  const colorVars = Object.entries(profile.colors)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  const radiusVars = Object.entries(profile.radius)
    .map(([name, value]) => `  --radius-${name}: ${value};`)
    .join('\n');
  const shadowVars = Object.entries(profile.shadow)
    .map(([name, value]) => `  --shadow-${name}: ${value};`)
    .join('\n');
  const fontVars =
    `  --font-sans: '${profile.fonts.latin}', '${profile.fonts.thai}', system-ui, sans-serif;`;

  return [
    `/* ${profile.label.en} — paste into the project's global stylesheet */`,
    ':root {',
    fontVars,
    colorVars,
    radiusVars,
    shadowVars,
    '}'
  ].join('\n');
}

/**
 * What the agent must do when the user has not chosen a style yet.
 * The choice belongs to the user, so the agent asks instead of guessing.
 */
export function designQuestion(language: 'th' | 'en'): string {
  const options = Object.values(DESIGN_PROFILES)
    .map((profile) => `· ${profile.label[language]} — ${profile.summary[language]}`)
    .join('\n');
  return language === 'th'
    ? `โปรเจกต์นี้ยังไม่ได้เลือกสไตล์หน้าจอ ก่อนเขียน UI ให้ถามสั้น ๆ ครั้งเดียวว่าต้องการสไตล์ไหน แล้วหยุดรอคำตอบ:\n${options}\n· ใช้ค่าที่มีอยู่แล้วในโปรเจกต์ (ถ้ามี)`
    : `This project has no screen style chosen yet. Before writing any UI, ask once which of these to use, then stop and wait for the answer:\n${options}\n· Keep whatever the project already uses`;
}
