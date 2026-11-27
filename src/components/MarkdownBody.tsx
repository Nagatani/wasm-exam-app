import { Fragment, useMemo, type ReactNode } from 'react';
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListItem,
} from '../lib/markdown';

interface MarkdownBodyProps {
  children: string;
}

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, idx) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={idx}>{node.value}</Fragment>;
      case 'code':
        return <code key={idx}>{node.value}</code>;
      case 'strong':
        return <strong key={idx}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={idx}>{renderInline(node.children)}</em>;
      case 'break':
        return <br key={idx} />;
      case 'link': {
        const isExternal = node.href.startsWith('http://') || node.href.startsWith('https://');
        return (
          <a
            key={idx}
            href={node.href}
            {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {renderInline(node.children)}
          </a>
        );
      }
      case 'image':
        return <img key={idx} src={node.src} alt={node.alt} />;
    }
  });
}

function renderListItem(item: ListItem, key: number): ReactNode {
  const { children } = item;
  // Unwrap a leading paragraph when the item is tight (a single paragraph, or a
  // paragraph followed only by nested lists) so CSS like `.markdown-body li > ul`
  // matches cleanly without extra paragraph margins.
  if (
    children.length > 0 &&
    children[0].type === 'paragraph' &&
    children.slice(1).every((b) => b.type === 'list')
  ) {
    return (
      <li key={key}>
        {renderInline(children[0].children)}
        {children.length > 1 ? renderBlocks(children.slice(1)) : null}
      </li>
    );
  }
  return <li key={key}>{renderBlocks(children)}</li>;
}

function renderBlocks(blocks: BlockNode[]): ReactNode[] {
  return blocks.map((block, idx) => {
    switch (block.type) {
      case 'heading': {
        const content = renderInline(block.children);
        switch (block.depth) {
          case 1:
            return <h1 key={idx}>{content}</h1>;
          case 2:
            return <h2 key={idx}>{content}</h2>;
          case 3:
            return <h3 key={idx}>{content}</h3>;
          case 4:
            return <h4 key={idx}>{content}</h4>;
          case 5:
            return <h5 key={idx}>{content}</h5>;
          case 6:
            return <h6 key={idx}>{content}</h6>;
        }
      }
      case 'paragraph':
        return <p key={idx}>{renderInline(block.children)}</p>;
      case 'code':
        return (
          <pre key={idx}>
            <code className={block.lang ? `language-${block.lang}` : undefined}>{block.value}</code>
          </pre>
        );
      case 'hr':
        return <hr key={idx} />;
      case 'blockquote':
        return <blockquote key={idx}>{renderBlocks(block.children)}</blockquote>;
      case 'list':
        return block.ordered ? (
          <ol key={idx} start={block.start}>
            {block.items.map((item, itemIdx) => renderListItem(item, itemIdx))}
          </ol>
        ) : (
          <ul key={idx}>{block.items.map((item, itemIdx) => renderListItem(item, itemIdx))}</ul>
        );
      case 'table':
        return (
          <table key={idx}>
            <thead>
              <tr>
                {block.header.map((cell, cIdx) => (
                  <th
                    key={cIdx}
                    style={block.align[cIdx] ? { textAlign: block.align[cIdx] } : undefined}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            {block.rows.length > 0 && (
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        style={block.align[cIdx] ? { textAlign: block.align[cIdx] } : undefined}
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        );
    }
  });
}

export function MarkdownBody({ children }: MarkdownBodyProps) {
  const blocks = useMemo(() => parseMarkdown(children), [children]);
  return <>{renderBlocks(blocks)}</>;
}
