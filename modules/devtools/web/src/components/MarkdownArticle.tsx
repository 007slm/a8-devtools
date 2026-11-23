import { Fragment, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MermaidBlock } from './MermaidBlock';
import type { ProposalAnnotation } from '../utils/proposalAnnotations';

function highlightPlainText(
  plain: string,
  annotations?: ProposalAnnotation[]
): ReactNode {
  if (!plain || !annotations || annotations.length === 0) return plain;

  let bestIdx = -1;
  let bestLen = 0;
  let bestAnn: ProposalAnnotation | null = null;
  for (const ann of annotations) {
    const q = ann.quote.trim();
    if (q.length < 2) continue;
    const idx = plain.indexOf(q);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx || (idx === bestIdx && q.length > bestLen))) {
      bestIdx = idx;
      bestLen = q.length;
      bestAnn = ann;
    }
  }
  if (bestIdx < 0 || !bestAnn) return plain;

  const before = plain.slice(0, bestIdx);
  const hit = plain.slice(bestIdx, bestIdx + bestLen);
  const after = plain.slice(bestIdx + bestLen);

  const styledHit =
    bestAnn.type === 'delete' ? (
      <del
        key={bestAnn.id}
        title={bestAnn.comment || '已标记划删 / 不采纳'}
        className="bg-rose-500/15 text-rose-700 dark:text-rose-300 line-through px-0.5 rounded"
      >
        {hit}
      </del>
    ) : bestAnn.type === 'replace' ? (
      <mark
        key={bestAnn.id}
        title={`建议替换为：${bestAnn.replacement}`}
        className="bg-sky-500/15 text-foreground border-b border-sky-500 px-0.5 rounded"
      >
        {hit}
      </mark>
    ) : (
      <mark
        key={bestAnn.id}
        title={bestAnn.comment}
        className="bg-amber-500/18 text-foreground border-b border-amber-500 px-0.5 rounded"
      >
        {hit}
      </mark>
    );

  return (
    <>
      {before}
      {styledHit}
      {after ? highlightPlainText(after, annotations) : null}
    </>
  );
}

interface InlineOptions {
  annotations?: ProposalAnnotation[];
  onOpenDocLink?: (href: string) => void;
  onOpenWikiLink?: (target: string) => void;
  isWikiLinkResolved?: (target: string) => boolean;
}

/** 行内 Markdown 轻量安全渲染（支持 [[slug|label]] 双向链接，零 dangerouslySetInnerHTML） */
function renderInlineMd(text: string, opts: InlineOptions): ReactNode[] {
  const { annotations, onOpenDocLink, onOpenWikiLink, isWikiLinkResolved } = opts;
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {highlightPlainText(part.slice(2, -2), annotations)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-zinc-100 dark:bg-zinc-800/80 font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const wikiMatch = part.match(/^\[\[([^\]]+)\]\]$/);
    if (wikiMatch) {
      const rawInner = wikiMatch[1];
      const [rawTarget, rawAlias] = rawInner.split('|');
      const target = (rawTarget || '').split('#')[0].trim();
      const label = (rawAlias || rawTarget || '').trim();
      const resolved = isWikiLinkResolved ? isWikiLinkResolved(target) : true;
      if (onOpenWikiLink && target) {
        return (
          <button
            key={idx}
            type="button"
            title={resolved ? `跳转词条：${target}` : `未找到目标词条：${target}`}
            onClick={() => onOpenWikiLink(target)}
            className={`inline-flex items-center px-1.5 py-0.25 mx-0.5 rounded-md border text-[11px] font-medium align-baseline cursor-pointer transition-colors ${
              resolved
                ? 'bg-blue-500/8 dark:bg-blue-500/14 border-blue-500/25 text-blue-700 dark:text-blue-300 hover:bg-blue-500/16'
                : 'bg-rose-500/8 dark:bg-rose-500/12 border-rose-500/30 border-dashed text-rose-700 dark:text-rose-300 hover:bg-rose-500/15'
            }`}
          >
            {label}
          </button>
        );
      }
      return (
        <span
          key={idx}
          className="px-1.5 py-0.25 mx-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/80 font-mono text-[11px] text-foreground"
        >
          {label}
        </span>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const href = linkMatch[2].trim();
      if (onOpenDocLink && href && !/^(https?:|mailto:|#)/i.test(href)) {
        return (
          <button
            key={idx}
            type="button"
            title={`在文档浏览器中打开: ${href}`}
            onClick={() => onOpenDocLink(href)}
            className="underline decoration-emerald-500/50 dark:decoration-emerald-400/50 underline-offset-2 text-foreground hover:text-emerald-700 dark:hover:text-emerald-300 font-medium cursor-pointer transition-colors"
          >
            {linkMatch[1]}
          </button>
        );
      }
      if (/^https?:\/\//i.test(href)) {
        return (
          <a
            key={idx}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={href}
            className="underline decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 text-blue-700 dark:text-blue-400 hover:decoration-blue-500 font-medium"
          >
            {linkMatch[1]}
          </a>
        );
      }
      return (
        <span
          key={idx}
          title={linkMatch[2]}
          className="underline decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 text-foreground font-medium"
        >
          {linkMatch[1]}
        </span>
      );
    }
    return <Fragment key={idx}>{highlightPlainText(part, annotations)}</Fragment>;
  });
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** 剥离 YAML Frontmatter 块（仅用于纯阅读模式，避免把元数据原样渲染成正文） */
export function stripMarkdownFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return raw;
  const endIdx = normalized.indexOf('\n---', 4);
  if (endIdx < 0) return raw;
  const after = normalized.slice(endIdx + 4);
  return after.startsWith('\n') ? after.slice(1) : after;
}

