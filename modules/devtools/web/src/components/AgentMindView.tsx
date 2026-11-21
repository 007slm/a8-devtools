import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Edit3,
  Eye,
  FileCheck2,
  FolderGit2,
  FolderOpen,
  History,
  Lock,
  Play,
  Plus,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { EChartBox } from './EChartBox';
import { MermaidBlock } from './MermaidBlock';
import { PortalHero } from './PortalHero';
import { ProposalDetailAnnotator } from './ProposalDetailAnnotator';
import { RepoDocsBrowser, type RepoDocEntry } from './RepoDocsBrowser';
import {
  buildProposalAdvancePrompt,
  loadProposalReview,
  saveProposalReview,
  type ProposalAnnotation,
} from '../utils/proposalAnnotations';

export interface AgentMindFileEntry {
  rel_path: string;
  name: string;
  category: string;
  extension: string;
  size_bytes: number;
  modified_ts: number;
}

export interface GovernanceRuleEntry {
  rel_path: string;
  abs_path: string;
  name: string;
  scope: 'global' | 'project' | string;
  repo: string;
  title: string;
  clause_count: number;
  char_count?: number;
  estimated_tokens?: number;
  editable: boolean;
  size_bytes: number;
  modified_ts: number;
}

export interface DecisionEntry {
  id: string;
  name: string;
  scope: 'global' | 'project' | string;
  repo: string;
  category: string;
  enabled: boolean;
  retired_at?: string;
  retired_reason?: string;
  eval_count?: number;
  hit_count?: number;
  last_eval_ts?: number;
  last_hit_ts?: number;
  triggers: string[];
  file_patterns: string[];
  instructions: string;
  passed_criteria: string;
  violated_criteria: string;
  why: string;
  rel_path: string;
  abs_path: string;
  editable: boolean;
  parse_error: string | null;
  size_bytes: number;
  modified_ts: number;
}

export interface LintItem {
  id: string;
  name: string;
  scope: 'global' | 'project' | string;
  repo: string;
  file_name: string;
  rel_path: string;
  abs_path: string;
  description: string;
  line_number: number;
  editable?: boolean;
  deletable?: boolean;
  eval_count?: number;
  hit_count?: number;
  last_eval_ts?: number;
  last_hit_ts?: number;
}

export interface GovernanceSummary {
  rule_files_count: number;
  rule_clauses_count: number;
  rule_total_tokens?: number;
  global_rule_tokens?: number;
  project_rule_tokens?: number;
  global_rule_files_count: number;
  project_rule_files_count: number;
  decisions_count: number;
  enabled_decisions_count: number;
  global_decisions_count: number;
  project_decisions_count: number;
  lints_count: number;
}

export interface HostProjectCard {
  code: string;
  physical_path: string;
  role: string;
  summary: string;
  detail_rel_path: string;
  detail_exists: boolean;
  has_git?: boolean;
  readme_rel_path?: string;
}

export interface DshReviewRecord {
  id: string;
  rel_path: string;
  timestamp: string;
  modified_ts: number;
  repo: string;
  workspace: string;
  round: number;
  verdict: string;
  title: string;
  session_id: string;
  duration_sec: number;
  summary: string;
  size_bytes: number;
}

export interface GrokProposalRecord {
  id: string;
  file_name: string;
  abs_path: string;
  date: string;
  modified_ts: number;
  title: string;
  source_subject: string;
  source_date: string;
  status: string;
  proposal_count: number;
  summary: string;
  size_bytes: number;
}

export interface AdvanceProposalResult {
  conversation_id: string;
  focused_antigravity: boolean;
  method: string;
}

export interface HarnessMetricEvent {
  ts: number;
  date: string;
  source: string;
  mode: string;
  repo: string;
  verdict: string;
  confidence: number;
  docs_choice: string;
  lesson_choice: string;
  evaluated_ids?: string[];
  violated_ids?: string[];
  tokens_evaluated?: number;
  api_calls_count?: number;
  diff_chunks_count?: number;
}

export interface DailyHarnessTrend {
  date: string;
  allow_or_pass: number;
  hook_woke: number;
  violated_or_error: number;
  tokens_evaluated?: number;
  diff_chunks_count?: number;
}

export interface HarnessTelemetry {
  metrics_path: string;
  total_events: number;
  stop_hook_events: number;
  judge_events: number;
  docs_gate_triggered: number;
  auto_lint_triggered: number;
  avg_confidence: number;
  threshold: number;
  total_tokens_evaluated?: number;
  avg_judge_tokens?: number;
  max_judge_tokens?: number;
  total_diff_chunks?: number;
  total_api_calls?: number;
  daily_trends: DailyHarnessTrend[];
  recent_events: HarnessMetricEvent[];
}

export interface AgentMindOverview {
  plugin_root: string;
  mounted_target: string | null;
  mount_alive: boolean;
  sidecar_running: boolean;
  sidecar_url: string;
  plugin_meta: {
    name?: string;
    displayName?: string;
    display_name?: string;
    description?: string;
    version?: string;
    author?: string;
  };
  config_json: {
    api_key?: string;
    model?: string;
    endpoint?: string;
    timeout_seconds?: number;
    confidence_threshold?: number;
  };
  projects: HostProjectCard[];
  reviews?: DshReviewRecord[];
  proposals?: GrokProposalRecord[];
  proposals_dir?: string;
  telemetry?: HarnessTelemetry;
  files: AgentMindFileEntry[];
  governance_rules?: GovernanceRuleEntry[];
  repo_docs?: RepoDocEntry[];
  decisions?: DecisionEntry[];
  lints?: LintItem[];
  governance_summary?: GovernanceSummary;
}

export type AgentMindViewId =
  | 'rules'
  | 'reviews'
  | 'proposals'
  | 'observability'
  | 'projects';

interface AgentMindViewProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  isStandalone?: boolean;
  theme?: 'light' | 'dark';
  activeView?: AgentMindViewId;
  onNavigateView?: (view: AgentMindViewId) => void;
  refreshTick?: number;
}

const PROTECTED_FILES = new Set([
  'plugin.json',
  'config.json',
  'repos.md',
  'rules/mind-rules.md',
  'repos/relations.md',
  'decisions/lifecycle_and_evolution.decision.json',
  'decisions/topology_and_boundaries.decision.json',
  'decisions/concurrency_and_performance.decision.json',
  'decisions/implementation_hygiene.decision.json',
]);

const DECISION_CLEANUP_MIN_EVAL = 20;
const LINT_CLEANUP_MIN_EVAL = 30;

function isProtectedDecisionItem(d: DecisionEntry): boolean {
  return d.scope === 'global' && PROTECTED_FILES.has((d.rel_path || '').toLowerCase());
}

function isDecisionCleanupCandidate(d: DecisionEntry): boolean {
  return Boolean(
    d.enabled &&
      !d.parse_error &&
      d.editable &&
      !isProtectedDecisionItem(d) &&
      (d.eval_count ?? 0) >= DECISION_CLEANUP_MIN_EVAL &&
      (d.hit_count ?? 0) === 0
  );
}

function isLintCleanupCandidate(l: LintItem): boolean {
  return Boolean(
    (l.editable ?? true) &&
      (l.eval_count ?? 0) >= LINT_CLEANUP_MIN_EVAL &&
      (l.hit_count ?? 0) === 0
  );
}

const DECISION_CATEGORY_LABELS: Record<string, string> = {
  lifecycle_and_evolution: '演化与生命周期',
  topology_and_boundaries: '边界与依赖分层',
  concurrency_and_performance: '并发与热路径性能',
  implementation_hygiene: '实现规范与错误处理',
  white_label: '白标与品牌脱敏',
  custom: '自定义规则',
};

// Antigravity 官方规则限制（内置 docs/rules.md §Size Limits and Context Budget）：
// 1. 单文件（含 AGENTS.md / GEMINI.md / rules/*.md）物理硬上限：24,000 bytes（超出按行截断）；
// 2. 全部常驻/全局规则共享总预算：20,000 tokens（超预算后最大文件降级为路径指针）。
const ANTIGRAVITY_FILE_BYTES_WARN = 18000;
const ANTIGRAVITY_FILE_BYTES_CAP = 24000;
const ANTIGRAVITY_TOTAL_TOKENS_WARN = 14000;
const ANTIGRAVITY_TOTAL_TOKENS_BUDGET = 20000;
const utf8Encoder = new TextEncoder();

function estimateMarkdownTokens(raw: string): {
  char_count: number;
  byte_count: number;
  estimated_tokens: number;
} {
  let ascii = 0;
  let nonAscii = 0;
  let chars = 0;
  for (const ch of raw || '') {
    chars += 1;
    if ((ch.codePointAt(0) ?? 0) <= 127) ascii += 1;
    else nonAscii += 1;
  }
  return {
    char_count: chars,
    byte_count: utf8Encoder.encode(raw || '').length,
    estimated_tokens: Math.ceil(ascii / 4 + nonAscii / 1.2),
  };
}

function getFileSizeStatus(bytes: number) {
  if (bytes >= ANTIGRAVITY_FILE_BYTES_CAP) {
    return {
      level: 'danger' as const,
      label: '已超 24 KB 截断线',
      colorHex: '#F43F5E',
      pillClass: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30',
      dotClass: 'bg-rose-500',
    };
  }
  if (bytes >= ANTIGRAVITY_FILE_BYTES_WARN) {
    return {
      level: 'warn' as const,
      label: '接近 24 KB 上限',
      colorHex: '#F59E0B',
      pillClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30',
      dotClass: 'bg-amber-500',
    };
  }
  return {
    level: 'ok' as const,
    label: '未超截断线',
    colorHex: '#10B981',
    pillClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    dotClass: 'bg-emerald-500',
  };
}

function getAggregateTokenStatus(tokens: number, overCapCount: number) {
  if (tokens >= ANTIGRAVITY_TOTAL_TOKENS_BUDGET) {
    return {
      level: 'danger' as const,
      label: '已超 20k 总预算',
      hint: '全部常驻规则超出官方 20,000 tokens 预算（defaultRulesBudget），大规则将被降级为路径指针按需读取',
      colorHex: '#F43F5E',
      pillClass: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30',
      dotClass: 'bg-rose-500',
    };
  }
  if (overCapCount > 0) {
    return {
      level: 'danger' as const,
      label: `${overCapCount} 份超 24 KB 已截断`,
      hint: '存在超过 Antigravity 单文件 24,000 bytes（24 KB）硬限制的文件，后半段已在注入上下文前被按行截断；建议把索引表格拆入 docs/ 目录',
      colorHex: '#F43F5E',
      pillClass: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30',
      dotClass: 'bg-rose-500',
    };
  }
  if (tokens >= ANTIGRAVITY_TOTAL_TOKENS_WARN) {
    return {
      level: 'warn' as const,
      label: '接近 20k 总预算',
      hint: '全局+项目常驻规则已用官方总预算 70% 以上，建议将具体检查下沉至 scripts/lints/ 或 *.decision.json',
      colorHex: '#F59E0B',
      pillClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30',
      dotClass: 'bg-amber-500',
    };
  }
  return {
    level: 'ok' as const,
    label: '预算充足',
    hint: '均位于 Antigravity 官方单文件 24 KB 与总计 20,000 tokens 预算健康区间内',
    colorHex: '#10B981',
    pillClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    dotClass: 'bg-emerald-500',
  };
}

const ROLE_LABELS: Record<string, string> = {
  core: 'CORE',
  tooling: 'TOOLING',
  'test-bed': 'TEST-BED',
  reference: 'REFERENCE',
};

const VERDICT_META: Record<
  string,
  { label: string; shortLabel: string; dotClass: string; textClass: string }
