import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '../src/shared/markdown';

/**
 * The transcript renders model output, so the parser is pinned on the shapes
 * models actually emit — plus the traps: a `_name` that is not emphasis, a
 * `\|` inside a table cell, an unclosed fence that must still render.
 */
describe('parseMarkdown', () => {
  it('plain text stays one paragraph', () => {
    expect(parseMarkdown('สวัสดีครับ')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'สวัสดีครับ' }] }
    ]);
  });

  it('headings keep their level and strip trailing hashes', () => {
    const blocks = parseMarkdown('## สรุปผล ##');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'สรุปผล' }] }
    ]);
  });

  it('a fenced code block keeps its body verbatim, even markdown-looking lines', () => {
    const src = ['before', '```ts', '### not a heading', 'const a = 1;', '```', 'after'].join('\n');
    const blocks = parseMarkdown(src);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(blocks[1]).toEqual({ kind: 'code', lang: 'ts', text: '### not a heading\nconst a = 1;' });
  });

  it('an unclosed fence still renders as code', () => {
    const blocks = parseMarkdown('```\nconst a = 1;');
    expect(blocks).toEqual([{ kind: 'code', lang: '', text: 'const a = 1;' }]);
  });

  it('bullet lists collect consecutive items', () => {
    const blocks = parseMarkdown('- หนึ่ง\n- สอง\n- สาม');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          [{ kind: 'text', text: 'หนึ่ง' }],
          [{ kind: 'text', text: 'สอง' }],
          [{ kind: 'text', text: 'สาม' }]
        ]
      }
    ]);
  });

  it('numbered lists are ordered', () => {
    const blocks = parseMarkdown('1. หนึ่ง\n2. สอง');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('pipe tables parse header, separator and rows', () => {
    const src = ['| ไฟล์ | สถานะ |', '| --- | --- |', '| a.ts | ผ่าน |', '| b.ts | ตก |'].join('\n');
    const blocks = parseMarkdown(src);
    expect(blocks[0].kind).toBe('table');
    const table = blocks[0] as Extract<(typeof blocks)[number], { kind: 'table' }>;
    expect(table.header.map((c) => (c[0] as { text: string }).text)).toEqual(['ไฟล์', 'สถานะ']);
    expect(table.rows).toHaveLength(2);
    expect((table.rows[1][1][0] as { text: string }).text).toBe('ตก');
  });

  it('an escaped pipe does not split a cell', () => {
    const src = ['| ค่า |', '| --- |', '| `a\\|b` |'].join('\n');
    const table = parseMarkdown(src)[0] as Extract<ReturnType<typeof parseMarkdown>[number], { kind: 'table' }>;
    expect(table.rows[0]).toHaveLength(1);
  });

  it('a line with dashes between text is NOT a rule', () => {
    const blocks = parseMarkdown('รายละเอียดอยู่ด้านล่าง --- ดูต่อ');
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('a standalone rule line parses as hr', () => {
    expect(parseMarkdown('---')[0].kind).toBe('hr');
  });

  it('blockquotes collect consecutive lines', () => {
    const blocks = parseMarkdown('> บรรทัดแรก\n> บรรทัดสอง');
    expect(blocks[0].kind).toBe('quote');
  });

  it('paragraphs split on blank lines and swallow adjacent text lines', () => {
    const blocks = parseMarkdown('บรรทัดหนึ่ง\nบรรทัดสอง\n\nบรรทัดสาม');
    expect(blocks).toHaveLength(2);
  });
});

describe('parseInline', () => {
  it('bold and italic nest into one node tree', () => {
    const nodes = parseInline('**หนา** และ *เอียง*');
    expect(nodes).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'หนา' }] },
      { kind: 'text', text: ' และ ' },
      { kind: 'em', children: [{ kind: 'text', text: 'เอียง' }] }
    ]);
  });

  it('inline code is verbatim, no emphasis inside', () => {
    const nodes = parseInline('ใช้ `npm run build` ตาม **คู่มือ**');
    expect(nodes[1]).toEqual({ kind: 'code', text: 'npm run build' });
  });

  it('an underscore inside a word is not emphasis', () => {
    const nodes = parseInline('ผู้ใช้ u_demo คลิกไฟล์ my_file_name ต่อ');
    expect(nodes).toEqual([{ kind: 'text', text: 'ผู้ใช้ u_demo คลิกไฟล์ my_file_name ต่อ' }]);
  });

  it('http links become link nodes, junk targets degrade to text', () => {
    expect(parseInline('[เว็บ](https://example.com)')[0]).toMatchObject({ kind: 'link', href: 'https://example.com' });
    expect(parseInline('[จาวาสคริปต์](javascript:alert(1))')[0].kind).toBe('text');
  });
});
