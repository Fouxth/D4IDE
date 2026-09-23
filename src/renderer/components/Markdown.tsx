import { Block, Inline, parseMarkdown } from '../../shared/markdown';

/**
 * Renders the chat Markdown dialect to React nodes.
 *
 * Everything is a plain element with text children — no `dangerouslySetInnerHTML`
 * anywhere — so a model cannot inject markup into the transcript. Styles follow
 * the timeline's own scale: small text, quiet borders, code on a dark plate.
 */

function renderInline(nodes: Inline[], keyBase: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyBase}-${i}`;
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'strong':
        // Weight alone is what made long answers read like a wall of emphasis:
        // a bold run inside a muted paragraph used to jump out at near-white.
        // Same colour as the surrounding text, just heavier — hierarchy comes
        // from the block structure, not from every `**` the model typed.
        return <strong key={key} className="font-semibold">{renderInline(node.children, key)}</strong>;
      case 'em':
        return (
          <em key={key} className="italic">
            {renderInline(node.children, key)}
          </em>
        );
      case 'code':
        // A plate per token, back to back, shaded half a paragraph black. The
        // tone follows the text colour now — visible on hover-free reading,
        // quiet in a line that carries five of them.
        return (
          <code
            key={key}
            className="rounded-sm bg-d4-text/[0.07] border border-d4-border-subtle/60 px-1 py-[1px] font-mono text-[0.9em] text-d4-text break-words"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-d4-accent underline decoration-d4-accent/40 hover:decoration-d4-accent"
          >
            {node.text}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, key: string): React.ReactNode {
  switch (block.kind) {
    case 'heading': {
      const sizes = ['text-[15px]', 'text-[14px]', 'text-[13px]', 'text-[13px]', 'text-[12px]', 'text-[12px]'];
      // A heading's job is to break the wall of text, so it earns space above
      // it. `pt-1` used to leave a section title sitting on the paragraph it
      // was separating, which is why long answers had no visible shape.
      return (
        <div
          key={key}
          className={`${sizes[block.level - 1]} font-semibold text-d4-text mt-3 first:mt-0 leading-snug`}
        >
          {renderInline(block.children, key)}
        </div>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.children, key)}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`pl-5 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-d4-dimmed`}
        >
          {block.items.map((children, i) => (
            <li key={`${key}-${i}`}>{renderInline(children, `${key}-${i}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre
          key={key}
          className="rounded-sm border border-d4-border-subtle bg-[#0a0a0a] px-2.5 py-2 overflow-x-auto"
        >
          <code className="font-mono text-[11px] leading-relaxed text-d4-muted whitespace-pre">{block.text}</code>
        </pre>
      );
    case 'table':
      // `table-fixed` + the header-driven min-width: a wide table used to be
      // squeezed into the column, wrapping every cell into three-line stubs
      // (the screenshot that started this). The table now keeps its natural
      // width and scrolls inside its own rounded frame; the first column stays
      // put so the eye has an anchor while the rest scrolls.
      return (
        <div key={key} className="overflow-x-auto rounded-sm border border-d4-border-subtle">
          <table className="border-collapse text-[12px]" style={{ minWidth: 'min(100%, 460px)' }}>
            <thead>
              <tr className="bg-d4-panel border-b border-d4-border-subtle">
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className={`text-left font-semibold px-2.5 py-1.5 text-d4-text whitespace-nowrap ${
                      i === 0 ? 'sticky left-0 bg-d4-panel' : ''
                    }`}
                  >
                    {renderInline(cell, `${key}-h-${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-d4-border-subtle last:border-b-0">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`px-2.5 py-1.5 align-top text-d4-muted ${c === 0 ? 'whitespace-nowrap' : ''}`}
                    >
                      {renderInline(cell, `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-d4-border pl-2.5 text-d4-muted">
          {renderInline(block.children, key)}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} className="border-d4-border-subtle my-1" />;
  }
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div
      className={`space-y-2 [&_p]:leading-relaxed [&_li]:leading-relaxed break-words [&_table]:my-1 ${className}`}
    >
      {blocks.map((block, i) => renderBlock(block, `md-${i}`))}
    </div>
  );
}
