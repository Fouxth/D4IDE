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
        return (
          <strong key={key} className="font-semibold text-d4-text">
            {renderInline(node.children, key)}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic">
            {renderInline(node.children, key)}
          </em>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded-sm bg-d4-panel border border-d4-border-subtle px-1 py-[1px] font-mono text-[0.92em] text-d4-text"
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
      return (
        <div
          key={key}
          className={`${sizes[block.level - 1]} font-semibold text-d4-text pt-1 first:pt-0`}
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
          className={`pl-5 space-y-0.5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-d4-dimmed`}
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
      return (
        <div key={key} className="overflow-x-auto rounded-sm border border-d4-border-subtle">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-d4-panel border-b border-d4-border-subtle">
                {block.header.map((cell, i) => (
                  <th key={i} className="text-left font-semibold px-2.5 py-1.5 text-d4-text">
                    {renderInline(cell, `${key}-h-${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-d4-border-subtle last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-2.5 py-1.5 align-top text-d4-muted">
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
    <div className={`space-y-1.5 [&_p]:leading-relaxed [&_li]:leading-relaxed ${className}`}>
      {blocks.map((block, i) => renderBlock(block, `md-${i}`))}
    </div>
  );
}
