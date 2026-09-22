/**
 * A tiny Markdown reader for conversation text.
 *
 * Models answer in Markdown — headings, tables, fenced code, bold — but the
 * transcript printed it raw, which read like a config file. No rendering
 * library was in the dependency set, so this parses the small dialect the
 * models actually produce in a chat: ATX headings, paragraphs, bullet and
 * numbered lists, fenced code, pipe tables, block quotes, rules, and the
 * inline bold/italic/code/link forms. Everything else passes through as text,
 * and nothing here ever reaches `innerHTML` — a hostile model cannot inject
 * markup into the transcript.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'hr' };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_ITEM = /^\s*[-*+]\s+(.+)$/;
const OL_ITEM = /^\s*\d{1,9}[.)]\s+(.+)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Splits a table row into raw cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!trimmed) return [];
  return trimmed
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map((cell) => cell.replace(/\u0000/g, '|').trim());
}

/** The `--- | :---:` row that turns the line above it into a table header. */
function isSepRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * A fresh regex per call. A module-level global regex shared across recursion
 * corrupts `lastIndex` — nested parseInline calls reset the outer loop's
 * cursor and it spins forever — so the literal lives in this factory: every
 * evaluation of a regex literal yields a brand-new object with `lastIndex` 0.
 */
function inlineRegex(): RegExp {
  return /(`+)([^`]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|(?<![\w\\])_([^_\n]+?)_(?!\w)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
}

/**
 * Parses bold, italic, code and links inside one line of text. Nesting is
 * capped, `_` never opens emphasis in the middle of a word (so `u_demo_file`
 * stays a name), and a link with a non-http/mailto target degrades to text.
 */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const re = inlineRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) {
      out.push({ kind: 'code', text: m[2] });
    } else if (m[3] || m[4]) {
      const inner = m[3] ?? m[4];
      out.push({
        kind: 'strong',
        children: depth >= 3 ? [{ kind: 'text', text: inner }] : parseInline(inner, depth + 1)
      });
    } else if (m[5] || m[6]) {
      const inner = m[5] ?? m[6];
      out.push({
        kind: 'em',
        children: depth >= 3 ? [{ kind: 'text', text: inner }] : parseInline(inner, depth + 1)
      });
    } else if (m[7]) {
      const href = m[8] ?? '';
      if (/^(https?:\/\/|mailto:|#)/i.test(href)) out.push({ kind: 'link', text: m[7], href });
      else out.push({ kind: 'text', text: raw });
    }
    last = m.index + raw.length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || UL_ITEM.test(line) || OL_ITEM.test(line) || QUOTE.test(line);

/** Parses chat Markdown into blocks. Blank lines separate paragraphs. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = fence[1].charAt(0) === '~' ? /^\s*~{3,}\s*$/ : /^\s*`{3,}\s*$/;
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // the closing fence
      blocks.push({ kind: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].replace(/\s+#+\s*$/, ''))
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({
        kind: 'table',
        header: header.map((cell) => parseInline(cell)),
        rows: rows.map((row) => row.map((cell) => parseInline(cell)))
      });
      continue;
    }

    const isOrdered = OL_ITEM.test(line);
    if (isOrdered || UL_ITEM.test(line)) {
      const raw: string[] = [];
      while (i < lines.length) {
        const m2 = isOrdered ? OL_ITEM.exec(lines[i]) : UL_ITEM.exec(lines[i]);
        if (m2) {
          raw.push(m2[1]);
          i++;
          continue;
        }
        // An indented continuation belongs to the item above it.
        if (raw.length && /^\s{2,}\S/.test(lines[i]) && !FENCE.test(lines[i])) {
          raw[raw.length - 1] += '\n' + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items: raw.map((t) => parseInline(t)) });
      continue;
    }

    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(QUOTE.exec(lines[i])?.[1] ?? '');
        i++;
      }
      blocks.push({ kind: 'quote', children: parseInline(buf.join('\n')) });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (startsBlock(l)) break;
      if (l.trim().startsWith('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) break;
      para.push(l);
      i++;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(para.join('\n')) });
  }
  return blocks;
}