/** 轻量安全 Markdown 阅读排版组件 */
export function MarkdownArticle({
  content,
  annotations,
  onOpenDocLink,
  onOpenWikiLink,
  isWikiLinkResolved,
  stripFrontmatter = false,
}: {
  content: string;
  annotations?: ProposalAnnotation[];
  onOpenDocLink?: (href: string) => void;
  onOpenWikiLink?: (target: string) => void;
  isWikiLinkResolved?: (target: string) => boolean;
  stripFrontmatter?: boolean;
}) {
  const inlineOpts: InlineOptions = {
    annotations,
    onOpenDocLink,
    onOpenWikiLink,
    isWikiLinkResolved,
  };
  const body = stripFrontmatter ? stripMarkdownFrontmatter(content) : content;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line || (line.startsWith('<!--') && line.endsWith('-->'))) {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      const codeStr = codeLines.join('\n');
      if (lang.toLowerCase() === 'mermaid') {
        blocks.push(<MermaidBlock key={`mmd-${i}`} code={codeStr} />);
        continue;
      }
      blocks.push(
        <div
          key={`code-${i}`}
          className="my-2.5 rounded-xl border border-zinc-200/85 dark:border-border/70 bg-zinc-50/80 dark:bg-zinc-900/60 overflow-hidden"
        >
          {lang && (
            <div className="px-3 py-1 border-b border-zinc-200/70 dark:border-border/60 text-[10px] font-mono text-muted">
              {lang}
            </div>
          )}
          <pre className="p-3 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
            {codeStr}
          </pre>
        </div>
      );
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      blocks.push(<hr key={`hr-${i}`} className="my-4 border-zinc-200/75 dark:border-border/60" />);
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls =
        level === 1
          ? 'text-[16px] font-semibold tracking-tight text-foreground mt-0.5 mb-2.5'
          : level === 2
          ? 'text-[13.5px] font-semibold text-foreground mt-5 mb-2 pb-1.5 border-b border-zinc-200/75 dark:border-border/60'
          : 'text-[12.5px] font-semibold text-foreground mt-3.5 mb-1.5';
      blocks.push(
        <div key={`h-${i}`} data-section-heading={text} className={cls}>
          {renderInlineMd(text, inlineOpts)}
        </div>
      );
      i += 1;
      continue;
    }

    if (line.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|/.test(lines[i + 1].trim())) {
      const header = parseTableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseTableCells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`tbl-${i}`} className="my-2.5 overflow-x-auto rounded-xl border border-zinc-200/85 dark:border-border/70">
          <table className="w-full text-left border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-zinc-50/90 dark:bg-surface-secondary/50 border-b border-zinc-200/80 dark:border-border/70">
                {header.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">
                    {renderInlineMd(cell, inlineOpts)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/65 dark:divide-border/50">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-50/60 dark:hover:bg-surface-secondary/30">
                  {header.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-zinc-700 dark:text-zinc-300 align-top">
                      {renderInlineMd(row[ci] || '', inlineOpts)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q-${i}`}
          className="my-2 pl-3 border-l-2 border-zinc-300 dark:border-zinc-600 text-[12px] leading-relaxed text-muted"
        >
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInlineMd(ql, inlineOpts)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^([-*+]|\d+\.)\s+/.test(line)) {
      const items: { marker: string; text: string; indent: number }[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const curTrim = cur.trim();
        const m = curTrim.match(/^([-*+]|(\d+)\.)\s+(.+)$/);
        if (!m) break;
        const indent = cur.search(/\S|$/);
        items.push({
          marker: m[2] ? `${m[2]}.` : '•',
          text: m[3],
          indent,
        });
        i += 1;
      }
      blocks.push(
        <ul key={`list-${i}`} className="my-2 space-y-1.5">
          {items.map((it, idx) => {
            const taskMatch = it.text.match(/^\[( |x|X)\]\s+([\s\S]+)$/);
            const checked = taskMatch ? taskMatch[1].toLowerCase() === 'x' : false;
            const bodyText = taskMatch ? taskMatch[2] : it.text;
            return (
              <li
                key={idx}
                style={{ paddingLeft: `${Math.min(it.indent, 6) * 8}px` }}
                className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300"
              >
                {taskMatch ? (
                  <span
                    className={`w-3.5 h-3.5 mt-[3px] rounded border inline-flex items-center justify-center shrink-0 ${
                      checked
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5" />}
                  </span>
                ) : (
                  <span className="text-muted font-mono text-[11px] shrink-0 mt-[1px]">{it.marker}</span>
                )}
                <span className="min-w-0 flex-1">{renderInlineMd(bodyText, inlineOpts)}</span>
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        cur.startsWith('#') ||
        cur.startsWith('```') ||
        cur.startsWith('>') ||
        cur.startsWith('|') ||
        /^([-*+]|\d+\.)\s+/.test(cur) ||
        /^[-*_]{3,}$/.test(cur)
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-1.5 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        {renderInlineMd(paraLines.join(' '), inlineOpts)}
      </p>
    );
  }

  return <div className="select-text">{blocks}</div>;
}