> = {
  PASSED: {
    label: 'PASSED · 通过',
    shortLabel: '通过',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
  VIOLATED: {
    label: 'VIOLATED · 阻断',
    shortLabel: '拦截',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
  REQUIRES_APPROVAL: {
    label: '需人工拍板',
    shortLabel: '待拍板',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  ERROR: {
    label: '执行异常',
    shortLabel: '异常',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
};

const PROPOSAL_STATUS_META: Record<
  string,
  { shortLabel: string; dotClass: string; textClass: string }
> = {
  pending: {
    shortLabel: '待推进',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  in_progress: {
    shortLabel: '推进中',
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-700 dark:text-sky-400',
  },
  adopted: {
    shortLabel: '已采纳',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
  dismissed: {
    shortLabel: '暂不采纳',
    dotClass: 'bg-zinc-400',
    textClass: 'text-muted',
  },
};

function stripReviewFrontmatter(raw: string): string {
  const clean = raw.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1].trim() : clean.trim();
}

function formatReviewTime(iso: string, modifiedTs: number): string {
  if (iso) {
    return iso.replace('T', ' ').replace(/\+08:00$/, '').slice(0, 16);
  }
  if (modifiedTs > 0) {
    const d = new Date(modifiedTs * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return '-';
}

function highlightPlainText(
  plain: string,
  annotations?: ProposalAnnotation[]
): React.ReactNode {
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

/** 行内 Markdown 轻量安全渲染（零 dangerouslySetInnerHTML） */
function renderInlineMd(
  text: string,
  annotations?: ProposalAnnotation[],
  onOpenDocLink?: (href: string) => void
): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
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

/** 轻量安全 Markdown 阅读排版组件 */
function MarkdownArticle({
  content,
  annotations,
  onOpenDocLink,
}: {
  content: string;
  annotations?: ProposalAnnotation[];
  onOpenDocLink?: (href: string) => void;
}) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
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
          {renderInlineMd(text, annotations, onOpenDocLink)}
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
                    {renderInlineMd(cell, annotations, onOpenDocLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/65 dark:divide-border/50">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-50/60 dark:hover:bg-surface-secondary/30">
                  {header.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-zinc-700 dark:text-zinc-300 align-top">
                      {renderInlineMd(row[ci] || '', annotations, onOpenDocLink)}
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
            <p key={qi}>{renderInlineMd(ql, annotations, onOpenDocLink)}</p>
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
                <span className="min-w-0 flex-1">{renderInlineMd(bodyText, annotations, onOpenDocLink)}</span>
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
        {renderInlineMd(paraLines.join(' '), annotations, onOpenDocLink)}
      </p>
    );
  }

  return <div className="select-text">{blocks}</div>;
}

/** 原位两步删除确认按钮 */
function InlineDeleteButton({
  confirming,
  deleting,
  onRequest,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  deleting?: boolean;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 rounded-lg text-[11px] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
        onPress={onRequest}
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>删除</span>
      </Button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5">
      <Button
        size="sm"
        variant="danger"
        isPending={deleting}
        className="h-6 px-2 rounded-md text-[10.5px]"
        onPress={onConfirm}
      >
        确认删除
      </Button>
      <Button
        size="sm"
        variant="ghost"
        isDisabled={deleting}
        className="h-6 px-1.5 rounded-md text-[10.5px]"
        onPress={onCancel}
      >
        取消
      </Button>
    </div>
  );
}

/** 原位未保存提示条 */
function UnsavedInlineBar({
  busy,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}: {
  busy: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-2 text-[11px]">
      <span className="text-amber-800 dark:text-amber-300 font-medium">
        当前文档有未保存修改，切换前如何处理？
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" isPending={busy} className="h-6 px-2.5 rounded-md text-[10.5px]" onPress={onSaveAndContinue}>
          保存并继续
        </Button>
        <Button size="sm" variant="outline" isDisabled={busy} className="h-6 px-2.5 rounded-md text-[10.5px]" onPress={onDiscardAndContinue}>
          放弃修改
        </Button>
        <Button size="sm" variant="ghost" isDisabled={busy} className="h-6 px-2 rounded-md text-[10.5px]" onPress={onCancel}>
          留在这里
        </Button>
      </div>
    </div>
  );
}

export function AgentMindView({
  callTauri,
  pushToast,
  isStandalone = false,
  theme = 'light',
  activeView,
  onNavigateView,
  refreshTick = 0,
}: AgentMindViewProps) {
  const isDark = theme === 'dark';
  // 默认首页即“规则维护”，直接加载并呈现主规则 rules/mind-rules.md
  const [internalSubTab, setInternalSubTab] = useState<AgentMindViewId>('rules');
  const subTab = activeView ?? internalSubTab;
  const setSubTab = useCallback(
    (next: AgentMindViewId) => {
      if (onNavigateView) {
        onNavigateView(next);
      } else {
        setInternalSubTab(next);
      }
    },
    [onNavigateView]
  );
  const [overview, setOverview] = useState<AgentMindOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab 1 (默认首页): 四层治理资产 (规则与地图 / 治理文档 / Decision 决策 / Lint 检查)
  const [govLayer, setGovLayer] = useState<'rules' | 'docs' | 'decisions' | 'lints'>('rules');
  const [govScope, setGovScope] = useState<string>('global');
  const [scopePickerOpen, setScopePickerOpen] = useState<boolean>(false);
  const [scopeSearch, setScopeSearch] = useState<string>('');
  const scopePickerRef = useRef<HTMLDivElement | null>(null);

  // Layer 1: Rules state - 默认直接展示主规则 rules/mind-rules.md
  const [selectedRulePath, setSelectedRulePath] = useState<string>('rules/mind-rules.md');
  const [selectedRuleRepo, setSelectedRuleRepo] = useState<string>('');
  const [ruleMode, setRuleMode] = useState<'preview' | 'edit'>('preview');
  const [editorContent, setEditorContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [pendingRuleSwitch, setPendingRuleSwitch] = useState<{ relPath: string; repoCode: string } | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(false);
  const [isNewRuleOpen, setIsNewRuleOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleDesc, setNewRuleDesc] = useState('');
  const [newRuleTargetRepo, setNewRuleTargetRepo] = useState<string>('');
  const [creatingRule, setCreatingRule] = useState(false);

  // Layer 2: Decisions state
  const [selectedDecisionKey, setSelectedDecisionKey] = useState<{ relPath: string; repoCode: string } | null>(null);
  const [decisionMode, setDecisionMode] = useState<'structured' | 'raw'>('structured');
  const [decisionEditorContent, setDecisionEditorContent] = useState('');
  const [decisionSavedContent, setDecisionSavedContent] = useState('');
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [pendingDecisionSwitch, setPendingDecisionSwitch] = useState<{ relPath: string; repoCode: string } | null>(null);
  const [confirmDeleteDecision, setConfirmDeleteDecision] = useState(false);
  const [isNewDecisionOpen, setIsNewDecisionOpen] = useState(false);
  const [newDecisionName, setNewDecisionName] = useState('');
  const [newDecisionCategory, setNewDecisionCategory] = useState('custom');
  const [newDecisionTargetRepo, setNewDecisionTargetRepo] = useState<string>('');
  const [newDecisionWhy, setNewDecisionWhy] = useState('');
  const [creatingDecision, setCreatingDecision] = useState(false);
  const [decisionSearch, setDecisionSearch] = useState('');

  // Layer 3: Lints state
  const [selectedLint, setSelectedLint] = useState<LintItem | null>(null);
  const [lintSourceText, setLintSourceText] = useState('');
  const [loadingLintSource, setLoadingLintSource] = useState(false);
  const [runningLintRepo, setRunningLintRepo] = useState<string | null>(null);
  const [confirmDeleteLint, setConfirmDeleteLint] = useState(false);

  // Tab 2: Reviews list vs inline detail view
  const [reviewFilterVerdict, setReviewFilterVerdict] = useState<'ALL' | 'PASSED' | 'VIOLATED' | 'REQUIRES_APPROVAL'>('ALL');
  const [reviewFilterRepo, setReviewFilterRepo] = useState<string>('ALL');
  const [reviewSearch, setReviewSearch] = useState('');
  const [activeReviewView, setActiveReviewView] = useState<'list' | 'detail' | 'spec'>('list');
  const [openedReview, setOpenedReview] = useState<DshReviewRecord | null>(null);
  const [openedReviewRaw, setOpenedReviewRaw] = useState('');
  const [reviewSourceMode, setReviewSourceMode] = useState<'rendered' | 'raw'>('rendered');
  const [loadingReviewBody, setLoadingReviewBody] = useState(false);
  const [specContent, setSpecContent] = useState('');
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [confirmDeleteReview, setConfirmDeleteReview] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);

  // Tab 3: Grok daily proposals state
  const [proposalFilterStatus, setProposalFilterStatus] = useState<
    'ALL' | 'pending' | 'in_progress' | 'adopted' | 'dismissed'
  >('ALL');
  const [proposalSearch, setProposalSearch] = useState('');
  const [openedProposal, setOpenedProposal] = useState<GrokProposalRecord | null>(null);
  const [openedProposalRaw, setOpenedProposalRaw] = useState('');
  const [proposalSourceMode, setProposalSourceMode] = useState<'rendered' | 'raw'>('rendered');
  const [loadingProposalBody, setLoadingProposalBody] = useState(false);
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState(false);
  const [advancingProposalName, setAdvancingProposalName] = useState<string | null>(null);
  const [updatingProposalStatus, setUpdatingProposalStatus] = useState<string | null>(null);
  const [proposalAnnotations, setProposalAnnotations] = useState<ProposalAnnotation[]>([]);
  const [proposalOverallNote, setProposalOverallNote] = useState('');

  // Tab 4: Harness observability filter
  const [telemetryFilter, setTelemetryFilter] = useState<'ALL' | 'stop_hook' | 'a8_judge' | 'repo_lint' | 'alerts'>('ALL');
  const [checkerPerfFilter, setCheckerPerfFilter] = useState<'ALL' | 'CLEANUP' | 'HIT'>('ALL');

  // Tab 3: Projects grid vs inline detail/editor view
  const [activeProjectItem, setActiveProjectItem] = useState<
    { kind: 'file'; title: string; relPath: string } | { kind: 'repo'; project: HostProjectCard } | null
  >(null);
  const [projectDocPath, setProjectDocPath] = useState('');
  const [projectDocContent, setProjectDocContent] = useState('');
  const [projectDocSaved, setProjectDocSaved] = useState('');
  const [projectMode, setProjectMode] = useState<'preview' | 'edit'>('preview');
  const [loadingProjectDoc, setLoadingProjectDoc] = useState(false);
  const [savingProjectDoc, setSavingProjectDoc] = useState(false);
  const [pendingProjectExit, setPendingProjectExit] = useState(false);
  const [projectDetailTab, setProjectDetailTab] = useState<'home' | 'evergreen' | 'docs'>('home');
  const [repoReadmeContent, setRepoReadmeContent] = useState('');
  const [loadingRepoReadme, setLoadingRepoReadme] = useState(false);
  const [repoReadmeError, setRepoReadmeError] = useState<string | null>(null);
  const [repoMapDrawerOpen, setRepoMapDrawerOpen] = useState(false);

  const isRuleDirty = editorContent !== savedContent;
  const isDecisionDirty = decisionEditorContent !== decisionSavedContent;
  const isProjectDirty = projectDocContent !== projectDocSaved;

  const loadOverview = useCallback(
    async (silent = true) => {
      setLoadError(null);
      try {
        const res = await callTauri<AgentMindOverview>('get_agent_mind_overview');
        if (res) {
          setOverview(res);
          if (!silent) pushToast('已刷新面板数据', 'success');
        }
      } catch (e: any) {
        const msg = String(e || '加载失败');
        setLoadError(msg);
        if (!silent) pushToast(`加载失败: ${msg}`, 'danger');
      }
    },
    [callTauri, pushToast]
  );

  const lastRefreshTickRef = useRef(0);
  useEffect(() => {
    if (refreshTick > 0 && refreshTick !== lastRefreshTickRef.current) {
      lastRefreshTickRef.current = refreshTick;
      void loadOverview(false);
    }
  }, [refreshTick, loadOverview]);

  // ---------------- Rule Actions (默认直显主规则) ----------------
  const loadRuleFileDirect = useCallback(
    async (relPath: string, repoCode = '', nextMode?: 'preview' | 'edit') => {
      setSelectedRulePath(relPath);
      setSelectedRuleRepo(repoCode);
      if (nextMode) setRuleMode(nextMode);
      setConfirmDeleteRule(false);
      setPendingRuleSwitch(null);
      setLoadingFile(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', {
          relPath,
          repoCode: repoCode || undefined,
        });
        const content = txt ?? '';
        setEditorContent(content);
        setSavedContent(content);
      } catch (e: any) {
        pushToast(`读取 ${relPath} 失败: ${e}`, 'danger');
      } finally {
        setLoadingFile(false);
      }
    },
    [callTauri, pushToast]
  );

  const requestSwitchRule = (relPath: string, repoCode = '') => {
    if (relPath === selectedRulePath && repoCode === selectedRuleRepo && !isRuleDirty) {
      return;
    }
    if (isRuleDirty) {
      setPendingRuleSwitch({ relPath, repoCode });
      return;
    }
    loadRuleFileDirect(relPath, repoCode);
  };

  const handleSaveCurrentRule = useCallback(async (): Promise<boolean> => {
    if (!selectedRulePath) return false;
    setSavingFile(true);
    try {
      await callTauri('save_agent_mind_file', {
        relPath: selectedRulePath,
        repoCode: selectedRuleRepo || undefined,
        content: editorContent,
      });
      setSavedContent(editorContent);
      pushToast(`已保存 ${selectedRuleRepo ? `${selectedRuleRepo}/` : ''}${selectedRulePath}`, 'success');
      await loadOverview(true);
      return true;
    } catch (e: any) {
      pushToast(`保存失败: ${e}`, 'danger');
      return false;
    } finally {
      setSavingFile(false);
    }
  }, [selectedRulePath, selectedRuleRepo, editorContent, callTauri, pushToast, loadOverview]);

  const handleCreateRule = async () => {
    const cleanName = newRuleName.trim();
    if (!cleanName) {
      pushToast('请输入规则文件名，例如 redline-sql.md', 'danger');
      return;
    }
    setCreatingRule(true);
    try {
      const normalizedFile = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;
      const bareName = normalizedFile.replace(/^rules\//, '').replace(/^\.agents\/rules\//, '');
      const relPath = newRuleTargetRepo ? `.agents/rules/${bareName}` : bareName;
      const title = bareName.replace(/\.md$/i, '');
      const template = `# ${title}\n\n> ${newRuleDesc.trim() || 'A8 Agent Mind 架构治理与工程红线规范'}\n\n## 1. 核心约束\n\n- **${title}核心原则**：待补充具体工程约束与物理判据。\n\n## 2. 验证与拦截标准\n\n- **门禁与验证**：变更提交前由 AI 自主通过 \`a8-judge\` 语义审查。\n`;
      const createdRel = await callTauri<string>('create_agent_mind_rule', {
        relPath,
        repoCode: newRuleTargetRepo || undefined,
        content: template,
      });
      setIsNewRuleOpen(false);
      setNewRuleName('');
      setNewRuleDesc('');
      pushToast(`已新建规则 ${newRuleTargetRepo ? `${newRuleTargetRepo}/` : ''}${createdRel || relPath}`, 'success');
      await loadOverview(true);
      if (createdRel) {
        await loadRuleFileDirect(createdRel, newRuleTargetRepo, 'edit');
      }
    } catch (e: any) {
      pushToast(`创建规则失败: ${e}`, 'danger');
    } finally {
      setCreatingRule(false);
    }
  };

  // ---------------- Decision Actions ----------------
  const loadDecisionDirect = useCallback(
    async (relPath: string, repoCode = '', nextMode?: 'structured' | 'raw') => {
      setSelectedDecisionKey({ relPath, repoCode });
      if (nextMode) setDecisionMode(nextMode);
      setConfirmDeleteDecision(false);
      setPendingDecisionSwitch(null);
      setLoadingDecision(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', {
          relPath,
          repoCode: repoCode || undefined,
        });
        const content = txt ?? '';
        setDecisionEditorContent(content);
        setDecisionSavedContent(content);
      } catch (e: any) {
        pushToast(`读取 ${relPath} 失败: ${e}`, 'danger');
      } finally {
        setLoadingDecision(false);
      }
    },
    [callTauri, pushToast]
  );

  const requestSwitchDecision = (relPath: string, repoCode = '') => {
    if (
      selectedDecisionKey &&
      selectedDecisionKey.relPath === relPath &&
      selectedDecisionKey.repoCode === repoCode &&
      !isDecisionDirty
    ) {
      return;
    }
    if (isDecisionDirty) {
      setPendingDecisionSwitch({ relPath, repoCode });
      return;
    }
    loadDecisionDirect(relPath, repoCode);
  };

  const handleSaveCurrentDecision = useCallback(async (): Promise<boolean> => {
    if (!selectedDecisionKey) return false;
    setSavingDecision(true);
    try {
      await callTauri('save_agent_mind_file', {
        relPath: selectedDecisionKey.relPath,
        repoCode: selectedDecisionKey.repoCode || undefined,
        content: decisionEditorContent,
      });
      setDecisionSavedContent(decisionEditorContent);
      pushToast(
        `已保存 Decision ${selectedDecisionKey.repoCode ? `${selectedDecisionKey.repoCode}/` : ''}${selectedDecisionKey.relPath}`,
        'success'
      );
      await loadOverview(true);
      return true;
    } catch (e: any) {
      pushToast(`保存 Decision 失败: ${e}`, 'danger');
      return false;
    } finally {
      setSavingDecision(false);
    }
  }, [selectedDecisionKey, decisionEditorContent, callTauri, pushToast, loadOverview]);

  const handleToggleDecisionEnabled = async (item: DecisionEntry) => {
    if (!item.editable || item.parse_error) return;
    const repoCode = item.scope === 'global' ? '' : item.repo;
    const retiring = item.enabled;
    try {
      const raw = await callTauri<string>('read_agent_mind_file', {
        relPath: item.rel_path,
        repoCode: repoCode || undefined,
      });
      const parsed = JSON.parse(raw || '{}');
      parsed.enabled = !retiring;
      if (retiring) {
        const now = new Date();
        const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        parsed.retired_at = ymd;
        if (!parsed.retired_reason) {
          parsed.retired_reason = '看板一键退役';
        }
      } else {
        delete parsed.retired_at;
        delete parsed.retired_reason;
      }
      const nextContent = `${JSON.stringify(parsed, null, 2)}\n`;
      await callTauri('save_agent_mind_file', {
        relPath: item.rel_path,
        repoCode: repoCode || undefined,
        content: nextContent,
      });
      if (
        selectedDecisionKey &&
        selectedDecisionKey.relPath === item.rel_path &&
        selectedDecisionKey.repoCode === repoCode
      ) {
        setDecisionEditorContent(nextContent);
        setDecisionSavedContent(nextContent);
      }
      pushToast(`${item.name} ${retiring ? '已退役' : '已恢复启用'}`, 'success');
      await loadOverview(true);
    } catch (e: any) {
      pushToast(`切换 Decision 状态失败: ${e}`, 'danger');
    }
  };

  const handleCreateDecision = async () => {
    const cleanSlug = newDecisionName
      .trim()
      .replace(/\.decision\.json$/i, '')
      .replace(/\.json$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    if (!cleanSlug) {
      pushToast('请输入英文标识（如 cache_contract）', 'danger');
      return;
    }
    setCreatingDecision(true);
    try {
      const relPath = newDecisionTargetRepo
        ? `scripts/lints/${cleanSlug}.decision.json`
        : `decisions/${cleanSlug}.decision.json`;
      const payload = {
        id: cleanSlug,
        name: newDecisionName.trim(),
        category:
          newDecisionCategory === 'white_label'
            ? 'topology_and_boundaries'
            : newDecisionCategory === 'custom'
              ? 'implementation_hygiene'
              : newDecisionCategory || 'implementation_hygiene',
        enabled: true,
        triggers: [],
        file_patterns: [],
        question: {
          type: 'choice',
          instructions: '请根据当前代码变更，判断是否存在违反本决策红线的实现。',
          criteria: {
            passed: 'PASSED: 严格遵守本决策约束，无违规或静默越界。',
            violated: 'VIOLATED: 存在直接违背本决策红线的实现或未关闭边界。',
          },
        },
        why: newDecisionWhy.trim() || '结构化语义红线约束，交由 Google Decisions API 裁决。',
      };
      const content = `${JSON.stringify(payload, null, 2)}\n`;
      const createdRel = await callTauri<string>('create_agent_mind_rule', {
        relPath,
        repoCode: newDecisionTargetRepo || undefined,
        content,
      });
      setIsNewDecisionOpen(false);
      setNewDecisionName('');
      setNewDecisionWhy('');
      pushToast(
        `已新建 Decision ${newDecisionTargetRepo ? `${newDecisionTargetRepo}/` : ''}${createdRel || relPath}`,
        'success'
      );
      await loadOverview(true);
      await loadDecisionDirect(createdRel || relPath, newDecisionTargetRepo, 'raw');
    } catch (e: any) {
      pushToast(`创建 Decision 失败: ${e}`, 'danger');
    } finally {
      setCreatingDecision(false);
    }
  };

  // ---------------- Lint Actions ----------------
  const loadLintSourceDirect = useCallback(
    async (lint: LintItem) => {
      setSelectedLint(lint);
      setConfirmDeleteLint(false);
      setLoadingLintSource(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', {
          relPath: lint.rel_path,
          repoCode: lint.scope === 'global' ? undefined : lint.repo,
        });
        setLintSourceText(txt ?? '');
      } catch (e: any) {
        setLintSourceText('');
        pushToast(`读取 Lint 脚本失败: ${e}`, 'danger');
      } finally {
        setLoadingLintSource(false);
      }
    },
    [callTauri, pushToast]
  );

  const handleRunRepoLints = useCallback(
    async (repoCode: string) => {
      if (!repoCode || runningLintRepo) return;
      setRunningLintRepo(repoCode);
      try {
        const res = await callTauri<{
          ok: boolean;
          repo: string;
          evaluated_ids?: string[];
          violated_ids?: string[];
          error?: string;
        }>('run_repo_lints', { repoCode });
        await loadOverview(true);
        if (res?.ok) {
          pushToast(`${repoCode} Lint 全绿通过（检测 ${res.evaluated_ids?.length || 0} 项）`, 'success');
        } else {
          const vCount = res?.violated_ids?.length || 0;
          pushToast(
            res?.error || `${repoCode} Lint 拦截 ${vCount} 项违规`,
            'danger'
          );
        }
      } catch (e: any) {
        pushToast(`执行 Lint 失败: ${e}`, 'danger');
      } finally {
        setRunningLintRepo(null);
      }
    },
    [callTauri, loadOverview, pushToast, runningLintRepo]
  );

  // Initial load: 总览数据 + 默认直接加载主规则 rules/mind-rules.md
  useEffect(() => {
    loadOverview(true);
    loadRuleFileDirect('rules/mind-rules.md', '', 'preview');
  }, []);

  // ---------------- Review Drill-down ----------------
  const openReviewDetail = useCallback(
    async (rv: DshReviewRecord) => {
      setOpenedReview(rv);
      setActiveReviewView('detail');
      setReviewSourceMode('rendered');
      setConfirmDeleteReview(false);
      setLoadingReviewBody(true);
      try {
        const raw = await callTauri<string>('read_agent_mind_file', { relPath: rv.rel_path });
        setOpenedReviewRaw(raw || '');
      } catch (e: any) {
        setOpenedReviewRaw(`读取终审报告失败: ${e}`);
      } finally {
        setLoadingReviewBody(false);
      }
    },
    [callTauri]
  );

  const openSpecDetail = useCallback(async () => {
    setActiveReviewView('spec');
    if (specContent) return;
    setLoadingSpec(true);
    try {
      const txt = await callTauri<string>('read_agent_mind_file', {
        relPath: 'skills/a8-dsh-review/SKILL.md',
      });
      setSpecContent(txt || '（未找到 DSH 规约文档）');
    } catch (e: any) {
      setSpecContent(`读取 DSH 规约失败: ${e}`);
    } finally {
      setLoadingSpec(false);
    }
  }, [specContent, callTauri]);

  // ---------------- Project Drill-down ----------------
  const openProjectFile = useCallback(
    async (title: string, relPath: string) => {
      setActiveProjectItem({ kind: 'file', title, relPath });
      setProjectDocPath(relPath);
      setProjectMode('preview');
      setPendingProjectExit(false);
      setLoadingProjectDoc(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', { relPath });
        const content = txt ?? '';
        setProjectDocContent(content);
        setProjectDocSaved(content);
      } catch (e: any) {
        pushToast(`读取 ${relPath} 失败: ${e}`, 'danger');
      } finally {
        setLoadingProjectDoc(false);
      }
    },
    [callTauri, pushToast]
  );

  const openProjectCard = useCallback(
    async (proj: HostProjectCard) => {
      setActiveProjectItem({ kind: 'repo', project: proj });
      setProjectDetailTab('home');
      setRepoMapDrawerOpen(false);
      setProjectMode('preview');
      setPendingProjectExit(false);

      setRepoReadmeContent('');
      setRepoReadmeError(null);
      if (proj.readme_rel_path) {
        setLoadingRepoReadme(true);
        callTauri<string>('read_agent_mind_file', {
          relPath: proj.readme_rel_path,
          repoCode: proj.code,
        })
          .then((txt) => setRepoReadmeContent(txt ?? ''))
          .catch((e: any) => setRepoReadmeError(`读取 ${proj.readme_rel_path} 失败: ${e}`))
          .finally(() => setLoadingRepoReadme(false));
      } else {
        setLoadingRepoReadme(false);
      }

      if (!proj.detail_exists || !proj.detail_rel_path) {
        setProjectDocPath('');
        setProjectDocContent('');
        setProjectDocSaved('');
        return;
      }
      setProjectDocPath(proj.detail_rel_path);
      setLoadingProjectDoc(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', {
          relPath: proj.detail_rel_path,
        });
        const content = txt ?? '';
        setProjectDocContent(content);
        setProjectDocSaved(content);
      } catch (e: any) {
        pushToast(`读取 ${proj.detail_rel_path} 失败: ${e}`, 'danger');
      } finally {
        setLoadingProjectDoc(false);
      }
    },
    [callTauri, pushToast]
  );

  const handleSaveProjectDoc = useCallback(async (): Promise<boolean> => {
    if (!projectDocPath) return false;
    setSavingProjectDoc(true);
    try {
      await callTauri('save_agent_mind_file', {
        relPath: projectDocPath,
        content: projectDocContent,
      });
      setProjectDocSaved(projectDocContent);
      pushToast(`已保存 ${projectDocPath}`, 'success');
      await loadOverview(true);
      return true;
    } catch (e: any) {
      pushToast(`保存失败: ${e}`, 'danger');
      return false;
    } finally {
      setSavingProjectDoc(false);
    }
  }, [projectDocPath, projectDocContent, callTauri, pushToast, loadOverview]);

  const requestExitProject = () => {
    if (isProjectDirty) {
      setPendingProjectExit(true);
      return;
    }
    setRepoMapDrawerOpen(false);
    setActiveProjectItem(null);
    setProjectDocPath('');
  };

  const handleSelectGovScope = (nextScope: string) => {
    if (nextScope === govScope) {
      setScopePickerOpen(false);
      setScopeSearch('');
      return;
    }
    if (isRuleDirty || isDecisionDirty) {
      pushToast('当前规则或 Decision 有未保存修改，请先保存后再切换作用域', 'danger');
      return;
    }
    setGovScope(nextScope);
    setScopePickerOpen(false);
    setScopeSearch('');
  };

  useEffect(() => {
    if (!scopePickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (scopePickerRef.current && !scopePickerRef.current.contains(e.target as Node)) {
        setScopePickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScopePickerOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [scopePickerOpen]);

  // Ctrl+S inside active editors
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return;
      if (subTab === 'rules' && govLayer === 'rules' && selectedRulePath && isRuleDirty && !savingFile) {
        e.preventDefault();
        handleSaveCurrentRule();
      } else if (
        subTab === 'rules' &&
        govLayer === 'decisions' &&
        selectedDecisionKey &&
        isDecisionDirty &&
        !savingDecision
      ) {
        e.preventDefault();
        handleSaveCurrentDecision();
      } else if (subTab === 'projects' && activeProjectItem && projectDocPath && isProjectDirty && !savingProjectDoc) {
        e.preventDefault();
        handleSaveProjectDoc();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    subTab,
    govLayer,
    selectedRulePath,
    isRuleDirty,
    savingFile,
    handleSaveCurrentRule,
    selectedDecisionKey,
    isDecisionDirty,
    savingDecision,
    handleSaveCurrentDecision,
    activeProjectItem,
    projectDocPath,
    isProjectDirty,
    savingProjectDoc,
    handleSaveProjectDoc,
  ]);

  const executeDeleteFile = async (
    relPath: string,
    source: 'review' | 'rule' | 'decision' | 'lint',
    repoCode = ''
  ) => {
    setDeletingFile(true);
    try {
      await callTauri('delete_agent_mind_file', {
        relPath,
        repoCode: repoCode || undefined,
      });
      pushToast(`已删除文件 ${repoCode ? `${repoCode}/` : ''}${relPath}`, 'success');
      if (source === 'review') {
        setConfirmDeleteReview(false);
        setActiveReviewView('list');
        setOpenedReview(null);
        setOpenedReviewRaw('');
        await loadOverview(true);
      } else if (source === 'decision') {
        setConfirmDeleteDecision(false);
        setSelectedDecisionKey(null);
        setDecisionEditorContent('');
        setDecisionSavedContent('');
        await loadOverview(true);
      } else if (source === 'lint') {
        setConfirmDeleteLint(false);
        setSelectedLint(null);
        setLintSourceText('');
        await loadOverview(true);
      } else {
        setConfirmDeleteRule(false);
        await loadOverview(true);
        await loadRuleFileDirect('rules/mind-rules.md', '', 'preview');
      }
    } catch (e: any) {
      pushToast(`删除失败: ${e}`, 'danger');
    } finally {
      setDeletingFile(false);
    }
  };

  // ---------------- Derived lists ----------------
  const governanceRules = useMemo<GovernanceRuleEntry[]>(() => {
    if (overview?.governance_rules && overview.governance_rules.length > 0) {
      return overview.governance_rules;
    }
    const list = (overview?.files || []).filter(
      (f) => f.category === 'rules' && f.extension === 'md'
    );
    const rank = (rel: string) => (rel === 'rules/mind-rules.md' ? 0 : 1);
    return [...list]
      .sort((a, b) => rank(a.rel_path) - rank(b.rel_path) || a.rel_path.localeCompare(b.rel_path))
      .map((f) => ({
        rel_path: f.rel_path,
        abs_path: f.rel_path,
        name: f.name,
        scope: 'global',
        repo: 'global',
        title: f.rel_path === 'rules/mind-rules.md' ? 'A8 Agent Mind 通用架构与文档治理总则' : f.name.replace(/\.md$/i, ''),
        clause_count: 0,
        char_count: f.size_bytes,
        estimated_tokens: Math.ceil(f.size_bytes / 3),
        editable: true,
        size_bytes: f.size_bytes,
        modified_ts: f.modified_ts,
      }));
  }, [overview]);

  const allDecisions = useMemo<DecisionEntry[]>(() => overview?.decisions || [], [overview]);
  const allLints = useMemo<LintItem[]>(() => overview?.lints || [], [overview]);

  const scopeOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        label: string;
        role: string;
        summary: string;
        physicalPath: string;
        hasGit?: boolean;
        rulesCount: number;
        decisionsCount: number;
        lintsCount: number;
        totalTokens: number;
        maxBytes: number;
      }
    >();
    map.set('global', {
      code: 'global',
      label: '全局通用 (a8-agent-mind)',
      role: 'global',
      summary: '跨仓库生效的通用工程规范与架构红线决策',
      physicalPath: overview?.plugin_root || 'a8-agent-mind',
      hasGit: true,
      rulesCount: 0,
      decisionsCount: 0,
      lintsCount: 0,
      totalTokens: 0,
      maxBytes: 0,
    });
    for (const p of overview?.projects || []) {
      map.set(p.code, {
        code: p.code,
        label: p.code,
        role: p.role,
        summary: p.summary,
        physicalPath: p.physical_path,
        hasGit: p.has_git,
        rulesCount: 0,
        decisionsCount: 0,
        lintsCount: 0,
        totalTokens: 0,
        maxBytes: 0,
      });
    }
    const ensure = (code: string) => {
      let cur = map.get(code);
      if (!cur) {
        cur = {
          code,
          label: code,
          role: 'project',
          summary: '',
          physicalPath: '',
          rulesCount: 0,
          decisionsCount: 0,
          lintsCount: 0,
          totalTokens: 0,
          maxBytes: 0,
        };
        map.set(code, cur);
      }
      return cur;
    };
    for (const r of governanceRules) {
      const key = r.scope === 'global' ? 'global' : r.repo;
      if (!key) continue;
      const item = ensure(key);
      item.rulesCount += 1;
      item.totalTokens += r.estimated_tokens ?? Math.ceil((r.size_bytes || 0) / 3);
      item.maxBytes = Math.max(item.maxBytes, r.size_bytes || 0);
    }
    for (const d of allDecisions) {
      const key = d.scope === 'global' ? 'global' : d.repo;
      if (!key) continue;
      ensure(key).decisionsCount += 1;
    }
    for (const l of allLints) {
      const key = l.scope === 'global' ? 'global' : l.repo;
      if (!key) continue;
      ensure(key).lintsCount += 1;
    }
    const globalItem = map.get('global')!;
    const projectItems = Array.from(map.values())
      .filter((x) => x.code !== 'global')
      .sort((a, b) => {
        const aTotal = a.rulesCount + a.decisionsCount + a.lintsCount;
        const bTotal = b.rulesCount + b.decisionsCount + b.lintsCount;
        return (bTotal > 0 ? 1 : 0) - (aTotal > 0 ? 1 : 0) || a.code.localeCompare(b.code);
      });
    return [globalItem, ...projectItems];
  }, [overview, governanceRules, allDecisions, allLints]);

  const activeScopeOption = useMemo(
    () => scopeOptions.find((o) => o.code === govScope) || scopeOptions[0],
    [scopeOptions, govScope]
  );

  const filteredScopeOptions = useMemo(() => {
    const kw = scopeSearch.trim().toLowerCase();
    if (!kw) return scopeOptions;
    return scopeOptions.filter(
      (o) =>
        o.code.toLowerCase().includes(kw) ||
        o.label.toLowerCase().includes(kw) ||
        o.summary.toLowerCase().includes(kw) ||
        o.physicalPath.toLowerCase().includes(kw) ||
        (ROLE_LABELS[o.role] || o.role).toLowerCase().includes(kw)
    );
  }, [scopeOptions, scopeSearch]);

  const isGovScopeReadOnly = activeScopeOption?.role === 'test-bed';

  const filteredRules = useMemo(() => {
    if (govScope === 'global') return governanceRules.filter((r) => r.scope === 'global');
    return governanceRules.filter((r) => r.scope === 'project' && r.repo === govScope);
  }, [governanceRules, govScope]);

  const filteredDecisions = useMemo(() => {
    const kw = decisionSearch.trim().toLowerCase();
    return allDecisions.filter((d) => {
      if (govScope === 'global' && d.scope !== 'global') return false;
      if (govScope !== 'global' && (d.scope !== 'project' || d.repo !== govScope)) {
        return false;
      }
      if (!kw) return true;
      return (
        d.name.toLowerCase().includes(kw) ||
        d.id.toLowerCase().includes(kw) ||
        d.why.toLowerCase().includes(kw) ||
        d.instructions.toLowerCase().includes(kw) ||
        d.repo.toLowerCase().includes(kw)
      );
    });
  }, [allDecisions, govScope, decisionSearch]);

  const filteredLints = useMemo(() => {
    if (govScope === 'global') return allLints.filter((l) => l.scope === 'global');
    return allLints.filter((l) => l.scope === 'project' && l.repo === govScope);
  }, [allLints, govScope]);

  const allRepoDocs = useMemo<RepoDocEntry[]>(() => overview?.repo_docs || [], [overview]);

  const scopedRepoDocs = useMemo(() => {
    if (govScope === 'global') return allRepoDocs;
    return allRepoDocs.filter((d) => d.repo === govScope);
  }, [allRepoDocs, govScope]);

  const scopedDocTierCounts = useMemo(() => {
    let glossary = 0;
    let evergreen = 0;
    let record = 0;
    let deferred = 0;
    for (const d of scopedRepoDocs) {
      if (d.doc_tier === 'glossary') glossary += 1;
      else if (d.doc_tier === 'evergreen') evergreen += 1;
      else if (d.doc_tier === 'record') record += 1;
      else if (d.doc_tier === 'deferred') deferred += 1;
    }
    return { glossary, evergreen, record, deferred, total: scopedRepoDocs.length };
  }, [scopedRepoDocs]);

  const repoDocsStatsByRepo = useMemo(() => {
    const byRepo = new Map<
      string,
      { glossary: number; evergreen: number; record: number; deferred: number; total: number }
    >();
    let glossaryTotal = 0;
    let evergreenTotal = 0;
    let recordTotal = 0;
    let deferredTotal = 0;
    for (const d of allRepoDocs) {
      let cur = byRepo.get(d.repo);
      if (!cur) {
        cur = { glossary: 0, evergreen: 0, record: 0, deferred: 0, total: 0 };
        byRepo.set(d.repo, cur);
      }
      cur.total += 1;
      if (d.doc_tier === 'glossary') {
        cur.glossary += 1;
        glossaryTotal += 1;
      } else if (d.doc_tier === 'evergreen') {
        cur.evergreen += 1;
        evergreenTotal += 1;
      } else if (d.doc_tier === 'record') {
        cur.record += 1;
        recordTotal += 1;
      } else if (d.doc_tier === 'deferred') {
        cur.deferred += 1;
        deferredTotal += 1;
      }
    }
    return { byRepo, glossaryTotal, evergreenTotal, recordTotal, deferredTotal };
  }, [allRepoDocs]);

  const activeRuleEntry = useMemo(
    () =>
      governanceRules.find(
        (r) =>
          r.rel_path === selectedRulePath &&
          (r.scope === 'global' ? '' : r.repo) === selectedRuleRepo
      ) || null,
    [governanceRules, selectedRulePath, selectedRuleRepo]
  );

  const scopedActiveRuleEntry = useMemo(() => {
    if (!activeRuleEntry) return null;
    const match = filteredRules.some(
      (r) =>
        r.rel_path === activeRuleEntry.rel_path &&
        (r.scope === 'global' ? '' : r.repo) === (activeRuleEntry.scope === 'global' ? '' : activeRuleEntry.repo)
    );
    return match ? activeRuleEntry : null;
  }, [activeRuleEntry, filteredRules]);

  const activeDecisionEntry = useMemo(
    () =>
      selectedDecisionKey
        ? allDecisions.find(
            (d) =>
              d.rel_path === selectedDecisionKey.relPath &&
              (d.scope === 'global' ? '' : d.repo) === selectedDecisionKey.repoCode
          ) || null
        : null,
    [allDecisions, selectedDecisionKey]
  );

  const scopedActiveDecisionEntry = useMemo(() => {
    if (!activeDecisionEntry) return null;
    const match = filteredDecisions.some(
      (d) =>
        d.rel_path === activeDecisionEntry.rel_path &&
        (d.scope === 'global' ? '' : d.repo) === (activeDecisionEntry.scope === 'global' ? '' : activeDecisionEntry.repo)
    );
    return match ? activeDecisionEntry : null;
  }, [activeDecisionEntry, filteredDecisions]);

  // 切换层级或范围时，若当前列表非空且无对应选中项（且未脏），自动加载第一项
  useEffect(() => {
    if (subTab !== 'rules') return;
    if (govLayer === 'rules' && filteredRules.length > 0 && !isRuleDirty) {
      const stillVisible = filteredRules.some(
        (r) =>
          r.rel_path === selectedRulePath &&
          (r.scope === 'global' ? '' : r.repo) === selectedRuleRepo
      );
      if (!stillVisible) {
        const first = filteredRules[0];
        loadRuleFileDirect(first.rel_path, first.scope === 'global' ? '' : first.repo);
      }
    } else if (govLayer === 'decisions' && filteredDecisions.length > 0 && !isDecisionDirty) {
      const stillVisible =
        selectedDecisionKey &&
        filteredDecisions.some(
          (d) =>
            d.rel_path === selectedDecisionKey.relPath &&
            (d.scope === 'global' ? '' : d.repo) === selectedDecisionKey.repoCode
        );
      if (!stillVisible) {
        const first = filteredDecisions[0];
        loadDecisionDirect(first.rel_path, first.scope === 'global' ? '' : first.repo);
      }
    } else if (govLayer === 'lints') {
      if (filteredLints.length === 0) {
        if (selectedLint !== null) {
          setSelectedLint(null);
          setLintSourceText('');
        }
      } else {
        const stillVisible =
          selectedLint &&
          filteredLints.some(
            (l) => l.id === selectedLint.id && l.repo === selectedLint.repo && l.rel_path === selectedLint.rel_path
          );
        if (!stillVisible) {
          loadLintSourceDirect(filteredLints[0]);
        }
      }
    }
  }, [
    subTab,
    govLayer,
    govScope,
    filteredRules,
    filteredDecisions,
    filteredLints,
    selectedRulePath,
    selectedRuleRepo,
    selectedDecisionKey,
    selectedLint,
    isRuleDirty,
    isDecisionDirty,
    loadRuleFileDirect,
    loadDecisionDirect,
    loadLintSourceDirect,
  ]);

  const allReviews = useMemo(() => overview?.reviews || [], [overview]);

  const availableReviewRepos = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allReviews) {
      const key = r.repo || 'unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
  }, [allReviews]);

  const activeReviewRepo = useMemo(() => {
    if (reviewFilterRepo === 'ALL') return 'ALL';
    return availableReviewRepos.some((item) => item.repo === reviewFilterRepo)
      ? reviewFilterRepo
      : 'ALL';
  }, [reviewFilterRepo, availableReviewRepos]);

  const repoScopedReviews = useMemo(() => {
    if (activeReviewRepo === 'ALL') return allReviews;
    return allReviews.filter((r) => (r.repo || 'unknown') === activeReviewRepo);
  }, [allReviews, activeReviewRepo]);

  const filteredReviews = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return repoScopedReviews.filter((r) => {
      if (reviewFilterVerdict !== 'ALL' && r.verdict !== reviewFilterVerdict) {
        return false;
      }
      if (!q) return true;
      return (
        r.repo.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [repoScopedReviews, reviewFilterVerdict, reviewSearch]);

  const reviewStats = useMemo(() => {
    let passed = 0;
    let violated = 0;
    for (const r of repoScopedReviews) {
      if (r.verdict === 'PASSED') passed += 1;
      else if (r.verdict === 'VIOLATED' || r.verdict === 'ERROR') violated += 1;
    }
    return { total: repoScopedReviews.length, passed, violated };
  }, [repoScopedReviews]);

  // ---------------- Grok Proposals Actions & Derived Lists ----------------
  const openProposalDetail = useCallback(
    async (p: GrokProposalRecord) => {
      setOpenedProposal(p);
      setProposalSourceMode('rendered');
      setConfirmDeleteProposal(false);
      const savedReview = loadProposalReview(p.file_name);
      setProposalAnnotations(savedReview.annotations);
      setProposalOverallNote(savedReview.overallNote);
      setLoadingProposalBody(true);
      try {
        const raw = await callTauri<string>('read_grok_proposal', { fileName: p.file_name });
        setOpenedProposalRaw(raw || '');
      } catch (e: any) {
        setOpenedProposalRaw(`读取提案失败: ${e}`);
      } finally {
        setLoadingProposalBody(false);
      }
    },
    [callTauri]
  );

  const handleUpdateProposalAnnotations = useCallback(
    (next: ProposalAnnotation[]) => {
      setProposalAnnotations(next);
      if (openedProposal) {
        saveProposalReview(openedProposal.file_name, {
          annotations: next,
          overallNote: proposalOverallNote,
        });
      }
    },
    [openedProposal, proposalOverallNote]
  );

  const handleUpdateProposalOverallNote = useCallback(
    (next: string) => {
      setProposalOverallNote(next);
      if (openedProposal) {
        saveProposalReview(openedProposal.file_name, {
          annotations: proposalAnnotations,
          overallNote: next,
        });
      }
    },
    [openedProposal, proposalAnnotations]
  );

  const executeDeleteProposal = async (fileName: string) => {
    setDeletingFile(true);
    try {
      await callTauri('delete_grok_proposal', { fileName });
      pushToast(`已删除提案 ${fileName}`, 'success');
      setConfirmDeleteProposal(false);
      setOpenedProposal(null);
      setOpenedProposalRaw('');
      await loadOverview(true);
    } catch (e: any) {
      pushToast(`删除提案失败: ${e}`, 'danger');
    } finally {
      setDeletingFile(false);
    }
  };

  const handleUpdateProposalStatus = useCallback(
    async (fileName: string, nextStatus: 'pending' | 'in_progress' | 'adopted' | 'dismissed') => {
      setUpdatingProposalStatus(fileName);
      try {
        await callTauri<{ file_name: string; status: string }>('update_grok_proposal_status', {
          fileName,
          status: nextStatus,
        });
        setOpenedProposal((prev) =>
          prev && prev.file_name === fileName ? { ...prev, status: nextStatus } : prev
        );
        if (openedProposal && openedProposal.file_name === fileName) {
          const raw = await callTauri<string>('read_grok_proposal', { fileName });
          if (typeof raw === 'string') setOpenedProposalRaw(raw);
        }
        const label = PROPOSAL_STATUS_META[nextStatus]?.shortLabel || nextStatus;
        pushToast(`已更新提案状态为「${label}」`, 'success');
        await loadOverview(true);
      } catch (e: any) {
        pushToast(`更新提案状态失败: ${e}`, 'danger');
      } finally {
        setUpdatingProposalStatus(null);
      }
    },
    [callTauri, loadOverview, openedProposal, pushToast]
  );

  const handleAdvanceInAntigravity = useCallback(
    async (p: GrokProposalRecord) => {
      setAdvancingProposalName(p.file_name);
      const isCurrentlyOpened = openedProposal?.file_name === p.file_name;
      const reviewState = isCurrentlyOpened
        ? { annotations: proposalAnnotations, overallNote: proposalOverallNote }
        : loadProposalReview(p.file_name);
      const convTitle = `推进 Grok 提案 (${p.date || p.id})`;
      const convPrompt = buildProposalAdvancePrompt({
        title: p.title,
        fileName: p.file_name,
        absPath: p.abs_path,
        annotations: reviewState.annotations,
        overallNote: reviewState.overallNote,
      });
      try {
        const sidecarBridge = (window as any).sidecar;
        const hasHostBridge =
          isStandalone &&
          typeof sidecarBridge?.agent?.startConversation === 'function' &&
          Boolean(
            sidecarBridge?.conversationId ||
              new URLSearchParams(window.location.search).get('token')
          );
        if (hasHostBridge) {
          const started = await sidecarBridge.agent.startConversation(convPrompt, convTitle);
          const convId =
            started?.conversationId ||
            started?.conversation_id ||
            started?.response?.conversationId ||
            started?.response?.conversation_id ||
            '';
          if (convId && typeof sidecarBridge?.ui?.toggleConversation === 'function') {
            sidecarBridge.ui.toggleConversation(convId);
          }
          if (p.status === 'pending') {
            await callTauri('update_grok_proposal_status', {
              fileName: p.file_name,
              status: 'in_progress',
            }).catch(() => {});
            setOpenedProposal((prev) =>
              prev && prev.file_name === p.file_name ? { ...prev, status: 'in_progress' } : prev
            );
            await loadOverview(true);
          }
          pushToast(
            convId
              ? `已在 Antigravity 中打开新会话 (${convId.slice(0, 8)}...)`
              : '已在 Antigravity 中创建推进会话',
            'success'
          );
          return;
        }

        const res = await callTauri<AdvanceProposalResult>('advance_proposal_in_antigravity', {
          fileName: p.file_name,
          title: convTitle,
          prompt: convPrompt,
        });
        const cid = res?.conversation_id || '';
        if (cid && typeof sidecarBridge?.ui?.toggleConversation === 'function') {
          sidecarBridge.ui.toggleConversation(cid);
        }
        if (p.status === 'pending') {
          setOpenedProposal((prev) =>
            prev && prev.file_name === p.file_name ? { ...prev, status: 'in_progress' } : prev
          );
          await loadOverview(true);
        }
        pushToast(
          cid
            ? `已创建 Antigravity 会话 (${cid.slice(0, 8)}...) 并唤醒窗口`
            : '已触发 Antigravity 推进会话',
          'success'
        );
      } catch (e: any) {
        pushToast(`唤起 Antigravity 失败: ${e}`, 'danger');
      } finally {
        setAdvancingProposalName(null);
      }
    },
    [callTauri, isStandalone, loadOverview, openedProposal, proposalAnnotations, proposalOverallNote, pushToast]
  );

  const allProposals = useMemo(() => overview?.proposals || [], [overview]);

  const filteredProposals = useMemo(() => {
    const q = proposalSearch.trim().toLowerCase();
    return allProposals.filter((p) => {
      if (proposalFilterStatus !== 'ALL' && p.status !== proposalFilterStatus) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.source_subject.toLowerCase().includes(q) ||
        p.date.toLowerCase().includes(q) ||
        p.file_name.toLowerCase().includes(q)
      );
    });
  }, [allProposals, proposalFilterStatus, proposalSearch]);

  const proposalStats = useMemo(() => {
    let pendingOnly = 0;
    let inProgress = 0;
    let adopted = 0;
    let dismissed = 0;
    for (const p of allProposals) {
      if (p.status === 'pending') pendingOnly += 1;
      else if (p.status === 'in_progress') inProgress += 1;
      else if (p.status === 'adopted') adopted += 1;
      else if (p.status === 'dismissed') dismissed += 1;
      else pendingOnly += 1;
    }
    return {
      total: allProposals.length,
      pending: pendingOnly + inProgress,
      pendingOnly,
      inProgress,
      adopted,
      dismissed,
    };
  }, [allProposals]);

  // ---------------- Harness Observability Derived Charts ----------------
  const telemetry = overview?.telemetry;

  const telemetryComputed = useMemo(() => {
    const events = telemetry?.recent_events || [];
    let passCount = 0;
    let docsAskCount = 0;
    let autoLearnCount = 0;
    let alertCount = 0;
    const confBuckets = [0, 0, 0, 0]; // <0.70, 0.70-0.85, 0.85-0.95, >=0.95

    for (const ev of events) {
      const v = (ev.verdict || '').toUpperCase();
      const m = (ev.mode || '').toUpperCase();
      const combined = `${v} ${m}`;
      if (combined.includes('VIOLATED') || combined.includes('ERROR')) {
        alertCount += 1;
      } else if (combined.includes('AUTO_LINT') || combined.includes('AUTO_DECISION')) {
        autoLearnCount += 1;
      } else if (
        combined.includes('DOCS_MAINTENANCE') ||
        combined.includes('ASK_USER_UI') ||
        combined.includes('REQUIRES_APPROVAL') ||
        v === 'CONTINUE'
      ) {
        docsAskCount += 1;
      } else {
        passCount += 1;
      }
      if (ev.confidence > 0) {
        if (ev.confidence >= 0.95) confBuckets[3] += 1;
        else if (ev.confidence >= 0.85) confBuckets[2] += 1;
        else if (ev.confidence >= 0.7) confBuckets[1] += 1;
        else confBuckets[0] += 1;
      }
    }

    const totalRecent = events.length;
    const totalEvents = telemetry?.total_events || 0;
    const gateWokeTotal = docsAskCount + autoLearnCount + alertCount;
    const allReviewsList = overview?.reviews || [];
    const passedReviews = allReviewsList.filter((r) => r.verdict === 'PASSED').length;
    const dshPassRate =
      allReviewsList.length > 0 ? Math.round((passedReviews / allReviewsList.length) * 100) : 0;
    const decidedProposals = proposalStats.adopted + proposalStats.dismissed;
    const proposalAdoptRate =
      proposalStats.total > 0
        ? Math.round(
            (proposalStats.adopted / (decidedProposals > 0 ? decidedProposals : proposalStats.total)) * 100
          )
        : 0;

    return {
      passCount,
      docsAskCount,
      autoLearnCount,
      alertCount,
      confBuckets,
      totalRecent,
      totalEvents,
      gateWokeTotal,
      dshPassRate,
      passedReviews,
      totalReviews: allReviewsList.length,
      proposalAdoptRate,
    };
  }, [telemetry, overview?.reviews, proposalStats]);

  const filteredTelemetryEvents = useMemo(() => {
    const events = telemetry?.recent_events || [];
    return events.filter((ev) => {
      if (telemetryFilter === 'stop_hook') return ev.source === 'stop_hook';
      if (telemetryFilter === 'a8_judge') return ev.source === 'a8_judge';
      if (telemetryFilter === 'repo_lint') return ev.source === 'repo_lint';
      if (telemetryFilter === 'alerts') {
        const v = (ev.verdict || '').toUpperCase();
        const m = (ev.mode || '').toUpperCase();
        return !(v === 'PASS' || v === 'PASSED' || (v === 'ALLOW' && (!m || m === 'PASS')));
      }
      return true;
    });
  }, [telemetry, telemetryFilter]);

  const cleanupSummary = useMemo(() => {
    const decisions = overview?.decisions || [];
    const lints = overview?.lints || [];
    const items: Array<{
      kind: 'decision' | 'lint';
      key: string;
      scopeCode: string;
      scopeLabel: string;
      name: string;
      id: string;
      evalCount: number;
      deletable: boolean;
      decision?: DecisionEntry;
      lint?: LintItem;
    }> = [];
    const byScope = new Map<string, number>();

    for (const d of decisions) {
      if (!isDecisionCleanupCandidate(d)) continue;
      const scopeCode = d.scope === 'global' ? 'global' : d.repo;
      items.push({
        kind: 'decision',
        key: `decision::${d.scope}::${d.repo}::${d.rel_path}`,
        scopeCode,
        scopeLabel: d.scope === 'global' ? '全局' : d.repo,
        name: d.name,
        id: d.id,
        evalCount: d.eval_count ?? 0,
        deletable: true,
        decision: d,
      });
      byScope.set(scopeCode, (byScope.get(scopeCode) || 0) + 1);
    }

    for (const l of lints) {
      if (!isLintCleanupCandidate(l)) continue;
      const scopeCode = l.scope === 'global' ? 'global' : l.repo;
      items.push({
        kind: 'lint',
        key: `lint::${l.repo}::${l.rel_path}::${l.id}`,
        scopeCode,
        scopeLabel: l.scope === 'global' ? '全局' : l.repo,
        name: l.name,
        id: l.id,
        evalCount: l.eval_count ?? 0,
        deletable: l.deletable ?? false,
        lint: l,
      });
      byScope.set(scopeCode, (byScope.get(scopeCode) || 0) + 1);
    }

    items.sort(
      (a, b) =>
        (a.kind === 'decision' ? 0 : 1) - (b.kind === 'decision' ? 0 : 1) ||
        b.evalCount - a.evalCount ||
        a.id.localeCompare(b.id)
    );

    const scopedDecisions = items.filter((i) => i.scopeCode === govScope && i.kind === 'decision').length;
    const scopedLints = items.filter((i) => i.scopeCode === govScope && i.kind === 'lint').length;

    return {
      items,
      byScope,
      scopedDecisions,
      scopedLints,
      scopedTotal: scopedDecisions + scopedLints,
    };
  }, [overview?.decisions, overview?.lints, govScope]);

  const navigateToChecker = useCallback(
    (target: { decision?: DecisionEntry; lint?: LintItem }) => {
      if (isRuleDirty || isDecisionDirty) {
        pushToast('当前规则或 Decision 有未保存修改，请先保存后再跳转', 'danger');
        return;
      }
      if (target.decision) {
        const d = target.decision;
        const scopeCode = d.scope === 'global' ? 'global' : d.repo;
        const repoCode = d.scope === 'global' ? '' : d.repo;
        setSubTab('rules');
        setGovScope(scopeCode);
        setGovLayer('decisions');
        setDecisionSearch('');
        void loadDecisionDirect(d.rel_path, repoCode);
      } else if (target.lint) {
        const l = target.lint;
        const scopeCode = l.scope === 'global' ? 'global' : l.repo;
        setSubTab('rules');
        setGovScope(scopeCode);
        setGovLayer('lints');
        void loadLintSourceDirect(l);
      }
    },
    [isRuleDirty, isDecisionDirty, pushToast, loadDecisionDirect, loadLintSourceDirect]
  );

  const checkerPerfRows = useMemo(() => {
    const decisions = overview?.decisions || [];
    const lints = overview?.lints || [];
    const rows = [
      ...decisions.map((d) => ({
        kind: 'decision' as const,
        key: `decision::${d.scope}::${d.repo}::${d.id}`,
        id: d.id,
        name: d.name,
        scopeLabel: d.scope === 'global' ? '全局' : d.repo,
        enabled: d.enabled,
        retired_at: d.retired_at,
        eval_count: d.eval_count ?? 0,
        hit_count: d.hit_count ?? 0,
        last_eval_ts: d.last_eval_ts ?? 0,
        cleanupCandidate: isDecisionCleanupCandidate(d),
        decision: d,
        lint: undefined as LintItem | undefined,
      })),
      ...lints.map((l) => ({
        kind: 'lint' as const,
        key: `lint::${l.repo}::${l.rel_path}::${l.id}`,
        id: l.id,
        name: l.name,
        scopeLabel: l.repo,
        enabled: true,
        retired_at: '',
        eval_count: l.eval_count ?? 0,
        hit_count: l.hit_count ?? 0,
        last_eval_ts: l.last_eval_ts ?? 0,
        cleanupCandidate: isLintCleanupCandidate(l),
        decision: undefined as DecisionEntry | undefined,
        lint: l,
      })),
    ];
    return rows.sort(
      (a, b) =>
        b.hit_count - a.hit_count ||
        b.eval_count - a.eval_count ||
        b.last_eval_ts - a.last_eval_ts ||
        a.id.localeCompare(b.id)
    );
  }, [overview?.decisions, overview?.lints]);

  const checkerPerfFilteredRows = useMemo(() => {
    if (checkerPerfFilter === 'CLEANUP') {
      return checkerPerfRows.filter((r) => r.cleanupCandidate);
    }
    if (checkerPerfFilter === 'HIT') {
      return checkerPerfRows.filter((r) => r.hit_count > 0);
    }
    return checkerPerfRows;
  }, [checkerPerfRows, checkerPerfFilter]);

  const chartTooltipBase = useMemo(
    () => ({
      backgroundColor: isDark ? '#18181B' : '#FFFFFF',
      borderColor: isDark ? 'rgba(63,63,70,0.85)' : '#E4E4E7',
      borderWidth: 1,
      textStyle: { color: isDark ? '#F4F4F5' : '#18181B', fontSize: 11 },
    }),
    [isDark]
  );

  // ---------------- Markdown 规则上下文官方预算监控 ----------------
  const liveRuleMetrics = useMemo(() => estimateMarkdownTokens(editorContent), [editorContent]);

  const ruleTokenStats = useMemo(() => {
    const toMetricRow = (r: GovernanceRuleEntry) => {
      const repoCode = r.scope === 'global' ? '' : r.repo;
      const isSelected = r.rel_path === selectedRulePath && repoCode === selectedRuleRepo;
      const est =
        isSelected && editorContent.length > 0
          ? liveRuleMetrics.estimated_tokens
          : r.estimated_tokens ?? Math.ceil((r.size_bytes || 0) / 3);
      const chars =
        isSelected && editorContent.length > 0
          ? liveRuleMetrics.char_count
          : r.char_count ?? r.size_bytes ?? 0;
      const bytes =
        isSelected && editorContent.length > 0
          ? liveRuleMetrics.byte_count
          : r.size_bytes ?? 0;
      const isMapFile =
        r.rel_path.toLowerCase() === 'agents.md' || r.rel_path.toLowerCase() === 'gemini.md';
      const displayLabel =
        r.scope === 'global' && r.rel_path === 'rules/mind-rules.md'
          ? '全局总则 (mind-rules)'
          : isMapFile
            ? `${r.repo}/${r.name}`
            : `${r.scope === 'global' ? '全局' : r.repo}/${r.name.replace(/\.md$/i, '')}`;
      return {
        ...r,
        isMapFile,
        displayLabel,
        liveTokens: est,
        liveChars: chars,
        liveBytes: bytes,
        fileStatus: getFileSizeStatus(bytes),
      };
    };

    const allRows = governanceRules.map(toMetricRow);
    const globalRows = allRows.filter((r) => r.scope === 'global');
    const globalTokens = globalRows.reduce((acc, r) => acc + r.liveTokens, 0);

    const scopedRows = filteredRules.map(toMetricRow);
    const scopedTokens = scopedRows.reduce((acc, r) => acc + r.liveTokens, 0);

    // 切换具体项目时，上下文分布图同步包含该仓实际同时注入的全局公共规则
    const rows = govScope === 'global' ? [...globalRows] : [...scopedRows, ...globalRows];
    rows.sort((a, b) => b.liveBytes - a.liveBytes || b.liveTokens - a.liveTokens);

    const sessionBudgetTokens =
      govScope === 'global' ? globalTokens : globalTokens + scopedTokens;
    const overCapCount = rows.filter((r) => r.liveBytes >= ANTIGRAVITY_FILE_BYTES_CAP).length;
    return {
      rows,
      scopedTokens,
      globalTokens,
      sessionBudgetTokens,
      overCapCount,
      aggregateStatus: getAggregateTokenStatus(sessionBudgetTokens, overCapCount),
    };
  }, [governanceRules, filteredRules, govScope, selectedRulePath, selectedRuleRepo, editorContent, liveRuleMetrics]);

  const ruleTokenChartOption = useMemo<EChartsCoreOption>(() => {
    const rows = [...ruleTokenStats.rows].reverse();
    const axisColor = isDark ? '#A1A1AA' : '#71717A';
    const splitLineColor = isDark ? 'rgba(63,63,70,0.45)' : '#F4F4F5';
    const maxBytes = rows.reduce((m, r) => Math.max(m, r.liveBytes), 0);
    const xMax = Math.max(30000, Math.ceil((maxBytes * 1.18) / 10000) * 10000);
    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          const row = rows[item?.dataIndex ?? 0];
          if (!row) return '';
          const bytePct = ((row.liveBytes / ANTIGRAVITY_FILE_BYTES_CAP) * 100).toFixed(1);
          const tokPct = ((row.liveTokens / ANTIGRAVITY_TOTAL_TOKENS_BUDGET) * 100).toFixed(1);
          return [
            `<div style="font-weight:600;margin-bottom:3px">${row.displayLabel}</div>`,
            `<div>物理体积：<b>${(row.liveBytes / 1024).toFixed(1)} KB</b> (${row.liveBytes.toLocaleString()} / 24,000 B · 占单文件上限 ${bytePct}%)</div>`,
            `<div>估算 Token：<b>${row.liveTokens.toLocaleString()}</b> tok (占 20k 总预算 ${tokPct}%)</div>`,
            `<div>字符数：${row.liveChars.toLocaleString()} · 条款：${row.clause_count} 条</div>`,
            `<div>状态：<span style="color:${row.fileStatus.colorHex};font-weight:600">${row.fileStatus.label}</span></div>`,
          ].join('');
        },
      },
      grid: { left: 4, right: 56, top: 20, bottom: 14, containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        max: xMax,
        splitNumber: 4,
        axisLabel: {
          color: axisColor,
          fontSize: 9.5,
          formatter: (val: number) => (val === 0 ? '0' : `${Math.round(val / 1000)} KB`),
        },
        splitLine: { lineStyle: { color: splitLineColor, width: 1 } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.displayLabel),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: isDark ? '#D4D4D8' : '#3F3F46', fontSize: 10.5 },
      },
      series: [
        {
          name: '单文件字节体积',
          type: 'bar',
          barMaxWidth: 10,
          data: rows.map((r) => ({
            value: r.liveBytes,
            itemStyle: { color: r.fileStatus.colorHex, borderRadius: [0, 3, 3, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            fontSize: 9.5,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            color: axisColor,
            formatter: (p: any) => {
              const row = rows[p.dataIndex];
              if (!row) return '';
              return `${(row.liveBytes / 1000).toFixed(1)} KB`;
            },
          },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              {
                xAxis: ANTIGRAVITY_FILE_BYTES_WARN,
                lineStyle: { color: '#F59E0B', type: 'dashed', width: 1 },
                label: {
                  show: true,
                  position: 'end',
                  distance: 3,
                  fontSize: 9,
                  color: '#F59E0B',
                  formatter: '18 KB 预警',
                },
              },
              {
                xAxis: ANTIGRAVITY_FILE_BYTES_CAP,
                lineStyle: { color: '#F43F5E', type: 'dashed', width: 1.2 },
                label: {
                  show: true,
                  position: 'end',
                  distance: 3,
                  fontSize: 9,
                  color: '#F43F5E',
                  formatter: '24 KB 截断',
                },
              },
            ],
          },
        },
      ],
    };
  }, [ruleTokenStats, chartTooltipBase, isDark]);

  const verdictDonutOption = useMemo<EChartsCoreOption>(() => {
    const hasData = telemetryComputed.totalRecent > 0;
    const seriesData = hasData
      ? [
          { value: telemetryComputed.passCount, name: '直接放行', itemStyle: { color: '#10B981' } },
          { value: telemetryComputed.docsAskCount, name: '文档 / 人工确认', itemStyle: { color: '#F59E0B' } },
          { value: telemetryComputed.autoLearnCount, name: '自动沉淀防线', itemStyle: { color: '#6366F1' } },
          { value: telemetryComputed.alertCount, name: '红线拦截 / 异常', itemStyle: { color: '#F43F5E' } },
        ].filter((item) => item.value > 0)
      : [{ value: 1, name: '暂无遥测事件', itemStyle: { color: isDark ? '#27272A' : '#E4E4E7' } }];

    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'item',
        formatter: hasData ? '{b}: {c} 次 ({d}%)' : '尚无 Harness 遥测事件',
      },
      series: [
        {
          type: 'pie',
          radius: ['56%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDark ? '#18181B' : '#FFFFFF',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 3 },
          data: seriesData,
        },
      ],
    };
  }, [telemetryComputed, isDark, chartTooltipBase]);

  const formatCompactTokens = (value: number | undefined): string => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
  };

  const tokenLoadOption = useMemo<EChartsCoreOption>(() => {
    const trends = telemetry?.daily_trends || [];
    const axisColor = isDark ? '#A1A1AA' : '#71717A';
    const splitColor = isDark ? 'rgba(63,63,70,0.45)' : 'rgba(228,228,231,0.7)';
    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        top: 0,
        right: 4,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { color: axisColor, fontSize: 10 },
      },
      grid: { top: 28, right: 34, bottom: 20, left: 42 },
      xAxis: {
        type: 'category',
        data: trends.map((d) => d.date.slice(5)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10, interval: 1 },
      },
      yAxis: [
        {
          type: 'value',
          minInterval: 1,
          splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
          axisLabel: {
            color: axisColor,
            fontSize: 10,
            formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`),
          },
        },
        {
          type: 'value',
          minInterval: 1,
          splitLine: { show: false },
          axisLabel: { color: axisColor, fontSize: 10 },
        },
      ],
      series: [
        {
          name: '评估 Token',
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 16,
          itemStyle: { color: '#3B82F6', borderRadius: [3, 3, 0, 0] },
          data: trends.map((d) => d.tokens_evaluated || 0),
        },
        {
          name: 'Diff 分块数',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: '#F59E0B', width: 2 },
          itemStyle: { color: '#F59E0B' },
          data: trends.map((d) => d.diff_chunks_count || 0),
        },
      ],
    };
  }, [telemetry?.daily_trends, isDark, chartTooltipBase]);

  const trendBarOption = useMemo<EChartsCoreOption>(() => {
    const trends = telemetry?.daily_trends || [];
    const axisColor = isDark ? '#A1A1AA' : '#71717A';
    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        top: 0,
        right: 4,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { color: axisColor, fontSize: 10 },
      },
      grid: { top: 26, right: 8, bottom: 20, left: 26 },
      xAxis: {
        type: 'category',
        data: trends.map((d) => d.date.slice(5)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10, interval: 1 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: isDark ? 'rgba(63,63,70,0.45)' : 'rgba(228,228,231,0.7)', type: 'dashed' } },
        axisLabel: { color: axisColor, fontSize: 10 },
      },
      series: [
        {
          name: '放行',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 14,
          itemStyle: { color: '#10B981' },
          data: trends.map((d) => d.allow_or_pass),
        },
        {
          name: '门禁唤醒',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 14,
          itemStyle: { color: '#3B82F6' },
          data: trends.map((d) => d.hook_woke),
        },
        {
          name: '拦截 / 异常',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 14,
          itemStyle: { color: '#F43F5E', borderRadius: [3, 3, 0, 0] },
          data: trends.map((d) => d.violated_or_error),
        },
      ],
    };
  }, [telemetry?.daily_trends, isDark, chartTooltipBase]);

  const confidenceBarOption = useMemo<EChartsCoreOption>(() => {
    const axisColor = isDark ? '#A1A1AA' : '#71717A';
    const colors = ['#F43F5E', '#F59E0B', '#3B82F6', '#10B981'];
    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          return item ? `置信区间 ${item.name}：${item.value} 次` : '';
        },
      },
      grid: { top: 14, right: 16, bottom: 22, left: 32 },
      xAxis: {
        type: 'category',
        data: ['< 0.70', '0.70–0.85', '0.85–0.95', '≥ 0.95'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: isDark ? 'rgba(63,63,70,0.45)' : 'rgba(228,228,231,0.7)', type: 'dashed' } },
        axisLabel: { color: axisColor, fontSize: 10 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 32,
          data: telemetryComputed.confBuckets.map((val, idx) => ({
            value: val,
            itemStyle: { color: colors[idx], borderRadius: [5, 5, 0, 0] },
          })),
          label: {
            show: true,
            position: 'top',
            color: axisColor,
            fontSize: 10,
            formatter: ({ value }: any) => (value > 0 ? `${value}` : ''),
          },
        },
      ],
    };
  }, [telemetryComputed.confBuckets, isDark, chartTooltipBase]);

  const proposalFunnelOption = useMemo<EChartsCoreOption>(() => {
    const axisColor = isDark ? '#A1A1AA' : '#71717A';
    const values = [
      { value: proposalStats.dismissed, color: '#94A3B8' },
      { value: proposalStats.adopted, color: '#10B981' },
      { value: proposalStats.inProgress, color: '#2563EB' },
      { value: proposalStats.pendingOnly, color: '#F59E0B' },
    ];
    return {
      tooltip: {
        ...chartTooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: { top: 8, right: 36, bottom: 10, left: 68 },
      xAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: isDark ? 'rgba(63,63,70,0.45)' : 'rgba(228,228,231,0.7)', type: 'dashed' } },
        axisLabel: { color: axisColor, fontSize: 10 },
      },
      yAxis: {
        type: 'category',
        data: ['暂不采纳', '已采纳', '推进中', '待推进'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 16,
          data: values.map((item) => ({
            value: item.value,
            itemStyle: { color: item.color, borderRadius: [0, 5, 5, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            color: axisColor,
            fontSize: 10.5,
            formatter: '{c} 份',
          },
        },
      ],
    };
  }, [proposalStats, isDark, chartTooltipBase]);

  const displayedProposalBody = useMemo(
    () => (proposalSourceMode === 'raw' ? openedProposalRaw.trim() : stripReviewFrontmatter(openedProposalRaw)),
    [proposalSourceMode, openedProposalRaw]
  );

  const displayedReviewBody = useMemo(
    () => (reviewSourceMode === 'raw' ? openedReviewRaw.trim() : stripReviewFrontmatter(openedReviewRaw)),
    [reviewSourceMode, openedReviewRaw]
  );

  const canDeleteSelectedRule = Boolean(
    scopedActiveRuleEntry &&
      selectedRulePath &&
      (scopedActiveRuleEntry.editable ?? true) &&
      !(!selectedRuleRepo && PROTECTED_FILES.has(selectedRulePath)) &&
      (selectedRulePath.startsWith('rules/') || selectedRulePath.startsWith('.agents/rules/'))
  );

  const canDeleteSelectedDecision = Boolean(
    scopedActiveDecisionEntry &&
      selectedDecisionKey &&
      (scopedActiveDecisionEntry.editable ?? true) &&
      !(!selectedDecisionKey.repoCode && PROTECTED_FILES.has(selectedDecisionKey.relPath))
  );

  const govSummary = overview?.governance_summary;

  useEffect(() => {
    setIsNewRuleOpen(false);
    setIsNewDecisionOpen(false);
  }, [govScope]);

  return (
    <div className="flex flex-col gap-3 max-w-[1440px] mx-auto">
      {loadError && (
        <div className="rounded-xl bg-rose-500/8 border border-rose-500/25 px-3.5 py-2 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 1 (首页): 规则规范 — 门户 Hero + 四层治理 + 富内容作用域选择器 */}
      {/* ================================================================= */}
      {subTab === 'rules' && (
        <>
          <PortalHero
            icon={<ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            eyebrow="AGENT MIND · GOVERNANCE"
            title={
              govScope === 'global'
                ? '心智治理规则与跨仓双层文档中枢'
                : `${govScope} · 仓库治理与双层文档工作台`
            }
            description="统筹维护全局与分仓规则大地图（RULES）、双层治理文档（常青架构 / 按日记录 / 暂缓过期）、Google Decisions 语义裁决与确定性 Lint 门禁。"
            badge={
              govScope !== 'global' && activeScopeOption?.hasGit === false ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[10px] font-medium">
                  <ShieldAlert className="w-3 h-3" />
                  未检测到 Git
                </span>
              ) : isGovScopeReadOnly ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-surface-secondary text-muted border border-zinc-200/80 dark:border-border/70 text-[10px]">
                  <Lock className="w-3 h-3 text-amber-500" />
                  只读靶场
                </span>
              ) : null
            }
            metrics={[
              {
                label: '规则 / 地图',
                value: filteredRules.length,
                hint: `${ruleTokenStats.sessionBudgetTokens.toLocaleString()} tok`,
              },
              {
                label: '治理文档',
                value: scopedDocTierCounts.total,
                tone: 'emerald',
                hint: `${scopedDocTierCounts.glossary > 0 ? `术语 ${scopedDocTierCounts.glossary} · ` : ''}常青 ${scopedDocTierCounts.evergreen} · 记录 ${scopedDocTierCounts.record}${
                  scopedDocTierCounts.deferred > 0 ? ` · 暂缓 ${scopedDocTierCounts.deferred}` : ''
                }`,
              },
              {
                label: 'Decisions',
                value: filteredDecisions.length,
                tone: 'blue',
              },
              {
                label: 'Lint 门禁',
                value: filteredLints.length,
              },
            ]}
          />

          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 flex flex-col">
            <div className="px-4 pt-2.5 pb-0 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-5">
                {[
                  {
                    id: 'rules' as const,
                    label: '规则与地图',
                    count: filteredRules.length,
                    alertDot: ruleTokenStats.aggregateStatus.level !== 'ok' ? ruleTokenStats.aggregateStatus.dotClass : '',
                    cleanupCount: 0,
                  },
                  {
                    id: 'docs' as const,
                    label: '治理文档',
                    count: scopedRepoDocs.length,
                    alertDot: '',
                    cleanupCount: 0,
                  },
                  {
                    id: 'decisions' as const,
                    label: 'Decision 决策',
                    count: filteredDecisions.length,
                    alertDot: cleanupSummary.scopedDecisions > 0 ? 'bg-amber-500' : '',
                    cleanupCount: cleanupSummary.scopedDecisions,
                  },
                  {
                    id: 'lints' as const,
                    label: 'Lint 检查',
                    count: filteredLints.length,
                    alertDot: cleanupSummary.scopedLints > 0 ? 'bg-amber-500' : '',
                    cleanupCount: cleanupSummary.scopedLints,
                  },
                ].map((t) => {
                const active = govLayer === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setGovLayer(t.id)}
                    className={`relative pb-2 text-[12px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-muted hover:text-foreground'
                    }`}
                  >
                    <span>{t.label}</span>
                    <span className="text-[10px] font-mono text-muted">{t.count}</span>
                    {t.alertDot && <span className={`w-1.5 h-1.5 rounded-full ${t.alertDot}`} />}
                    {active && (
                      <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-foreground rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 pb-1.5 text-[10.5px]">
              {/* 富内容可搜索作用域下拉选择器 */}
              <div ref={scopePickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setScopePickerOpen((v) => !v)}
                  className="h-7 px-2.5 rounded-lg bg-zinc-50 dark:bg-surface-secondary/70 border border-zinc-200/85 dark:border-border/75 hover:border-zinc-300 dark:hover:border-zinc-600 inline-flex items-center gap-1.5 text-[11px] text-foreground transition-colors cursor-pointer"
                >
                  {activeScopeOption?.maxBytes >= ANTIGRAVITY_FILE_BYTES_WARN ? (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        getFileSizeStatus(activeScopeOption.maxBytes).dotClass
                      }`}
                    />
                  ) : cleanupSummary.items.length > 0 ? (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" title="存在长期零违规可清理项" />
                  ) : null}
                  <span className="text-muted">作用域</span>
                  <span className="font-mono font-semibold">
                    {govScope === 'global' ? '全局通用' : govScope}
                  </span>
                  {activeScopeOption?.hasGit === false && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[9.5px] font-medium"
                      title="该项目目录未检测到 .git 仓库，Stop Hook 文档门禁与提交前代码审核将静默跳过"
                    >
                      <ShieldAlert className="w-2.5 h-2.5" />
                      无 Git
                    </span>
                  )}
                  {isGovScopeReadOnly && <Lock className="w-3 h-3 text-amber-500" />}
                  <ChevronDown className="w-3.5 h-3.5 text-muted" />
                </button>

                {scopePickerOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-[390px] max-w-[92vw] rounded-xl bg-white dark:bg-surface border border-zinc-200/90 dark:border-border shadow-lg z-40 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-200/75 dark:border-border/60 bg-zinc-50/60 dark:bg-surface-secondary/30">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          autoFocus
                          value={scopeSearch}
                          onChange={(e) => setScopeSearch(e.target.value)}
                          placeholder="搜索作用域：全局、仓库名、路径或简介..."
                          className="w-full h-7 pl-8 pr-7 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/75 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400"
                        />
                        {scopeSearch && (
                          <button
                            type="button"
                            onClick={() => setScopeSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-[340px] overflow-y-auto divide-y divide-zinc-200/60 dark:divide-border/50">
                      {filteredScopeOptions.length === 0 ? (
                        <div className="py-8 text-center text-[11px] text-muted">
                          未找到匹配的全局或项目作用域
                        </div>
                      ) : (
                        filteredScopeOptions.map((opt) => {
                          const selected = opt.code === govScope;
                          const alertStatus =
                            opt.maxBytes >= ANTIGRAVITY_FILE_BYTES_WARN
                              ? getFileSizeStatus(opt.maxBytes)
                              : null;
                          return (
                            <button
                              key={opt.code}
                              type="button"
                              onClick={() => handleSelectGovScope(opt.code)}
                              className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer flex flex-col gap-1 ${
                                selected
                                  ? 'bg-zinc-100/80 dark:bg-surface-secondary/75'
                                  : 'hover:bg-zinc-50 dark:hover:bg-surface-secondary/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {alertStatus && (
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${alertStatus.dotClass}`}
                                      title={alertStatus.label}
                                    />
                                  )}
                                  <span className="text-[12px] font-mono font-semibold text-foreground truncate">
                                    {opt.code === 'global' ? '全局通用 (a8-agent-mind)' : opt.code}
                                  </span>
                                  {opt.role !== 'global' && (
                                    <span className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-muted shrink-0">
                                      {ROLE_LABELS[opt.role] || opt.role.toUpperCase()}
                                    </span>
                                  )}
                                  {opt.role === 'test-bed' && (
                                    <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                                  )}
                                  {opt.hasGit === false && (
                                    <span
                                      className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[9.5px] shrink-0"
                                      title="未检测到 .git 仓库：Stop Hook 文档门禁将静默跳过"
                                    >
                                      <ShieldAlert className="w-2.5 h-2.5" />
                                      无 Git
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-muted">
                                  {(cleanupSummary.byScope.get(opt.code) || 0) > 0 && (
                                    <span className="px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 font-sans">
                                      可清理 {cleanupSummary.byScope.get(opt.code)}
                                    </span>
                                  )}
                                  <span>
                                    规则 {opt.rulesCount} · Decision {opt.decisionsCount} · Lint {opt.lintsCount}
                                  </span>
                                  {opt.totalTokens > 0 && (
                                    <span className="text-foreground/80">· {opt.totalTokens.toLocaleString()}t</span>
                                  )}
                                  {selected && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                                </div>
                              </div>

                              {(opt.summary || opt.physicalPath) && (
                                <div className="text-[10.5px] text-muted truncate">
                                  {opt.summary}
                                  {opt.summary && opt.physicalPath ? ' · ' : ''}
                                  {opt.physicalPath && (
                                    <span className="font-mono opacity-80">{opt.physicalPath}</span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {cleanupSummary.items.length > 0 && (
            <div className="px-4 py-2 bg-amber-500/7 dark:bg-amber-500/8 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  发现 {cleanupSummary.items.length} 项长期 0 违规检查器可评估清理：
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {cleanupSummary.items.slice(0, 6).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => navigateToChecker({ decision: item.decision, lint: item.lint })}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/85 dark:bg-surface border border-amber-500/30 hover:border-amber-500 text-[10.5px] text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                      title={`点击定位到 ${item.scopeLabel} / ${item.name}（累计评估 ${item.evalCount} 次，0 违规）`}
                    >
                      <span className="font-mono text-[9.5px] text-amber-700/80 dark:text-amber-400/80">
                        [{item.scopeLabel}]
                      </span>
                      <span className="font-medium truncate max-w-[160px]">{item.name}</span>
                      <span className="font-mono text-[9.5px] opacity-80">
                        {item.evalCount}次·0违
                      </span>
                    </button>
                  ))}
                  {cleanupSummary.items.length > 6 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSubTab('observability');
                        setCheckerPerfFilter('CLEANUP');
                      }}
                      className="text-[10.5px] font-medium text-amber-700 dark:text-amber-300 hover:underline px-1 cursor-pointer"
                    >
                      +{cleanupSummary.items.length - 6} 项查看全部 →
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSubTab('observability');
                  setCheckerPerfFilter('CLEANUP');
                }}
                className="text-[10.5px] font-medium text-amber-800 dark:text-amber-300 hover:underline shrink-0 cursor-pointer"
              >
                效能表对比清理 →
              </button>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 1: Markdown 规则 (单卡扁平内联：常驻融入式预算分布 + 文件) */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'rules' && (
            <div className="flex flex-col">
              <div className="px-4 py-2 border-b border-zinc-200/75 dark:border-border/55 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                <div className="lg:col-span-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ruleTokenStats.aggregateStatus.dotClass}`} />
                      <span className="font-medium text-foreground truncate">
                        {govScope === 'global' ? '全局常驻预算' : `${govScope} 会话注入`}
                      </span>
                      <span className="text-[10px] text-muted shrink-0">
                        · {ruleTokenStats.aggregateStatus.label}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-foreground shrink-0">
                      {ruleTokenStats.sessionBudgetTokens.toLocaleString()} /{' '}
                      {ANTIGRAVITY_TOTAL_TOKENS_BUDGET.toLocaleString()} t
                    </span>
                  </div>

                  <div className="relative h-1.5 rounded-full bg-zinc-100 dark:bg-surface-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((ruleTokenStats.sessionBudgetTokens / ANTIGRAVITY_TOTAL_TOKENS_BUDGET) * 100))}%`,
                        backgroundColor:
                          ruleTokenStats.sessionBudgetTokens >= ANTIGRAVITY_TOTAL_TOKENS_BUDGET
                            ? '#F43F5E'
                            : ruleTokenStats.sessionBudgetTokens >= ANTIGRAVITY_TOTAL_TOKENS_WARN
                              ? '#F59E0B'
                              : '#10B981',
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
                    <span>
                      {govScope === 'global'
                        ? `全局 ${filteredRules.length} 篇 (${ruleTokenStats.globalTokens.toLocaleString()}t)`
                        : `本仓 ${ruleTokenStats.scopedTokens.toLocaleString()}t + 公共全局 ${ruleTokenStats.globalTokens.toLocaleString()}t`}
                    </span>
                    <span>单文件上限 24 KB</span>
                  </div>

                  {ruleTokenStats.aggregateStatus.level !== 'ok' && (
                    <p className="text-[10.5px] text-amber-700 dark:text-amber-400 leading-snug">
                      {ruleTokenStats.aggregateStatus.hint}
                    </p>
                  )}
                </div>

                {ruleTokenStats.rows.length > 0 ? (
                  <div
                    className="lg:col-span-8 w-full lg:border-l lg:border-zinc-200/70 dark:lg:border-border/50 lg:pl-3"
                    style={{ height: `${Math.max(76, Math.min(180, ruleTokenStats.rows.length * 24 + 34))}px` }}
                  >
                    <EChartBox option={ruleTokenChartOption} className="w-full h-full" />
                  </div>
                ) : (
                  <div className="lg:col-span-8 py-4 text-center text-[11px] text-muted">
                    暂无规则或大地图文件
                  </div>
                )}
              </div>

              <div className="px-4 py-2 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  {filteredRules.map((f) => {
                    const ruleRepoCode = f.scope === 'global' ? '' : f.repo;
                    const active = selectedRulePath === f.rel_path && selectedRuleRepo === ruleRepoCode;
                    const isMaster = f.scope === 'global' && f.rel_path === 'rules/mind-rules.md';
                    const isMap =
                      f.rel_path.toLowerCase() === 'agents.md' || f.rel_path.toLowerCase() === 'gemini.md';
                    const estTokens =
                      active && editorContent.length > 0
                        ? liveRuleMetrics.estimated_tokens
                        : f.estimated_tokens ?? Math.ceil((f.size_bytes || 0) / 3);
                    const fileBytes =
                      active && editorContent.length > 0 ? liveRuleMetrics.byte_count : f.size_bytes ?? 0;
                    const byteStatus = getFileSizeStatus(fileBytes);
                    const shortLabel = isMaster
                      ? 'mind-rules.md · 全局总则'
                      : isMap
                        ? `${f.name} · 大地图`
                        : f.name;
                    return (
                      <button
                        key={`${f.repo}::${f.rel_path}`}
                        onClick={() => requestSwitchRule(f.rel_path, ruleRepoCode)}
                        title={`${f.title || f.name} · ${f.abs_path || f.rel_path} · ${(fileBytes / 1000).toFixed(1)} KB · 约 ${estTokens} tok`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                            : 'text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60'
                        }`}
                      >
                        <span className="font-mono">{shortLabel}</span>
                        <span
                          className={`text-[9.5px] font-mono px-1.5 py-[1px] rounded border ${byteStatus.pillClass}`}
                        >
                          {(fileBytes / 1000).toFixed(1)}KB
                        </span>
                      </button>
                    );
                  })}

                  {!isGovScopeReadOnly && (
                    <button
                      onClick={() => {
                        setNewRuleTargetRepo(govScope === 'global' ? '' : govScope);
                        setIsNewRuleOpen((v) => !v);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60 transition-colors cursor-pointer"
                    >
                      {isNewRuleOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      <span>{isNewRuleOpen ? '收起' : '新建规则'}</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {filteredRules.length > 0 && scopedActiveRuleEntry && (
                    <>
                      <span className="text-[10.5px] font-mono text-muted hidden md:inline pr-1">
                        {liveRuleMetrics.byte_count.toLocaleString()} / 24,000 B · {liveRuleMetrics.estimated_tokens.toLocaleString()}t · {scopedActiveRuleEntry.clause_count}条
                      </span>
                      {!scopedActiveRuleEntry.editable && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400 px-1">
                          <Lock className="w-3 h-3" />
                          只读
                        </span>
                      )}
                      {isRuleDirty ? (
                        <span className="text-[10.5px] text-amber-600 dark:text-amber-400 px-1">未保存</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 px-1">
                          <Check className="w-3 h-3" />
                          已同步
                        </span>
                      )}

                      <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                        <button
                          onClick={() => setRuleMode('preview')}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                            ruleMode === 'preview'
                              ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          <Eye className="w-3 h-3" />
                          <span>阅读</span>
                        </button>
                        <button
                          onClick={() => setRuleMode('edit')}
                          disabled={!scopedActiveRuleEntry.editable}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors disabled:opacity-45 ${
                            ruleMode === 'edit'
                              ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>编辑</span>
                        </button>
                      </div>

                      {canDeleteSelectedRule && (
                        <InlineDeleteButton
                          confirming={confirmDeleteRule}
                          deleting={deletingFile}
                          onRequest={() => setConfirmDeleteRule(true)}
                          onCancel={() => setConfirmDeleteRule(false)}
                          onConfirm={() => executeDeleteFile(selectedRulePath, 'rule', selectedRuleRepo)}
                        />
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        isPending={loadingFile}
                        className="h-7 px-2.5 rounded-lg text-[11px]"
                        onPress={() => loadRuleFileDirect(selectedRulePath, selectedRuleRepo)}
                      >
                        重载
                      </Button>

                      <Button
                        size="sm"
                        variant="primary"
                        isPending={savingFile}
                        isDisabled={(!isRuleDirty && !savingFile) || !scopedActiveRuleEntry.editable}
                        className="h-7 px-3 rounded-lg text-[11px]"
                        onPress={handleSaveCurrentRule}
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>保存</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isNewRuleOpen && (
                <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-surface-secondary/35 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center gap-2">
                  <span className="h-7 px-2.5 inline-flex items-center rounded-lg bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-[11px] font-mono text-muted">
                    {newRuleTargetRepo
                      ? `项目 ${newRuleTargetRepo} (.agents/rules/)`
                      : '全局 (a8-agent-mind/rules/)'}
                  </span>
                  <input
                    value={newRuleName}
                    onChange={(e) => setNewRuleName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateRule();
                      } else if (e.key === 'Escape') {
                        setIsNewRuleOpen(false);
                      }
                    }}
                    placeholder="文件名（如 redline-sql.md）"
                    className="h-7 px-2.5 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 font-mono text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400 w-52"
                  />
                  <input
                    value={newRuleDesc}
                    onChange={(e) => setNewRuleDesc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateRule();
                      }
                    }}
                    placeholder="一句话定位说明（可选）"
                    className="h-7 px-2.5 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400 flex-1 min-w-[200px]"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    isPending={creatingRule}
                    className="h-7 px-3 rounded-lg text-[11px]"
                    onPress={handleCreateRule}
                  >
                    立即创建
                  </Button>
                </div>
              )}

              {pendingRuleSwitch && (
                <UnsavedInlineBar
                  busy={savingFile}
                  onSaveAndContinue={async () => {
                    const next = pendingRuleSwitch;
                    const ok = await handleSaveCurrentRule();
                    if (ok && next) await loadRuleFileDirect(next.relPath, next.repoCode);
                  }}
                  onDiscardAndContinue={() =>
                    loadRuleFileDirect(pendingRuleSwitch.relPath, pendingRuleSwitch.repoCode)
                  }
                  onCancel={() => setPendingRuleSwitch(null)}
                />
              )}

              {filteredRules.length === 0 ? (
                <div className="py-16 px-4 text-center text-[11.5px] text-muted">
                  {govScope === 'global' ? '全局作用域' : govScope} 暂无 AGENTS.md 或 .agents/rules/*.md 规则文档
                  {!isGovScopeReadOnly && '，可点击上方「新建规则」创建红线文档'}
                </div>
              ) : (
                <div className="px-5 py-4">
                  {loadingFile && !editorContent ? (
                    <div className="py-16 text-center text-[11.5px] text-muted">
                      正在加载 {selectedRulePath}...
                    </div>
                  ) : ruleMode === 'preview' ? (
                    <MarkdownArticle content={stripReviewFrontmatter(editorContent)} />
                  ) : (
                    <textarea
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      spellCheck={false}
                      className="w-full min-h-[540px] font-mono text-[12px] text-foreground dark:text-slate-100 bg-transparent focus:outline-none resize-y leading-relaxed"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 1.5: 仓库双层治理文档 (docs/evergreen · records · deferred) */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'docs' && (
            <div className="min-h-[540px]">
              <RepoDocsBrowser
                docs={scopedRepoDocs}
                allRepoDocs={allRepoDocs}
                variant="all"
                showRepoBadge={govScope === 'global'}
                emptyHint={
                  govScope === 'global'
                    ? '已登记仓库下暂未扫描到 docs/ 文档'
                    : `仓库 ${govScope} 下暂未扫描到 docs/ 文档`
                }
                callTauri={callTauri}
                pushToast={pushToast}
                renderArticle={(content, onOpenDocLink) => (
                  <MarkdownArticle content={content} onOpenDocLink={onOpenDocLink} />
                )}
              />
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 2: Decision 决策 (*.decision.json 结构化语义裁决配置)       */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'decisions' && (
            <div className="flex flex-col">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={decisionSearch}
                      onChange={(e) => setDecisionSearch(e.target.value)}
                      placeholder="筛选 Decision 名称、ID、规则说明..."
                      className="h-7 pl-8 pr-2.5 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400 w-64"
                    />
                  </div>
                  {!isGovScopeReadOnly && (
                    <button
                      onClick={() => {
                        setNewDecisionTargetRepo(govScope === 'global' ? '' : govScope);
                        setIsNewDecisionOpen((v) => !v);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60 border border-zinc-200/75 dark:border-border/60 transition-colors cursor-pointer"
                    >
                      {isNewDecisionOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      <span>{isNewDecisionOpen ? '收起' : '新建 Decision'}</span>
                    </button>
                  )}
                </div>

                <div className="text-[11px] text-muted">
                  确定性优先级：<span className="font-mono text-foreground">Lint &gt; Decision &gt; Prose Rule</span>
                  ，无单次字符上限
                </div>
              </div>

              {isNewDecisionOpen && (
                <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-surface-secondary/35 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center gap-2">
                  <span className="h-7 px-2.5 inline-flex items-center rounded-lg bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-[11px] font-mono text-muted">
                    {newDecisionTargetRepo
                      ? `项目 ${newDecisionTargetRepo} (scripts/lints/)`
                      : '全局 (a8-agent-mind/decisions/)'}
                  </span>
                  <select
                    value={newDecisionCategory}
                    onChange={(e) => setNewDecisionCategory(e.target.value)}
                    aria-label="Decision 维度分类"
                    className="h-7 px-2 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 text-[11px] text-foreground outline-none"
                  >
                    {Object.entries(DECISION_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input
                    value={newDecisionName}
                    onChange={(e) => setNewDecisionName(e.target.value)}
                    placeholder="名称/Slug（如 cache_contract）"
                    className="h-7 px-2.5 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 font-mono text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400 w-52"
                  />
                  <input
                    value={newDecisionWhy}
                    onChange={(e) => setNewDecisionWhy(e.target.value)}
                    placeholder="工程根因说明（why，可选）"
                    className="h-7 px-2.5 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400 flex-1 min-w-[200px]"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    isPending={creatingDecision}
                    className="h-7 px-3 rounded-lg text-[11px]"
                    onPress={handleCreateDecision}
                  >
                    立即创建
                  </Button>
                </div>
              )}

              {pendingDecisionSwitch && (
                <UnsavedInlineBar
                  busy={savingDecision}
                  onSaveAndContinue={async () => {
                    const next = pendingDecisionSwitch;
                    const ok = await handleSaveCurrentDecision();
                    if (ok && next) await loadDecisionDirect(next.relPath, next.repoCode);
                  }}
                  onDiscardAndContinue={() =>
                    loadDecisionDirect(pendingDecisionSwitch.relPath, pendingDecisionSwitch.repoCode)
                  }
                  onCancel={() => setPendingDecisionSwitch(null)}
                />
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[540px]">
                {/* 左侧 Decision 列表 */}
                <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-zinc-200/80 dark:border-border/60 divide-y divide-zinc-200/70 dark:divide-border/50">
                  {filteredDecisions.length === 0 ? (
                    <div className="py-16 text-center text-[11.5px] text-muted">
                      当前筛选范围内暂无 Decision 决策定义
                    </div>
                  ) : (
                    filteredDecisions.map((d) => {
                      const dRepo = d.scope === 'global' ? '' : d.repo;
                      const active =
                        selectedDecisionKey?.relPath === d.rel_path && selectedDecisionKey?.repoCode === dRepo;
                      return (
                        <div
                          key={`${d.repo}::${d.rel_path}`}
                          onClick={() => requestSwitchDecision(d.rel_path, dRepo)}
                          className={`px-4 py-3 cursor-pointer transition-colors ${
                            active
                              ? 'bg-zinc-50 dark:bg-surface-secondary/60'
                              : 'hover:bg-zinc-50/60 dark:hover:bg-surface-secondary/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    d.parse_error
                                      ? 'bg-rose-500'
                                      : d.enabled
                                        ? 'bg-emerald-500'
                                        : 'bg-zinc-400'
                                  }`}
                                />
                                <span className="text-[12.5px] font-semibold text-foreground truncate">
                                  {d.name}
                                </span>
                                <span className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-muted">
                                  {d.scope === 'global' ? '全局' : d.repo}
                                </span>
                                <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-zinc-100 dark:bg-surface-secondary text-muted">
                                  {DECISION_CATEGORY_LABELS[d.category] || d.category}
                                </span>
                              </div>
                              <div className="text-[10.5px] font-mono text-muted mt-0.5 truncate">
                                {d.id} · {d.rel_path}
                              </div>
                            </div>

                            {d.editable && !d.parse_error && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleDecisionEnabled(d);
                                }}
                                title={d.enabled ? '点击一键退役' : '点击恢复启用'}
                                className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                                  d.enabled
                                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15'
                                    : 'bg-zinc-100 dark:bg-surface-secondary text-muted border-zinc-200 dark:border-border/70 hover:text-foreground'
                                }`}
                              >
                                {d.enabled ? '使用中' : '已退役'}
                              </button>
                            )}
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-[9.5px] font-mono px-1.5 py-[1px] rounded border ${
                                (d.hit_count ?? 0) > 0
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25'
                                  : 'bg-zinc-50 dark:bg-surface border-zinc-200/80 dark:border-border/60 text-muted'
                              }`}
                            >
                              评估 {d.eval_count ?? 0} · 拦截 {d.hit_count ?? 0}
                            </span>
                            {isDecisionCleanupCandidate(d) && (
                              <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                                0 违规 · 可删除
                              </span>
                            )}
                            {!d.enabled && d.retired_at && (
                              <span className="text-[9.5px] font-mono text-muted">
                                退役于 {d.retired_at}
                              </span>
                            )}
                          </div>

                          {d.parse_error ? (
                            <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400 truncate">
                              JSON 解析失败：{d.parse_error}
                            </div>
                          ) : (
                            d.why && (
                              <p className="mt-1.5 text-[11px] text-muted line-clamp-2 leading-relaxed">
                                {d.why}
                              </p>
                            )
                          )}

                          {d.triggers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {d.triggers.slice(0, 4).map((t) => (
                                <span
                                  key={t}
                                  className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-zinc-100/90 dark:bg-surface-secondary text-muted"
                                >
                                  #{t}
                                </span>
                              ))}
                              {d.file_patterns.slice(0, 2).map((fp) => (
                                <span
                                  key={fp}
                                  className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-sky-500/8 text-sky-700 dark:text-sky-400"
                                >
                                  {fp}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 右侧 Decision 详情 / JSON 编辑器 */}
                <div className="lg:col-span-7 flex flex-col">
                  {!scopedActiveDecisionEntry ? (
                    <div className="py-20 text-center text-[11.5px] text-muted">
                      {filteredDecisions.length === 0
                        ? '当前作用域暂无 Decision 决策定义'
                        : '从左侧选择一条 Decision 决策查看裁决判据或编辑 JSON 定义'}
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2.5 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/40 dark:bg-surface-secondary/20">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-foreground truncate">
                            {scopedActiveDecisionEntry.name}
                          </div>
                          <div className="text-[10.5px] font-mono text-muted truncate">
                            {scopedActiveDecisionEntry.scope === 'global'
                              ? `a8-agent-mind / ${scopedActiveDecisionEntry.rel_path}`
                              : `${scopedActiveDecisionEntry.repo} / ${scopedActiveDecisionEntry.rel_path}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isDecisionDirty ? (
                            <span className="text-[10.5px] text-amber-600 dark:text-amber-400 px-1">未保存</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 px-1">
                              <Check className="w-3 h-3" />
                              已同步
                            </span>
                          )}

                          <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                            <button
                              onClick={() => setDecisionMode('structured')}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                                decisionMode === 'structured'
                                  ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                                  : 'text-muted hover:text-foreground'
                              }`}
                            >
                              <Eye className="w-3 h-3" />
                              <span>结构</span>
                            </button>
                            <button
                              onClick={() => setDecisionMode('raw')}
                              disabled={!scopedActiveDecisionEntry.editable}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors disabled:opacity-45 ${
                                decisionMode === 'raw'
                                  ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                                  : 'text-muted hover:text-foreground'
                              }`}
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>JSON</span>
                            </button>
                          </div>

                          {scopedActiveDecisionEntry.editable && !scopedActiveDecisionEntry.parse_error && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2.5 rounded-lg text-[11px]"
                              onPress={() => handleToggleDecisionEnabled(scopedActiveDecisionEntry)}
                            >
                              {scopedActiveDecisionEntry.enabled ? '退役' : '恢复'}
                            </Button>
                          )}

                          {canDeleteSelectedDecision && selectedDecisionKey && (
                            <InlineDeleteButton
                              confirming={confirmDeleteDecision}
                              deleting={deletingFile}
                              onRequest={() => setConfirmDeleteDecision(true)}
                              onCancel={() => setConfirmDeleteDecision(false)}
                              onConfirm={() =>
                                executeDeleteFile(
                                  selectedDecisionKey.relPath,
                                  'decision',
                                  selectedDecisionKey.repoCode
                                )
                              }
                            />
                          )}

                          <Button
                            size="sm"
                            variant="primary"
                            isPending={savingDecision}
                            isDisabled={
                              (!isDecisionDirty && !savingDecision) || !scopedActiveDecisionEntry.editable
                            }
                            className="h-7 px-3 rounded-lg text-[11px]"
                            onPress={handleSaveCurrentDecision}
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>保存</span>
                          </Button>
                        </div>
                      </div>

                      <div className="p-4 flex-1">
                        {loadingDecision ? (
                          <div className="py-12 text-center text-[11.5px] text-muted">正在加载...</div>
                        ) : decisionMode === 'raw' ? (
                          <textarea
                            value={decisionEditorContent}
                            onChange={(e) => setDecisionEditorContent(e.target.value)}
                            spellCheck={false}
                            className="w-full min-h-[460px] font-mono text-[12px] text-foreground dark:text-slate-100 bg-transparent focus:outline-none resize-y leading-relaxed"
                          />
                        ) : (
                          <div className="flex flex-col gap-3 text-[12px]">
                            {scopedActiveDecisionEntry.parse_error && (
                              <div className="rounded-xl bg-rose-500/8 border border-rose-500/25 px-3 py-2 text-[11.5px] text-rose-600 dark:text-rose-400">
                                解析错误：{scopedActiveDecisionEntry.parse_error}
                              </div>
                            )}

                            {!scopedActiveDecisionEntry.enabled && (
                              <div className="rounded-xl bg-zinc-100/90 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                                <span className="text-muted">
                                  已退役{scopedActiveDecisionEntry.retired_at ? ` (${scopedActiveDecisionEntry.retired_at})` : ''}
                                  {scopedActiveDecisionEntry.retired_reason ? ` · ${scopedActiveDecisionEntry.retired_reason}` : ''}
                                </span>
                                {scopedActiveDecisionEntry.editable && (
                                  <button
                                    onClick={() => handleToggleDecisionEnabled(scopedActiveDecisionEntry)}
                                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                  >
                                    恢复启用
                                  </button>
                                )}
                              </div>
                            )}

                            {isDecisionCleanupCandidate(scopedActiveDecisionEntry) && (
                              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                  <div className="text-amber-900 dark:text-amber-200 leading-snug">
                                    <span className="font-semibold">长期零违规 · 建议删除：</span>
                                    <span>
                                      该 Decision 累计已评估 {scopedActiveDecisionEntry.eval_count ?? 0} 次且 0 次违规，说明约束已被稳定内化，删除可节省大模型评审配额。
                                    </span>
                                  </div>
                                </div>
                                {canDeleteSelectedDecision && selectedDecisionKey && (
                                  <div className="shrink-0">
                                    <InlineDeleteButton
                                      confirming={confirmDeleteDecision}
                                      deleting={deletingFile}
                                      onRequest={() => setConfirmDeleteDecision(true)}
                                      onCancel={() => setConfirmDeleteDecision(false)}
                                      onConfirm={() =>
                                        executeDeleteFile(
                                          selectedDecisionKey.relPath,
                                          'decision',
                                          selectedDecisionKey.repoCode
                                        )
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 px-3 py-2 bg-zinc-50/40 dark:bg-surface-secondary/15 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span className="font-mono text-muted">
                                累计评估 {scopedActiveDecisionEntry.eval_count ?? 0} 次 · 累计拦截 {scopedActiveDecisionEntry.hit_count ?? 0} 次
                              </span>
                              <span className="font-mono text-muted">
                                {scopedActiveDecisionEntry.last_hit_ts
                                  ? `最近拦截 ${formatReviewTime('', scopedActiveDecisionEntry.last_hit_ts)}`
                                  : scopedActiveDecisionEntry.last_eval_ts
                                    ? `最近评估 ${formatReviewTime('', scopedActiveDecisionEntry.last_eval_ts)}`
                                    : '暂无评估记录'}
                              </span>
                            </div>

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3 bg-zinc-50/50 dark:bg-surface-secondary/20">
                              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted mb-1">
                                触发与范围 (Triggers & File Patterns)
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {scopedActiveDecisionEntry.triggers.map((t) => (
                                  <span
                                    key={t}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white dark:bg-surface border border-zinc-200/80 dark:border-border/70 text-foreground"
                                  >
                                    trigger: {t}
                                  </span>
                                ))}
                                {scopedActiveDecisionEntry.file_patterns.length === 0 ? (
                                  <span className="text-[11px] text-muted">匹配全部路径</span>
                                ) : (
                                  scopedActiveDecisionEntry.file_patterns.map((fp) => (
                                    <span
                                      key={fp}
                                      className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-400"
                                    >
                                      path: {fp}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>

                            {scopedActiveDecisionEntry.why && (
                              <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3">
                                <div className="text-[10.5px] font-semibold text-muted mb-1">
                                  工程根因 (Why)
                                </div>
                                <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {scopedActiveDecisionEntry.why}
                                </p>
                              </div>
                            )}

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3">
                              <div className="text-[10.5px] font-semibold text-muted mb-1">
                                裁决指令 (Instructions)
                              </div>
                              <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                                {scopedActiveDecisionEntry.instructions || '-'}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                                <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                                  通过判据 (PASSED)
                                </div>
                                <p className="text-[11.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {scopedActiveDecisionEntry.passed_criteria || '-'}
                                </p>
                              </div>
                              <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
                                <div className="text-[10.5px] font-semibold text-rose-700 dark:text-rose-400 mb-1">
                                  拦截判据 (VIOLATED)
                                </div>
                                <p className="text-[11.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {scopedActiveDecisionEntry.violated_criteria || '-'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 3: Lint 检查 (scripts/lints/*.py / *.mjs 确定性脚本浏览)     */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'lints' && (
            <div className="flex flex-col">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] font-medium text-foreground">
                  项目确定性结构检查 ({filteredLints.length} 项 · scripts/lints/*.py / *.mjs)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {(selectedLint?.repo || filteredLints[0]?.repo) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isPending={runningLintRepo === (selectedLint?.repo || filteredLints[0]?.repo)}
                      isDisabled={Boolean(runningLintRepo)}
                      className="h-7 px-2.5 rounded-lg text-[11px]"
                      onPress={() => {
                        const targetRepo = selectedLint?.repo || filteredLints[0]?.repo;
                        if (targetRepo) void handleRunRepoLints(targetRepo);
                      }}
                    >
                      <Play className="w-3 h-3" />
                      <span>
                        运行 {selectedLint?.repo || filteredLints[0]?.repo} 检测
                      </span>
                    </Button>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                    <Lock className="w-3 h-3" />
                    源码只读展示（零误报机械防线，可安全删除独立过期检查）
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
                <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-zinc-200/80 dark:border-border/60 divide-y divide-zinc-200/70 dark:divide-border/50">
                  {filteredLints.length === 0 ? (
                    <div className="py-16 px-4 text-center text-[11.5px] text-muted">
                      {govScope === 'global'
                        ? '全局层面不运行单仓静态扫描；请在右上角「作用域」下拉中选择具体项目查看 scripts/lints/'
                        : `${govScope} 暂无 Lint 检查项 (scripts/lints/*.py / *.mjs)`}
                    </div>
                  ) : (
                    filteredLints.map((lint) => {
                      const active =
                        selectedLint?.id === lint.id &&
                        selectedLint?.repo === lint.repo &&
                        selectedLint?.rel_path === lint.rel_path;
                      const displayName =
                        lint.name.endsWith('.mjs') || lint.name.endsWith('.py') ? lint.name : `${lint.name}()`;
                      return (
                        <div
                          key={`${lint.repo}::${lint.rel_path}::${lint.id}`}
                          onClick={() => loadLintSourceDirect(lint)}
                          className={`px-4 py-3 cursor-pointer transition-colors ${
                            active
                              ? 'bg-zinc-50 dark:bg-surface-secondary/60'
                              : 'hover:bg-zinc-50/60 dark:hover:bg-surface-secondary/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-mono font-semibold text-foreground truncate">
                              {displayName}
                            </span>
                            <span className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-muted shrink-0">
                              {lint.repo}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10.5px] font-mono text-muted">
                              {lint.id} · {lint.rel_path}:{lint.line_number}
                            </span>
                            <span
                              className={`text-[9.5px] font-mono px-1.5 py-[1px] rounded border ${
                                (lint.hit_count ?? 0) > 0
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25'
                                  : 'bg-zinc-50 dark:bg-surface border-zinc-200/80 dark:border-border/60 text-muted'
                              }`}
                            >
                              检测 {lint.eval_count ?? 0} · 拦截 {lint.hit_count ?? 0}
                            </span>
                            {isLintCleanupCandidate(lint) && (
                              <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                                0 违规 · 待评估清理
                              </span>
                            )}
                          </div>
                          {lint.description && (
                            <p className="mt-1.5 text-[11.5px] text-muted leading-relaxed">
                              {lint.description}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="lg:col-span-7 flex flex-col">
                  {!selectedLint || filteredLints.length === 0 ? (
                    <div className="py-20 text-center text-[11.5px] text-muted">
                      {filteredLints.length === 0
                        ? '当前作用域暂无 Lint 脚本可浏览'
                        : '从左侧选择一条 Lint 检查项查看脚本源码'}
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2.5 border-b border-zinc-200/80 dark:border-border/60 bg-zinc-50/40 dark:bg-surface-secondary/20 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] font-mono text-foreground truncate">
                          {selectedLint.repo} / {selectedLint.rel_path}#L{selectedLint.line_number}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10.5px] font-mono text-muted">
                            检测 {selectedLint.eval_count ?? 0} · 拦截 {selectedLint.hit_count ?? 0}
                          </span>
                          <span className="text-[10.5px] font-mono text-muted">
                            {selectedLint.rel_path.toLowerCase().endsWith('.mjs') ? 'Node.js Read-Only' : 'Python Read-Only'}
                          </span>
                          {selectedLint.deletable && (
                            <InlineDeleteButton
                              confirming={confirmDeleteLint}
                              deleting={deletingFile}
                              onRequest={() => setConfirmDeleteLint(true)}
                              onCancel={() => setConfirmDeleteLint(false)}
                              onConfirm={() =>
                                executeDeleteFile(
                                  selectedLint.rel_path,
                                  'lint',
                                  selectedLint.scope === 'global' ? '' : selectedLint.repo
                                )
                              }
                            />
                          )}
                        </div>
                      </div>
                      {isLintCleanupCandidate(selectedLint) && (
                        <div className="mx-4 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="text-amber-900 dark:text-amber-200 leading-snug">
                              <span className="font-semibold">长期零违规 · 评估是否清理：</span>
                              <span>
                                已检测 {selectedLint.eval_count ?? 0} 次且 0 次违规。若属于临时迁移防线可移除；若属于长期架构防复发锁则代表防线健康，可继续保留。
                                {!selectedLint.deletable &&
                                  (selectedLint.editable === false
                                    ? '（当前为只读测试靶场，禁止删除）'
                                    : `（位于聚合脚本 ${selectedLint.file_name}#L${selectedLint.line_number}，需在源码中移除对应函数，禁止删除整文件）`)}
                              </span>
                            </div>
                          </div>
                          {selectedLint.deletable && (
                            <div className="shrink-0">
                              <InlineDeleteButton
                                confirming={confirmDeleteLint}
                                deleting={deletingFile}
                                onRequest={() => setConfirmDeleteLint(true)}
                                onCancel={() => setConfirmDeleteLint(false)}
                                onConfirm={() =>
                                  executeDeleteFile(
                                    selectedLint.rel_path,
                                    'lint',
                                    selectedLint.scope === 'global' ? '' : selectedLint.repo
                                  )
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="p-4 flex-1 overflow-auto max-h-[560px]">
                        {loadingLintSource ? (
                          <div className="py-12 text-center text-[11.5px] text-muted">正在加载源码...</div>
                        ) : (
                          <pre className="font-mono text-[11.5px] leading-relaxed text-foreground dark:text-slate-200 whitespace-pre-wrap break-words">
                            {lintSourceText || '# 暂无源码内容'}
                          </pre>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          </section>
        </>
      )}

      {/* ================================================================= */}
      {/* Tab 2: 终审记录 (映射页同款 rounded-2xl 列表卡 <-> 原位全宽阅读卡) */}
      {/* ================================================================= */}
      {subTab === 'reviews' && (
        <>
          {activeReviewView === 'list' && (
            <div className="flex flex-col gap-3">
              <PortalHero
                icon={<FileCheck2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                eyebrow="DEEPSEEK HARNESS · REVIEW"
                title="DSH 架构终审与因果链闭环归档"
                description="聚合本机 DeepSeek Harness 对跨模块改动、状态机与并发边界的深度终审报告，支持按仓库和裁决状态快速追踪复核记录。"
                metrics={[
                  { label: '归档总数', value: reviewStats.total },
                  { label: '通过 PASSED', value: reviewStats.passed, tone: 'emerald' },
                  {
                    label: '拦截 VIOLATED',
                    value: reviewStats.violated,
                    tone: reviewStats.violated > 0 ? 'rose' : 'default',
                  },
                  { label: '覆盖仓库', value: availableReviewRepos.length, tone: 'blue' },
                ]}
              />

              <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[12.5px] font-semibold text-foreground">DSH 终审归档</h2>
                  <span className="text-[10.5px] font-mono text-muted">
                    {reviewStats.total} 份 · {reviewStats.passed} 通过 · {reviewStats.violated} 拦截
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={activeReviewRepo}
                    onChange={(e) => setReviewFilterRepo(e.target.value)}
                    aria-label="按仓库筛选"
                    className="h-7 px-2 rounded-lg border border-zinc-200/90 dark:border-border/70 bg-white dark:bg-surface-secondary text-[11px] text-foreground outline-none focus:border-zinc-400 cursor-pointer"
                  >
                    <option value="ALL">全部项目 ({allReviews.length})</option>
                    {availableReviewRepos.map((item) => (
                      <option key={item.repo} value={item.repo}>
                        {item.repo} ({item.count})
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-0.5 text-[11px]">
                    {(
                      [
                        { id: 'ALL', label: '全部' },
                        { id: 'PASSED', label: '通过' },
                        { id: 'VIOLATED', label: '拦截' },
                        { id: 'REQUIRES_APPROVAL', label: '待拍板' },
                      ] as const
                    ).map((item) => {
                      const active = reviewFilterVerdict === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setReviewFilterVerdict(item.id)}
                          className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative flex items-center w-48">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 pointer-events-none" />
                    <input
                      value={reviewSearch}
                      onChange={(e) => setReviewSearch(e.target.value)}
                      placeholder="搜索标题或摘要..."
                      className="w-full h-7 pl-8 pr-2.5 rounded-lg bg-surface-secondary/60 focus:bg-white dark:focus:bg-surface border border-zinc-200/85 dark:border-border/70 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400"
                    />
                  </div>

                  <button
                    onClick={openSpecDetail}
                    className="text-[11px] text-muted hover:text-foreground px-1.5 py-1 rounded-md hover:bg-zinc-100/80 dark:hover:bg-surface-secondary transition-colors cursor-pointer whitespace-nowrap"
                  >
                    查看规约 →
                  </button>
                </div>
              </div>

              <div className="divide-y divide-zinc-200/70 dark:divide-border/50">
                {filteredReviews.map((rv) => {
                  const meta = VERDICT_META[rv.verdict] || {
                    label: rv.verdict,
                    shortLabel: rv.verdict,
                    dotClass: 'bg-zinc-400',
                    textClass: 'text-muted',
                  };
                  return (
                    <button
                      key={rv.rel_path}
                      onClick={() => openReviewDetail(rv)}
                      className="w-full text-left px-4 py-3 hover:bg-zinc-50/75 dark:hover:bg-surface-secondary/40 transition-colors cursor-pointer flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 ${meta.textClass}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                            {meta.shortLabel}
                          </span>
                          <span className="text-[13px] font-semibold text-foreground truncate">
                            {rv.title}
                          </span>
                        </div>
                        <span className="text-[10.5px] font-mono text-muted shrink-0">
                          {rv.repo} · R{rv.round}
                        </span>
                      </div>

                      <p className="text-[11.5px] text-muted leading-snug line-clamp-1">{rv.summary}</p>

                      <div className="flex items-center gap-3 text-[10px] font-mono text-muted/85 pt-0.5">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatReviewTime(rv.timestamp, rv.modified_ts)}
                        </span>
                        {rv.duration_sec > 0 && <span>{rv.duration_sec.toFixed(1)}s</span>}
                        <span className="truncate">{rv.rel_path}</span>
                      </div>
                    </button>
                  );
                })}

                {filteredReviews.length === 0 && (
                  <div className="py-16 text-center flex flex-col items-center gap-2 text-muted">
                    <History className="w-6 h-6 opacity-35" />
                    <span className="text-[12px]">暂无匹配的 DSH 终审归档记录</span>
                    <span className="text-[10.5px]">执行 /a8-dsh-review 后归档结果将自动呈现在此</span>
                  </div>
                )}
              </div>
              </section>
            </div>
          )}

          {activeReviewView === 'detail' && openedReview && (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setActiveReviewView('list');
                    setConfirmDeleteReview(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回终审记录</span>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                    <button
                      onClick={() => setReviewSourceMode('rendered')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        reviewSourceMode === 'rendered'
                          ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      阅读
                    </button>
                    <button
                      onClick={() => setReviewSourceMode('raw')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        reviewSourceMode === 'raw'
                          ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      源文件
                    </button>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 rounded-lg text-[11px]"
                    onPress={() => {
                      navigator.clipboard.writeText(displayedReviewBody);
                      pushToast(
                        reviewSourceMode === 'raw' ? '已复制原始归档文件内容' : '已复制终审报告正文',
                        'success'
                      );
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制</span>
                  </Button>

                  <InlineDeleteButton
                    confirming={confirmDeleteReview}
                    deleting={deletingFile}
                    onRequest={() => setConfirmDeleteReview(true)}
                    onCancel={() => setConfirmDeleteReview(false)}
                    onConfirm={() => executeDeleteFile(openedReview.rel_path, 'review')}
                  />
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="pb-3.5 mb-4 border-b border-zinc-200/75 dark:border-border/60">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-[16px] font-semibold text-foreground">{openedReview.title}</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-medium ${
                        (VERDICT_META[openedReview.verdict] || { textClass: 'text-muted' }).textClass
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          (VERDICT_META[openedReview.verdict] || { dotClass: 'bg-zinc-400' }).dotClass
                        }`}
                      />
                      {openedReview.verdict}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] font-mono text-muted">
                    <span>{openedReview.repo}</span>
                    <span>·</span>
                    <span>Round {openedReview.round}</span>
                    <span>·</span>
                    <span>{formatReviewTime(openedReview.timestamp, openedReview.modified_ts)}</span>
                    {openedReview.duration_sec > 0 && (
                      <>
                        <span>·</span>
                        <span>{openedReview.duration_sec.toFixed(1)}s</span>
                      </>
                    )}
                    {openedReview.session_id && (
                      <>
                        <span>·</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(openedReview.session_id);
                            pushToast('已复制 Session ID', 'success');
                          }}
                          className="hover:text-foreground underline decoration-dotted cursor-pointer"
                        >
                          Session {openedReview.session_id.slice(0, 12)}...
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {loadingReviewBody ? (
                  <div className="py-12 text-center text-[11.5px] text-muted">正在加载终审报告...</div>
                ) : reviewSourceMode === 'raw' ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
                    {displayedReviewBody || '（空报告）'}
                  </pre>
                ) : (
                  <MarkdownArticle content={displayedReviewBody || '（空报告）'} />
                )}
              </div>
            </section>
          )}

          {activeReviewView === 'spec' && (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex items-center justify-between gap-2">
                <button
                  onClick={() => setActiveReviewView('list')}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回终审记录</span>
                </button>
                <span className="font-mono text-[11px] text-muted">skills/a8-dsh-review/SKILL.md</span>
              </div>

              <div className="px-5 py-4">
                {loadingSpec ? (
                  <div className="py-12 text-center text-[11.5px] text-muted">正在加载规约文档...</div>
                ) : (
                  <MarkdownArticle content={stripReviewFrontmatter(specContent)} />
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* Tab 3: 每日提案 (Grok AI 工作流提升提案列表 <-> 阅读 & 一键回到 Antigravity 推进) */}
      {/* ================================================================= */}
      {subTab === 'proposals' && (
        <>
          {!openedProposal ? (
            <div className="flex flex-col gap-3">
              <PortalHero
                icon={<Sparkles className="w-4 h-4 text-amber-500" />}
                eyebrow="GROK · WORKFLOW PROPOSALS"
                title="每日工作流演进提案工作台"
                description="沉淀每日深度复盘产出的架构与体验改进提案，支持全文批注、采纳状态流转并一键拉起 Antigravity 会话持续推进。"
                metrics={[
                  { label: '提案总数', value: proposalStats.total },
                  {
                    label: '待推进',
                    value: proposalStats.pendingOnly,
                    tone: proposalStats.pendingOnly > 0 ? 'amber' : 'default',
                  },
                  { label: '推进中', value: proposalStats.inProgress, tone: 'blue' },
                  { label: '已采纳', value: proposalStats.adopted, tone: 'emerald' },
                ]}
              />

              <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[12.5px] font-semibold text-foreground">每日 Grok AI 提升提案</h2>
                  <span className="text-[10.5px] font-mono text-muted">
                    {proposalStats.total} 份 · {proposalStats.pending} 待推进 · {proposalStats.adopted} 已采纳
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-0.5 text-[11px]">
                    {(
                      [
                        { id: 'ALL', label: '全部' },
                        { id: 'pending', label: '待推进' },
                        { id: 'in_progress', label: '推进中' },
                        { id: 'adopted', label: '已采纳' },
                        { id: 'dismissed', label: '暂不采纳' },
                      ] as const
                    ).map((item) => {
                      const active = proposalFilterStatus === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setProposalFilterStatus(item.id)}
                          className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative flex items-center w-48">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 pointer-events-none" />
                    <input
                      value={proposalSearch}
                      onChange={(e) => setProposalSearch(e.target.value)}
                      placeholder="搜索日期、标题或摘要..."
                      className="w-full h-7 pl-8 pr-2.5 rounded-lg bg-surface-secondary/60 focus:bg-white dark:focus:bg-surface border border-zinc-200/85 dark:border-border/70 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400"
                    />
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 rounded-lg text-[11px]"
                    onPress={async () => {
                      try {
                        await callTauri('open_grok_proposals_dir');
                      } catch (e: any) {
                        pushToast(`打开提案目录失败: ${e}`, 'danger');
                      }
                    }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>提案目录</span>
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-zinc-200/70 dark:divide-border/50">
                {filteredProposals.map((p) => {
                  const meta = PROPOSAL_STATUS_META[p.status] || {
                    shortLabel: p.status || '待推进',
                    dotClass: 'bg-zinc-400',
                    textClass: 'text-muted',
                  };
                  const isAdvancing = advancingProposalName === p.file_name;
                  const savedAnnCount = loadProposalReview(p.file_name).annotations.length;
                  return (
                    <div
                      key={p.file_name}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProposalDetail(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openProposalDetail(p);
                        }
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-zinc-50/75 dark:hover:bg-surface-secondary/40 transition-colors cursor-pointer flex items-start justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 ${meta.textClass}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                            {meta.shortLabel}
                          </span>
                          <span className="text-[13px] font-semibold text-foreground truncate">
                            {p.title}
                          </span>
                        </div>

                        <p className="text-[11.5px] text-muted leading-snug line-clamp-1">{p.summary}</p>

                        <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-mono text-muted/85 pt-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {p.date || formatReviewTime('', p.modified_ts)}
                          </span>
                          {p.proposal_count > 0 && <span>{p.proposal_count} 项建议</span>}
                          {savedAnnCount > 0 && (
                            <span className="px-1.5 py-0 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 font-sans">
                              {savedAnnCount} 条划词批注
                            </span>
                          )}
                          {p.source_subject && <span className="truncate max-w-[320px]">来源: {p.source_subject}</span>}
                          <span className="truncate">logs/grok-proposals/{p.file_name}</span>
                        </div>
                      </div>

                      <div
                        className="shrink-0 flex items-center gap-1.5 pt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          isPending={isAdvancing}
                          className="h-7 px-2.5 rounded-lg text-[11px]"
                          onPress={() => handleAdvanceInAntigravity(p)}
                        >
                          <Send className="w-3 h-3" />
                          <span>回到 Antigravity 推进</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {filteredProposals.length === 0 && (
                  <div className="py-16 text-center flex flex-col items-center gap-2 text-muted">
                    <Sparkles className="w-6 h-6 opacity-35" />
                    <span className="text-[12px]">暂无每日 Grok AI 提升提案</span>
                    <span className="text-[10.5px] font-mono">
                      {overview?.proposals_dir || 'E:\\a8-devtools\\logs\\grok-proposals\\<YYYY-MM-DD>.md'}
                    </span>
                  </div>
                )}
              </div>
              </section>
            </div>
          ) : (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setOpenedProposal(null);
                    setConfirmDeleteProposal(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回每日提案</span>
                </button>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                    <button
                      onClick={() => setProposalSourceMode('rendered')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        proposalSourceMode === 'rendered'
                          ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      阅读
                    </button>
                    <button
                      onClick={() => setProposalSourceMode('raw')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        proposalSourceMode === 'raw'
                          ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      源文件
                    </button>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 rounded-lg text-[11px]"
                    onPress={() => {
                      navigator.clipboard.writeText(displayedProposalBody);
                      pushToast(
                        proposalSourceMode === 'raw' ? '已复制原始提案文件内容' : '已复制提案正文',
                        'success'
                      );
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制</span>
                  </Button>

                  <div className="inline-flex items-center rounded-lg border border-zinc-200/85 dark:border-border/70 p-0.5 bg-surface-secondary/50 text-[11px]">
                    {(
                      [
                        { id: 'pending', label: '待推进' },
                        { id: 'in_progress', label: '推进中' },
                        { id: 'adopted', label: '已采纳' },
                        { id: 'dismissed', label: '暂不采纳' },
                      ] as const
                    ).map((st) => {
                      const active = openedProposal.status === st.id;
                      const busy = updatingProposalStatus === openedProposal.file_name;
                      return (
                        <button
                          key={st.id}
                          disabled={busy}
                          onClick={() => handleUpdateProposalStatus(openedProposal.file_name, st.id)}
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'bg-white dark:bg-surface font-semibold text-foreground shadow-2xs'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          {st.label}
                        </button>
                      );
                    })}
                  </div>

                  <InlineDeleteButton
                    confirming={confirmDeleteProposal}
                    deleting={deletingFile}
                    onRequest={() => setConfirmDeleteProposal(true)}
                    onCancel={() => setConfirmDeleteProposal(false)}
                    onConfirm={() => executeDeleteProposal(openedProposal.file_name)}
                  />

                  <Button
                    size="sm"
                    variant="primary"
                    isPending={advancingProposalName === openedProposal.file_name}
                    className="h-7 px-3 rounded-lg text-[11px]"
                    onPress={() => handleAdvanceInAntigravity(openedProposal)}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>回到 Antigravity 推进</span>
                  </Button>
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="pb-3.5 mb-4 border-b border-zinc-200/75 dark:border-border/60">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-[16px] font-semibold text-foreground">{openedProposal.title}</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-medium ${
                        (PROPOSAL_STATUS_META[openedProposal.status] || { textClass: 'text-muted' }).textClass
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          (PROPOSAL_STATUS_META[openedProposal.status] || { dotClass: 'bg-zinc-400' }).dotClass
                        }`}
                      />
                      {(PROPOSAL_STATUS_META[openedProposal.status] || { shortLabel: openedProposal.status }).shortLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] font-mono text-muted">
                    <span>{openedProposal.date || formatReviewTime('', openedProposal.modified_ts)}</span>
                    {openedProposal.proposal_count > 0 && (
                      <>
                        <span>·</span>
                        <span>{openedProposal.proposal_count} 项提案</span>
                      </>
                    )}
                    {openedProposal.source_subject && (
                      <>
                        <span>·</span>
                        <span>邮件: {openedProposal.source_subject}</span>
                      </>
                    )}
                    <span>·</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(openedProposal.abs_path);
                        pushToast('已复制提案文件路径', 'success');
                      }}
                      className="hover:text-foreground underline decoration-dotted cursor-pointer"
                    >
                      {openedProposal.abs_path}
                    </button>
                  </div>
                </div>

                {loadingProposalBody ? (
                  <div className="py-12 text-center text-[11.5px] text-muted">正在加载提案正文...</div>
                ) : proposalSourceMode === 'raw' ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
                    {displayedProposalBody || '（空提案）'}
                  </pre>
                ) : (
                  <ProposalDetailAnnotator
                    fileName={openedProposal.file_name}
                    title={openedProposal.title}
                    absPath={openedProposal.abs_path}
                    annotations={proposalAnnotations}
                    overallNote={proposalOverallNote}
                    onChangeAnnotations={handleUpdateProposalAnnotations}
                    onChangeOverallNote={handleUpdateProposalOverallNote}
                    onAdvanceWithAnnotations={() => handleAdvanceInAntigravity(openedProposal)}
                    advancing={advancingProposalName === openedProposal.file_name}
                    pushToast={pushToast}
                  >
                    <MarkdownArticle
                      content={displayedProposalBody || '（空提案）'}
                      annotations={proposalAnnotations}
                    />
                  </ProposalDetailAnnotator>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* Tab 4: Harness 可观测与自改进闭环 (ECharts 数据可视化 + 事件明细流) */}
      {/* ================================================================= */}
      {subTab === 'observability' && (
        <div className="flex flex-col gap-3">
          {/* 1. 核心指标 + 防线裁决环图 + 近 14 日趋势 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* Left (4 cols): Harness KPI 概览 */}
            <div className="lg:col-span-4 p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                    <Activity className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Harness 运行健康度</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-[28px] leading-none font-bold font-mono tracking-tight text-foreground">
                      {telemetryComputed.totalEvents}
                    </span>
                    <span className="text-[11px] text-muted">次门禁/裁决事件</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-surface-secondary/80 border border-zinc-200/80 dark:border-border/70 font-mono text-[10px] text-muted">
                  阈值 {(telemetry?.threshold ?? 0.85).toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl bg-surface-secondary/50 border border-zinc-200/70 dark:border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted">平均裁决置信度</div>
                  <div className="mt-0.5 text-[15px] font-semibold font-mono text-foreground">
                    {telemetry?.avg_confidence ? telemetry.avg_confidence.toFixed(3) : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-surface-secondary/50 border border-zinc-200/70 dark:border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted">文档 / Lint 门禁唤醒</div>
                  <div className="mt-0.5 text-[15px] font-semibold font-mono text-foreground">
                    {(telemetry?.docs_gate_triggered || 0) + (telemetry?.auto_lint_triggered || 0)}
                    <span className="ml-1.5 text-[10px] font-normal text-muted">
                      ({telemetry?.docs_gate_triggered || 0} 文档 / {telemetry?.auto_lint_triggered || 0} Lint)
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-secondary/50 border border-zinc-200/70 dark:border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted">DSH 终审一次通过率</div>
                  <div className="mt-0.5 text-[15px] font-semibold font-mono text-foreground">
                    {telemetryComputed.totalReviews > 0 ? `${telemetryComputed.dshPassRate}%` : '—'}
                    <span className="ml-1.5 text-[10px] font-normal text-muted">
                      {telemetryComputed.passedReviews}/{telemetryComputed.totalReviews}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-secondary/50 border border-zinc-200/70 dark:border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted">Grok 提案采纳率</div>
                  <div className="mt-0.5 text-[15px] font-semibold font-mono text-foreground">
                    {proposalStats.total > 0 ? `${telemetryComputed.proposalAdoptRate}%` : '—'}
                    <span className="ml-1.5 text-[10px] font-normal text-muted">
                      {proposalStats.adopted}/{proposalStats.total} 份
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Middle (3 cols): ECharts Donut */}
            <div className="lg:col-span-3 p-4 border-t lg:border-t-0 lg:border-l border-zinc-200/80 dark:border-border/70 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-foreground">防线裁决分布</h3>
                <span className="text-[10px] font-mono text-muted">
                  Hook {telemetry?.stop_hook_events || 0} · Judge {telemetry?.judge_events || 0}
                </span>
              </div>

              <div className="relative h-[138px] w-full my-1">
                <EChartBox option={verdictDonutOption} className="w-full h-full" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[18px] font-bold font-mono text-foreground leading-none">
                    {telemetryComputed.gateWokeTotal}
                  </span>
                  <span className="mt-1 text-[9.5px] text-muted">唤醒 / 拦截</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  放行 {telemetryComputed.passCount}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  文档/确认 {telemetryComputed.docsAskCount}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  自动沉淀 {telemetryComputed.autoLearnCount}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  违规/异常 {telemetryComputed.alertCount}
                </span>
              </div>
            </div>

            {/* Right (5 cols): 14-day Stacked Trend */}
            <div className="lg:col-span-5 p-4 border-t lg:border-t-0 lg:border-l border-zinc-200/80 dark:border-border/70 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[12px] font-semibold text-foreground">近 14 日 Harness 门禁趋势</h3>
                <span className="text-[10px] font-mono text-muted">UTC+8 日维度</span>
              </div>
              <div className="h-[178px] w-full">
                <EChartBox option={trendBarOption} className="w-full h-full" />
              </div>
            </div>
          </section>

          {/* 2. 第二行：置信度校准 + Grok 提案采纳闭环漏斗 */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[12.5px] font-semibold text-foreground">Decisions API 置信度校准分布</h3>
                  <p className="text-[10.5px] text-muted mt-0.5">
                    低于阈值 ({(telemetry?.threshold ?? 0.85).toFixed(2)}) 的事件会收敛为谨慎提醒或转人工确认
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted shrink-0">
                  <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                    Rule {govSummary?.rule_files_count ?? governanceRules.length}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                    Decision {govSummary?.decisions_count ?? allDecisions.length}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                    Lint {govSummary?.lints_count ?? allLints.length}
                  </span>
                </div>
              </div>
              <div className="h-[170px] w-full">
                <EChartBox option={confidenceBarOption} className="w-full h-full" />
              </div>
            </div>

            <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[12.5px] font-semibold text-foreground">每日 Grok AI 提案采纳闭环</h3>
                  <p className="text-[10.5px] text-muted mt-0.5">
                    从唤醒 Antigravity 自动升为「推进中」，直到标记已采纳或暂不采纳
                  </p>
                </div>
                <button
                  onClick={() => setSubTab('proposals')}
                  className="px-2.5 py-1 rounded-lg border border-zinc-200/85 dark:border-border/70 text-[10.5px] font-medium text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer shrink-0"
                >
                  查看提案 →
                </button>
              </div>
              <div className="h-[170px] w-full">
                <EChartBox option={proposalFunnelOption} className="w-full h-full" />
              </div>
            </div>
          </section>

          {/* 2b. Decisions API Token 体积与 Diff 分块负载趋势 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[12.5px] font-semibold text-foreground">
                  Decisions API Token 与分块负载趋势
                </h3>
                <p className="text-[10.5px] text-muted mt-0.5">
                  追踪 `a8-judge` / `stop_hook` 实际送审 Token 体积与 Diff 分块数（警戒线：单次 &gt; 30k tokens 或分块 ≥ 3）
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted shrink-0">
                <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                  累计 {formatCompactTokens(telemetry?.total_tokens_evaluated)} tok
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                  单次均耗 {telemetry?.avg_judge_tokens ? `${formatCompactTokens(telemetry.avg_judge_tokens)} tok` : '—'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md border ${
                    (telemetry?.max_judge_tokens || 0) > 30000
                      ? 'bg-amber-500/12 border-amber-500/35 text-amber-700 dark:text-amber-300'
                      : 'bg-surface-secondary/70 border-zinc-200/75 dark:border-border/70'
                  }`}
                >
                  单次峰值 {telemetry?.max_judge_tokens ? `${formatCompactTokens(telemetry.max_judge_tokens)} tok` : '—'}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-secondary/70 border border-zinc-200/75 dark:border-border/70">
                  分块 {telemetry?.total_diff_chunks || 0} · 调用 {telemetry?.total_api_calls || 0}
                </span>
              </div>
            </div>
            <div className="h-[170px] w-full">
              <EChartBox option={tokenLoadOption} className="w-full h-full" />
            </div>
          </section>

          {/* 3. 第三行：最近门禁与裁决事件流 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h3 className="text-[12.5px] font-semibold text-foreground">最近门禁与裁决事件流</h3>
                <span className="text-[10.5px] font-mono text-muted truncate max-w-[380px]">
                  {telemetry?.metrics_path || 'harness_metrics.jsonl'}
                </span>
              </div>

              <div className="flex items-center gap-0.5 text-[11px]">
                {(
                  [
                    { id: 'ALL', label: '全部' },
                    { id: 'stop_hook', label: 'Stop Hook' },
                    { id: 'a8_judge', label: 'a8-judge' },
                    { id: 'repo_lint', label: 'Lint 检测' },
                    { id: 'alerts', label: '仅唤醒与告警' },
                  ] as const
                ).map((item) => {
                  const active = telemetryFilter === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setTelemetryFilter(item.id)}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        active
                          ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredTelemetryEvents.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-1.5 text-muted text-[11.5px]">
                <Activity className="w-6 h-6 opacity-35" />
                <span>暂无匹配的 Harness 遥测事件</span>
                <span className="text-[10.5px]">
                  当 `stop_reflect.py` 或 `a8-judge` 执行裁决后，会自动追加至 harness_metrics.jsonl 并在此聚合展示
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11.5px]">
                  <thead>
                    <tr className="bg-zinc-50/85 dark:bg-surface-secondary/40 border-b border-zinc-200/80 dark:border-border/60 text-[10.5px] text-muted">
                      <th className="px-4 py-2 font-medium whitespace-nowrap">时间</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">来源</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">模式</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">仓库</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">裁决 / 动作</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">置信度</th>
                      <th className="px-4 py-2 font-medium whitespace-nowrap">决策路径</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/65 dark:divide-border/50">
                    {filteredTelemetryEvents.map((ev, idx) => {
                      const v = (ev.verdict || '').toUpperCase();
                      const m = (ev.mode || '').toUpperCase();
                      const combined = `${v} ${m}`;
                      const displayVerdict =
                        ev.source === 'stop_hook' && m && m !== 'PASS'
                          ? ev.mode
                          : ev.verdict || ev.mode || '—';
                      const verdictTone =
                        combined.includes('VIOLATED') || combined.includes('ERROR')
                          ? 'text-rose-600 dark:text-rose-400'
                          : combined.includes('AUTO_LINT') || combined.includes('AUTO_DECISION')
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : combined.includes('DOCS_MAINTENANCE') ||
                            combined.includes('ASK_USER_UI') ||
                            combined.includes('REQUIRES_APPROVAL') ||
                            v === 'CONTINUE'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400';
                      const confPct = ev.confidence > 0 ? Math.min(100, Math.round(ev.confidence * 100)) : 0;
                      const detailParts = [
                        ev.docs_choice ? `docs=${ev.docs_choice}` : '',
                        ev.lesson_choice ? `lesson=${ev.lesson_choice}` : '',
                        ev.evaluated_ids && ev.evaluated_ids.length > 0
                          ? `检=${ev.evaluated_ids.length}`
                          : '',
                        ev.violated_ids && ev.violated_ids.length > 0
                          ? `违=${ev.violated_ids.slice(0, 2).join(',')}${
                              ev.violated_ids.length > 2 ? `(+${ev.violated_ids.length - 2})` : ''
                            }`
                          : '',
                        ev.tokens_evaluated && ev.tokens_evaluated > 0
                          ? `tok=${formatCompactTokens(ev.tokens_evaluated)}`
                          : '',
                        ev.diff_chunks_count && ev.diff_chunks_count > 0
                          ? `块=${ev.diff_chunks_count}`
                          : '',
                        ev.api_calls_count && ev.api_calls_count > 1
                          ? `调=${ev.api_calls_count}`
                          : '',
                      ].filter(Boolean);
                      return (
                        <tr
                          key={`${ev.ts}-${idx}`}
                          className="hover:bg-zinc-50/70 dark:hover:bg-surface-secondary/30 transition-colors"
                        >
                          <td className="px-4 py-2 font-mono text-[10.5px] text-muted whitespace-nowrap">
                            {formatReviewTime('', ev.ts)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded bg-surface-secondary/75 border border-zinc-200/75 dark:border-border/60 font-mono text-[10px] text-foreground">
                              {ev.source === 'stop_hook' ? 'Stop Hook' : ev.source || 'a8-judge'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[10.5px] text-muted whitespace-nowrap">
                            {ev.mode || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-foreground whitespace-nowrap">
                            {ev.repo || '—'}
                          </td>
                          <td className={`px-3 py-2 font-mono text-[11px] font-semibold whitespace-nowrap ${verdictTone}`}>
                            {displayVerdict}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {ev.confidence > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 rounded-full bg-zinc-200/80 dark:bg-zinc-700/70 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      ev.confidence >= (telemetry?.threshold ?? 0.85)
                                        ? 'bg-emerald-500'
                                        : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${confPct}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[10.5px] text-foreground">
                                  {ev.confidence.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono text-[10.5px] text-muted">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-[10.5px] text-muted whitespace-nowrap">
                            {detailParts.length > 0 ? detailParts.join(' · ') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3b. Decision & Lint 检查器命中追踪与退役/清理治理 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12.5px] font-semibold text-foreground">
                  检查器效能追踪 (Decision & Lint 命中排行)
                </h3>
                <span className="text-[10.5px] text-muted">
                  长期 0 违规项自动标黄提醒清理（Decision ≥ {DECISION_CLEANUP_MIN_EVAL} 次 · Lint ≥ {LINT_CLEANUP_MIN_EVAL} 次）
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCheckerPerfFilter('ALL')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    checkerPerfFilter === 'ALL'
                      ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  全部 ({checkerPerfRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCheckerPerfFilter('CLEANUP')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer inline-flex items-center gap-1 ${
                    checkerPerfFilter === 'CLEANUP'
                      ? 'bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300'
                      : cleanupSummary.items.length > 0
                        ? 'bg-amber-500/8 text-amber-700 dark:text-amber-400 hover:bg-amber-500/14'
                        : 'text-muted hover:text-foreground'
                  }`}
                >
                  <span>建议清理</span>
                  <span className="font-mono text-[10px]">({cleanupSummary.items.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCheckerPerfFilter('HIT')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    checkerPerfFilter === 'HIT'
                      ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  曾拦截 ({checkerPerfRows.filter((r) => r.hit_count > 0).length})
                </button>
              </div>
            </div>

            {checkerPerfFilteredRows.length === 0 ? (
              <div className="py-10 text-center text-[11.5px] text-muted">
                {checkerPerfFilter === 'CLEANUP'
                  ? '当前暂无达到长期零违规阈值的可清理检查器'
                  : '暂无匹配的 Decision 或 Lint 检查器'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11.5px]">
                  <thead>
                    <tr className="bg-zinc-50/85 dark:bg-surface-secondary/40 border-b border-zinc-200/80 dark:border-border/60 text-[10.5px] text-muted">
                      <th className="px-4 py-2 font-medium whitespace-nowrap">类型</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">检查器</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">归属</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">状态</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">评估 / 检测</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">拦截命中</th>
                      <th className="px-4 py-2 font-medium text-right whitespace-nowrap">治理操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/65 dark:divide-border/50">
                    {checkerPerfFilteredRows.map((row) => (
                      <tr
                        key={row.key}
                        className={`transition-colors ${
                          row.cleanupCandidate
                            ? 'bg-amber-500/4 hover:bg-amber-500/8'
                            : 'hover:bg-zinc-50/70 dark:hover:bg-surface-secondary/30'
                        }`}
                      >
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-surface-secondary/75 border border-zinc-200/75 dark:border-border/60 font-mono text-[10px] text-foreground">
                            {row.kind === 'decision' ? 'Decision' : 'Lint'}
                          </span>
                        </td>
                        <td className="px-3 py-2 max-w-[280px]">
                          <div className="text-[11.5px] font-medium text-foreground truncate">
                            {row.name}
                          </div>
                          <div className="text-[10px] font-mono text-muted truncate">{row.id}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10.5px] text-muted whitespace-nowrap">
                          {row.scopeLabel}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {row.kind === 'lint' ? (
                              <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
                                机械常驻
                              </span>
                            ) : row.enabled ? (
                              <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
                                使用中
                              </span>
                            ) : (
                              <span className="text-[10.5px] text-muted">
                                已退役{row.retired_at ? ` · ${row.retired_at}` : ''}
                              </span>
                            )}
                            {row.cleanupCandidate && (
                              <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                                {row.kind === 'decision' ? '可删除' : '待评估清理'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-foreground whitespace-nowrap">
                          {row.eval_count}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                          <span
                            className={
                              row.hit_count > 0
                                ? 'font-semibold text-amber-600 dark:text-amber-400'
                                : 'text-muted'
                            }
                          >
                            {row.hit_count}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {row.cleanupCandidate && (
                              <button
                                type="button"
                                onClick={() => navigateToChecker({ decision: row.decision, lint: row.lint })}
                                className="px-2 py-0.5 rounded-md text-[10.5px] font-medium border border-amber-500/35 bg-amber-500/12 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                              >
                                去清理 →
                              </button>
                            )}
                            {row.decision && row.decision.editable && !row.decision.parse_error ? (
                              <button
                                onClick={() => void handleToggleDecisionEnabled(row.decision!)}
                                className="px-2 py-0.5 rounded-md text-[10.5px] font-medium border border-zinc-200 dark:border-border/70 bg-white dark:bg-surface hover:bg-zinc-100 dark:hover:bg-surface-secondary text-foreground transition-colors cursor-pointer"
                              >
                                {row.enabled ? '退役' : '恢复'}
                              </button>
                            ) : row.lint ? (
                              <button
                                disabled={Boolean(runningLintRepo)}
                                onClick={() => void handleRunRepoLints(row.lint!.repo)}
                                className="px-2 py-0.5 rounded-md text-[10.5px] font-medium border border-zinc-200 dark:border-border/70 bg-white dark:bg-surface hover:bg-zinc-100 dark:hover:bg-surface-secondary text-foreground transition-colors cursor-pointer disabled:opacity-45"
                              >
                                {runningLintRepo === row.lint.repo ? '运行中...' : '运行检测'}
                              </button>
                            ) : (
                              <span className="text-[10.5px] text-muted">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 5: 仓库地图 (严格隔离：仅管理仓库拓扑与 repos/*.md 仓库档案) */}
      {/* ================================================================= */}
      {subTab === 'projects' && (
        <>
          {!activeProjectItem ? (
            <div className="flex flex-col gap-3">
              <PortalHero
                icon={<FolderGit2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                eyebrow="HOST TOPOLOGY · REPOSITORIES"
                title="宿主机仓库拓扑与双层文档总览"
                description="统一登记宿主机各仓库物理路径、角色定位与 Git 状态；点击任意仓库卡片即可直达该仓的常青文档、工作记录、暂缓/过期档案与仓库档案详情。"
                metrics={[
                  { label: '已登记仓库', value: overview?.projects.length || 0 },
                  {
                    label: 'Git 就绪',
                    value: (overview?.projects || []).filter((p) => p.has_git !== false).length,
                    tone: 'emerald',
                  },
                  {
                    label: '无 Git 告警',
                    value: (overview?.projects || []).filter((p) => p.has_git === false).length,
                    tone:
                      (overview?.projects || []).some((p) => p.has_git === false) ? 'amber' : 'default',
                  },
                  {
                    label: '治理文档',
                    value: allRepoDocs.length,
                    tone: 'blue',
                    hint: `${repoDocsStatsByRepo.glossaryTotal > 0 ? `术语 ${repoDocsStatsByRepo.glossaryTotal} · ` : ''}常青 ${repoDocsStatsByRepo.evergreenTotal} · 记录 ${repoDocsStatsByRepo.recordTotal}${
                      repoDocsStatsByRepo.deferredTotal > 0
                        ? ` · 暂缓 ${repoDocsStatsByRepo.deferredTotal}`
                        : ''
                    }`,
                  },
                ]}
              />

              {/* 全局索引 2 列 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    title: '宿主机仓库总表',
                    relPath: 'repos.md',
                    desc: '记录宿主机全量仓库物理路径、角色定位与详情索引路径',
                  },
                  {
                    title: '跨仓依赖关系',
                    relPath: 'repos/relations.md',
                    desc: '定义仓库间的服务调用、共享插件与部署耦合方向',
                  },
                ].map((item) => (
                  <button
                    key={item.relPath}
                    onClick={() => openProjectFile(item.title, item.relPath)}
                    className="text-left rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 hover:border-zinc-300 dark:hover:border-zinc-600 px-4 py-3.5 transition-colors cursor-pointer flex flex-col gap-1"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                      <span className="text-[10.5px] font-mono text-muted">{item.relPath}</span>
                    </div>
                    <p className="text-[11.5px] text-muted leading-snug">{item.desc}</p>
                  </button>
                ))}
              </div>

              {/* 已登记仓库 */}
              <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[12.5px] font-semibold text-foreground">已登记仓库</h2>
                    <span className="text-[10.5px] font-mono text-muted">{overview?.projects.length || 0}</span>
                  </div>
                  <span className="text-[11px] text-muted">点击查看仓库档案或复制物理路径</span>
                </div>

                <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(overview?.projects || []).map((proj) => {
                    const docCounts = repoDocsStatsByRepo.byRepo.get(proj.code);
                    return (
                    <div
                      key={proj.code}
                      onClick={() => openProjectCard(proj)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openProjectCard(proj);
                        }
                      }}
                      className="rounded-xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/75 hover:border-zinc-300 dark:hover:border-zinc-600 p-3.5 transition-colors cursor-pointer flex flex-col justify-between gap-2.5 min-h-[118px]"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px] font-semibold text-foreground truncate">{proj.code}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {proj.has_git === false && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[9.5px] font-medium"
                                title="未检测到 .git 仓库：Stop Hook 文档门禁与提交前代码审核将静默跳过"
                              >
                                <ShieldAlert className="w-2.5 h-2.5" />
                                无 Git
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-muted">
                              {ROLE_LABELS[proj.role] || proj.role.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted leading-relaxed line-clamp-2">{proj.summary}</p>
                      </div>

                      <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-200/60 dark:border-border/50">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {proj.readme_rel_path ? (
                              <span className="px-1.5 py-[1px] rounded bg-zinc-100 dark:bg-surface-secondary text-foreground border border-zinc-200/80 dark:border-border/70">
                                README
                              </span>
                            ) : (
                              <span className="px-1.5 py-[1px] rounded bg-zinc-50 dark:bg-surface-secondary/40 text-muted/70 border border-zinc-200/60 dark:border-border/50">
                                无 README
                              </span>
                            )}
                            {docCounts && docCounts.glossary > 0 && (
                              <span className="px-1.5 py-[1px] rounded bg-cyan-500/12 text-cyan-700 dark:text-cyan-400 border border-cyan-500/25">
                                术语表
                              </span>
                            )}
                            {docCounts && docCounts.evergreen > 0 && (
                              <span className="px-1.5 py-[1px] rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                                常青 {docCounts.evergreen}
                              </span>
                            )}
                            {docCounts && docCounts.total - docCounts.evergreen - docCounts.glossary > 0 && (
                              <span className="text-muted">
                                docs {docCounts.total - docCounts.evergreen - docCounts.glossary}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
                          <span className="truncate">{proj.physical_path}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(proj.physical_path);
                              pushToast(`已复制 ${proj.code} 物理路径`, 'success');
                            }}
                            title="复制物理路径"
                            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-surface-secondary text-muted hover:text-foreground shrink-0 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
              {/* 顶栏：左侧路径面包屑与 Git 状态，右侧 主页 -> 常青文档 -> docs 文档 三段主导航（file 模式保留编辑器工具栏） */}
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={requestExitProject}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>仓库地图</span>
                  </button>
                  <span className="text-zinc-300 dark:text-zinc-700">/</span>
                  <span className="font-mono text-[12px] font-semibold text-foreground truncate">
                    {activeProjectItem.kind === 'file'
                      ? activeProjectItem.relPath
                      : activeProjectItem.project.code}
                  </span>
                  {activeProjectItem.kind === 'repo' && (
                    <>
                      <span className="font-mono text-[10px] px-1.5 py-[1px] rounded bg-zinc-100 dark:bg-surface-secondary text-muted shrink-0">
                        {ROLE_LABELS[activeProjectItem.project.role] || activeProjectItem.project.role.toUpperCase()}
                      </span>
                      {activeProjectItem.project.has_git === false && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[10px] font-medium shrink-0"
                          title="未检测到 .git 仓库：Hook 文档门禁与代码审核对此项目静默跳过"
                        >
                          <ShieldAlert className="w-3 h-3" />
                          无 Git
                        </span>
                      )}
                    </>
                  )}
                  {activeProjectItem.kind === 'file' &&
                    projectDocPath &&
                    (isProjectDirty ? (
                      <span className="text-[10.5px] text-amber-600 dark:text-amber-400 shrink-0">未保存</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Check className="w-3 h-3" />
                        已同步
                      </span>
                    ))}
                </div>

                {activeProjectItem.kind === 'repo' ? (
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11.5px]">
                      {(
                        [
                          { id: 'home' as const, label: '主页' },
                          {
                            id: 'evergreen' as const,
                            label: '常青文档',
                            count:
                              (repoDocsStatsByRepo.byRepo.get(activeProjectItem.project.code)?.evergreen || 0) +
                              (repoDocsStatsByRepo.byRepo.get(activeProjectItem.project.code)?.glossary || 0),
                          },
                          {
                            id: 'docs' as const,
                            label: 'docs 文档',
                            count:
                              (repoDocsStatsByRepo.byRepo.get(activeProjectItem.project.code)?.total || 0) -
                              (repoDocsStatsByRepo.byRepo.get(activeProjectItem.project.code)?.evergreen || 0) -
                              (repoDocsStatsByRepo.byRepo.get(activeProjectItem.project.code)?.glossary || 0),
                          },
                        ]
                      ).map((tab) => {
                        const active = projectDetailTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setProjectDetailTab(tab.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md cursor-pointer transition-colors ${
                              active
                                ? 'bg-white dark:bg-surface font-semibold text-foreground shadow-2xs'
                                : 'text-muted hover:text-foreground'
                            }`}
                          >
                            <span>{tab.label}</span>
                            {typeof tab.count === 'number' && (
                              <span className="text-[10px] font-mono opacity-75">{tab.count}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activeProjectItem.project.physical_path);
                        pushToast(`已复制 ${activeProjectItem.project.code} 物理路径`, 'success');
                      }}
                      title="复制物理路径"
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-50 dark:bg-surface-secondary/60 border border-zinc-200/85 dark:border-border/70 font-mono text-[10px] text-muted hover:text-foreground cursor-pointer max-w-[220px]"
                    >
                      <span className="truncate">{activeProjectItem.project.physical_path}</span>
                      <Copy className="w-3 h-3 shrink-0" />
                    </button>
                  </div>
                ) : (
                  projectDocPath && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                        <button
                          onClick={() => setProjectMode('preview')}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                            projectMode === 'preview'
                              ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          <Eye className="w-3 h-3" />
                          <span>阅读</span>
                        </button>
                        <button
                          onClick={() => setProjectMode('edit')}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                            projectMode === 'edit'
                              ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                              : 'text-muted hover:text-foreground'
                          }`}
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>编辑</span>
                        </button>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        isPending={loadingProjectDoc}
                        className="h-7 px-2.5 rounded-lg text-[11px]"
                        onPress={() => openProjectFile(activeProjectItem.title, activeProjectItem.relPath)}
                      >
                        重载
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        isPending={savingProjectDoc}
                        isDisabled={!isProjectDirty && !savingProjectDoc}
                        className="h-7 px-3 rounded-lg text-[11px]"
                        onPress={handleSaveProjectDoc}
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>保存 (Ctrl+S)</span>
                      </Button>
                    </div>
                  )
                )}
              </div>

              {pendingProjectExit && (
                <UnsavedInlineBar
                  busy={savingProjectDoc}
                  onSaveAndContinue={async () => {
                    const ok = await handleSaveProjectDoc();
                    if (ok) {
                      setPendingProjectExit(false);
                      setRepoMapDrawerOpen(false);
                      setActiveProjectItem(null);
                      setProjectDocPath('');
                    }
                  }}
                  onDiscardAndContinue={() => {
                    setPendingProjectExit(false);
                    setRepoMapDrawerOpen(false);
                    setActiveProjectItem(null);
                    setProjectDocPath('');
                  }}
                  onCancel={() => setPendingProjectExit(false)}
                />
              )}

              {activeProjectItem.kind === 'file' ? (
                <div className="px-5 py-4">
                  {projectMode === 'preview' ? (
                    <MarkdownArticle content={projectDocContent} />
                  ) : (
                    <textarea
                      value={projectDocContent}
                      onChange={(e) => setProjectDocContent(e.target.value)}
                      spellCheck={false}
                      className="w-full min-h-[520px] font-mono text-[12px] text-foreground dark:text-slate-100 bg-transparent focus:outline-none resize-y leading-relaxed"
                    />
                  )}
                </div>
              ) : projectDetailTab === 'home' ? (
                <div className="flex flex-col">
                  {/* 主页副栏：README 标识 + 右侧「仓库地图档案」入口按钮 */}
                  <div className="px-5 py-2 border-b border-zinc-200/75 dark:border-border/55 bg-zinc-50/45 dark:bg-surface-secondary/15 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 text-[11px]">
                      <span className="font-mono font-medium text-foreground">
                        {activeProjectItem.project.readme_rel_path || 'README.md'}
                      </span>
                      <span className="text-muted truncate">· {activeProjectItem.project.summary}</span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 rounded-lg text-[11px]"
                      onPress={() => setRepoMapDrawerOpen(true)}
                    >
                      <FolderGit2 className="w-3.5 h-3.5" />
                      <span>仓库地图档案</span>
                    </Button>
                  </div>

                  {/* 第一屏主内容：仓库自己的 README.md */}
                  <div className="px-6 py-5 min-h-[520px]">
                    {loadingRepoReadme ? (
                      <div className="py-16 text-center text-[11.5px] text-muted">
                        正在加载 {activeProjectItem.project.readme_rel_path || 'README.md'}...
                      </div>
                    ) : repoReadmeError ? (
                      <div className="py-16 text-center text-[11.5px] text-rose-500">
                        {repoReadmeError}
                      </div>
                    ) : !activeProjectItem.project.readme_rel_path ? (
                      <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted text-[12px]">
                        <BookOpen className="w-7 h-7 opacity-30" />
                        <span>{activeProjectItem.project.code} 根目录暂无 README.md</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 rounded-lg text-[11px]"
                          onPress={() => setRepoMapDrawerOpen(true)}
                        >
                          <FolderGit2 className="w-3.5 h-3.5" />
                          <span>打开仓库地图档案</span>
                        </Button>
                      </div>
                    ) : (
                      <MarkdownArticle
                        content={repoReadmeContent}
                        onOpenDocLink={(href) => {
                          const clean = href.split('#')[0].replace(/^\.\//, '').replace(/\\/g, '/').toLowerCase();
                          if (clean === 'docs/glossary.md' || clean.startsWith('docs/evergreen/')) {
                            setProjectDetailTab('evergreen');
                          } else if (clean.startsWith('docs/')) {
                            setProjectDetailTab('docs');
                          } else {
                            pushToast(`外部或源码路径：${href}`, 'info');
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* 仓库地图说明与关联信息抽屉（由主页按钮打开，不抢占第一屏 README 视觉焦点） */}
                  {repoMapDrawerOpen && (
                    <div
                      className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-[1px]"
                      onClick={() => {
                        if (isProjectDirty) {
                          setPendingProjectExit(true);
                          return;
                        }
                        setRepoMapDrawerOpen(false);
                      }}
                    >
                      <div
                        className="w-full max-w-[700px] h-full bg-white dark:bg-surface border-l border-zinc-200 dark:border-border shadow-xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-4 py-3 border-b border-zinc-200/85 dark:border-border/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <FolderGit2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="text-[13px] font-semibold text-foreground truncate">
                              仓库地图档案 · {activeProjectItem.project.code}
                            </span>
                            {projectDocPath && (
                              <span className="font-mono text-[10.5px] text-muted truncate">
                                ({projectDocPath})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {projectDocPath && (
                              <>
                                <div className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-surface-secondary p-0.5 text-[11px]">
                                  <button
                                    onClick={() => setProjectMode('preview')}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
                                      projectMode === 'preview'
                                        ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                                        : 'text-muted hover:text-foreground'
                                    }`}
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>阅读</span>
                                  </button>
                                  <button
                                    onClick={() => setProjectMode('edit')}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
                                      projectMode === 'edit'
                                        ? 'bg-white dark:bg-surface font-medium text-foreground shadow-2xs'
                                        : 'text-muted hover:text-foreground'
                                    }`}
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    <span>编辑</span>
                                  </button>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  isPending={loadingProjectDoc}
                                  className="h-7 px-2.5 rounded-lg text-[11px]"
                                  onPress={() => openProjectCard(activeProjectItem.project)}
                                >
                                  重载
                                </Button>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  isPending={savingProjectDoc}
                                  isDisabled={!isProjectDirty && !savingProjectDoc}
                                  className="h-7 px-2.5 rounded-lg text-[11px]"
                                  onPress={handleSaveProjectDoc}
                                >
                                  <Save className="w-3.5 h-3.5" />
                                  <span>保存</span>
                                </Button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (isProjectDirty) {
                                  setPendingProjectExit(true);
                                  return;
                                }
                                setRepoMapDrawerOpen(false);
                              }}
                              className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {pendingProjectExit && (
                          <UnsavedInlineBar
                            busy={savingProjectDoc}
                            onSaveAndContinue={async () => {
                              const ok = await handleSaveProjectDoc();
                              if (ok) {
                                setPendingProjectExit(false);
                                setRepoMapDrawerOpen(false);
                              }
                            }}
                            onDiscardAndContinue={() => {
                              setPendingProjectExit(false);
                              setRepoMapDrawerOpen(false);
                            }}
                            onCancel={() => setPendingProjectExit(false)}
                          />
                        )}

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          {!projectDocPath ? (
                            <div className="py-16 text-center text-[11.5px] text-muted">
                              该仓库暂未在 repos/ 下配置独立档案
                            </div>
                          ) : projectMode === 'preview' ? (
                            <MarkdownArticle content={projectDocContent} />
                          ) : (
                            <textarea
                              value={projectDocContent}
                              onChange={(e) => setProjectDocContent(e.target.value)}
                              spellCheck={false}
                              className="w-full min-h-[520px] font-mono text-[12px] text-foreground dark:text-slate-100 bg-transparent focus:outline-none resize-y leading-relaxed"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : projectDetailTab === 'evergreen' ? (
                <RepoDocsBrowser
                  variant="evergreen"
                  docs={allRepoDocs.filter((d) => d.repo === activeProjectItem.project.code)}
                  allRepoDocs={allRepoDocs}
                  showRepoBadge={false}
                  emptyHint={`${activeProjectItem.project.code} 暂无常青文档 (docs/evergreen/)`}
                  callTauri={callTauri}
                  pushToast={pushToast}
                  renderArticle={(content, onOpenDocLink) => (
                    <MarkdownArticle content={content} onOpenDocLink={onOpenDocLink} />
                  )}
                />
              ) : (
                <RepoDocsBrowser
                  variant="docs"
                  docs={allRepoDocs.filter((d) => d.repo === activeProjectItem.project.code)}
                  allRepoDocs={allRepoDocs}
                  showRepoBadge={false}
                  emptyHint={`${activeProjectItem.project.code} docs/ 下暂无非常青文档`}
                  callTauri={callTauri}
                  pushToast={pushToast}
                  renderArticle={(content, onOpenDocLink) => (
                    <MarkdownArticle content={content} onOpenDocLink={onOpenDocLink} />
                  )}
                />
              )}
            </section>
          )}
        </>
      )}

    </div>
  );
}
