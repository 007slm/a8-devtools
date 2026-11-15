import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  InputGroup,
  Label,
  TextField,
} from '@heroui/react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  Activity,
  ArrowLeft,
  Check,
  Clock,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  FolderGit2,
  FolderOpen,
  History,
  Lock,
  Network,
  Play,
  Plus,
  RotateCw,
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
  eval_count?: number;
  hit_count?: number;
  last_eval_ts?: number;
  last_hit_ts?: number;
}

export interface GovernanceSummary {
  rule_files_count: number;
  rule_clauses_count: number;
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
}

export interface DailyHarnessTrend {
  date: string;
  allow_or_pass: number;
  hook_woke: number;
  violated_or_error: number;
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
  decisions?: DecisionEntry[];
  lints?: LintItem[];
  governance_summary?: GovernanceSummary;
}

interface AgentMindViewProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  isStandalone?: boolean;
  theme?: 'light' | 'dark';
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

const DECISION_CATEGORY_LABELS: Record<string, string> = {
  lifecycle_and_evolution: '演化与生命周期',
  topology_and_boundaries: '边界与依赖分层',
  concurrency_and_performance: '并发与热路径性能',
  implementation_hygiene: '实现规范与错误处理',
  white_label: '白标与品牌脱敏',
  custom: '自定义规则',
};

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

/** 行内 Markdown 轻量安全渲染（零 dangerouslySetInnerHTML） */
function renderInlineMd(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {part.slice(2, -2)}
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
    return <Fragment key={idx}>{part}</Fragment>;
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
function MarkdownArticle({ content }: { content: string }) {
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
            {codeLines.join('\n')}
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
        <div key={`h-${i}`} className={cls}>
          {renderInlineMd(text)}
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
                    {renderInlineMd(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/65 dark:divide-border/50">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-50/60 dark:hover:bg-surface-secondary/30">
                  {header.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-zinc-700 dark:text-zinc-300 align-top">
                      {renderInlineMd(row[ci] || '')}
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
            <p key={qi}>{renderInlineMd(ql)}</p>
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
          {items.map((it, idx) => (
            <li
              key={idx}
              style={{ paddingLeft: `${Math.min(it.indent, 6) * 8}px` }}
              className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300"
            >
              <span className="text-muted font-mono text-[11px] shrink-0 mt-[1px]">{it.marker}</span>
              <span className="min-w-0 flex-1">{renderInlineMd(it.text)}</span>
            </li>
          ))}
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
        {renderInlineMd(paraLines.join(' '))}
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
}: AgentMindViewProps) {
  const isDark = theme === 'dark';
  // 默认首页即“规则维护”，直接加载并呈现主规则 rules/mind-rules.md
  const [subTab, setSubTab] = useState<
    'rules' | 'reviews' | 'proposals' | 'observability' | 'projects' | 'config'
  >('rules');
  const [overview, setOverview] = useState<AgentMindOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab 1 (默认首页): 三层治理资产 (Markdown 规则 / Decision 决策 / Lint 检查)
  const [govLayer, setGovLayer] = useState<'rules' | 'decisions' | 'lints'>('rules');
  const [govScope, setGovScope] = useState<string>('ALL');

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

  // Tab 4: Harness observability filter
  const [telemetryFilter, setTelemetryFilter] = useState<'ALL' | 'stop_hook' | 'a8_judge' | 'repo_lint' | 'alerts'>('ALL');

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

  // Tab 4: Config form state
  const [cfgModel, setCfgModel] = useState('');
  const [cfgEndpoint, setCfgEndpoint] = useState('');
  const [cfgTimeout, setCfgTimeout] = useState('15');
  const [cfgThreshold, setCfgThreshold] = useState('0.85');
  const [cfgApiKey, setCfgApiKey] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  const isRuleDirty = editorContent !== savedContent;
  const isDecisionDirty = decisionEditorContent !== decisionSavedContent;
  const isProjectDirty = projectDocContent !== projectDocSaved;

  const loadOverview = useCallback(
    async (silent = true) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await callTauri<AgentMindOverview>('get_agent_mind_overview');
        if (res) {
          setOverview(res);
          setCfgModel(res.config_json?.model || '');
          setCfgEndpoint(res.config_json?.endpoint || '');
          setCfgTimeout(String(res.config_json?.timeout_seconds ?? 15));
          setCfgThreshold(String(res.config_json?.confidence_threshold ?? 0.85));
          setCfgApiKey(res.config_json?.api_key || '');
          if (!silent) pushToast('已刷新面板数据', 'success');
        }
      } catch (e: any) {
        const msg = String(e || '加载失败');
        setLoadError(msg);
        if (!silent) pushToast(`加载失败: ${msg}`, 'danger');
      } finally {
        setLoading(false);
      }
    },
    [callTauri, pushToast]
  );

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
      setProjectMode('preview');
      setPendingProjectExit(false);
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
    setActiveProjectItem(null);
    setProjectDocPath('');
  };

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
    source: 'review' | 'rule' | 'decision',
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

  const handleSaveConfig = async () => {
    const endpointTrimmed = cfgEndpoint.trim();
    if (!endpointTrimmed || (!endpointTrimmed.startsWith('http://') && !endpointTrimmed.startsWith('https://'))) {
      pushToast('Endpoint 不能为空且必须以 http:// 或 https:// 开头', 'danger');
      return;
    }
    setSavingConfig(true);
    try {
      const payload = {
        api_key: cfgApiKey.trim() || '${GEMINI_API_KEY}',
        model: cfgModel.trim() || 'gemini-decision-1',
        endpoint: endpointTrimmed,
        timeout_seconds: Math.max(1, parseInt(cfgTimeout, 10) || 15),
        confidence_threshold: Math.min(1, Math.max(0.1, parseFloat(cfgThreshold) || 0.85)),
      };
      await callTauri('save_agent_mind_file', {
        relPath: 'config.json',
        content: `${JSON.stringify(payload, null, 2)}\n`,
      });
      pushToast('决策参数已保存', 'success');
      await loadOverview(true);
    } catch (e: any) {
      pushToast(`保存 config.json 失败: ${e}`, 'danger');
    } finally {
      setSavingConfig(false);
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
        editable: true,
        size_bytes: f.size_bytes,
        modified_ts: f.modified_ts,
      }));
  }, [overview]);

  const allDecisions = useMemo<DecisionEntry[]>(() => overview?.decisions || [], [overview]);
  const allLints = useMemo<LintItem[]>(() => overview?.lints || [], [overview]);

  const writableRepos = useMemo(
    () => (overview?.projects || []).filter((p) => p.role !== 'test-bed' && p.code !== 'global'),
    [overview]
  );

  const availableGovScopes = useMemo(() => {
    const repoSet = new Set<string>();
    for (const r of governanceRules) {
      if (r.scope === 'project' && r.repo) repoSet.add(r.repo);
    }
    for (const d of allDecisions) {
      if (d.scope === 'project' && d.repo) repoSet.add(d.repo);
    }
    for (const l of allLints) {
      if (l.scope === 'project' && l.repo) repoSet.add(l.repo);
    }
    return ['global', ...Array.from(repoSet).sort()];
  }, [governanceRules, allDecisions, allLints]);

  const filteredRules = useMemo(() => {
    if (govScope === 'ALL') return governanceRules;
    if (govScope === 'global') return governanceRules.filter((r) => r.scope === 'global');
    return governanceRules.filter((r) => r.scope === 'project' && r.repo === govScope);
  }, [governanceRules, govScope]);

  const filteredDecisions = useMemo(() => {
    const kw = decisionSearch.trim().toLowerCase();
    return allDecisions.filter((d) => {
      if (govScope === 'global' && d.scope !== 'global') return false;
      if (govScope !== 'ALL' && govScope !== 'global' && d.repo !== govScope) return false;
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
    if (govScope === 'ALL') return allLints;
    if (govScope === 'global') return allLints.filter((l) => l.scope === 'global');
    return allLints.filter((l) => l.scope === 'project' && l.repo === govScope);
  }, [allLints, govScope]);

  const activeRuleEntry = useMemo(
    () =>
      governanceRules.find(
        (r) =>
          r.rel_path === selectedRulePath &&
          (r.scope === 'global' ? '' : r.repo) === selectedRuleRepo
      ) || null,
    [governanceRules, selectedRulePath, selectedRuleRepo]
  );

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
    } else if (govLayer === 'lints' && filteredLints.length > 0) {
      const stillVisible =
        selectedLint &&
        filteredLints.some(
          (l) => l.id === selectedLint.id && l.repo === selectedLint.repo && l.rel_path === selectedLint.rel_path
        );
      if (!stillVisible) {
        loadLintSourceDirect(filteredLints[0]);
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
      const convTitle = `推进 Grok 提案 (${p.date || p.id})`;
      const convPrompt = `请阅读提案文件 \`${p.abs_path}\` 以及 \`AGENTS.md\`，并与我确认后开始推进实施其中的工作流提升提案（优先推进 P0/P1 项，先给出本次拟落地的改造计划）。`;
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
    [callTauri, isStandalone, loadOverview, pushToast]
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

  const chartTooltipBase = useMemo(
    () => ({
      backgroundColor: isDark ? '#18181B' : '#FFFFFF',
      borderColor: isDark ? 'rgba(63,63,70,0.85)' : '#E4E4E7',
      borderWidth: 1,
      textStyle: { color: isDark ? '#F4F4F5' : '#18181B', fontSize: 11 },
    }),
    [isDark]
  );

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
    selectedRulePath &&
      (activeRuleEntry?.editable ?? true) &&
      !(!selectedRuleRepo && PROTECTED_FILES.has(selectedRulePath)) &&
      (selectedRulePath.startsWith('rules/') || selectedRulePath.startsWith('.agents/rules/'))
  );

  const canDeleteSelectedDecision = Boolean(
    selectedDecisionKey &&
      (activeDecisionEntry?.editable ?? true) &&
      !(!selectedDecisionKey.repoCode && PROTECTED_FILES.has(selectedDecisionKey.relPath))
  );

  const govSummary = overview?.governance_summary;
  const totalGovernanceCount = govSummary
    ? govSummary.rule_files_count + govSummary.decisions_count + govSummary.lints_count
    : governanceRules.length + allDecisions.length + allLints.length;

  const navItems: { id: typeof subTab; label: string; count?: number }[] = [
    { id: 'rules', label: '规则规范', count: totalGovernanceCount || undefined },
    { id: 'reviews', label: '终审记录', count: allReviews.length || undefined },
    { id: 'proposals', label: '每日提案', count: allProposals.length || undefined },
    { id: 'observability', label: '可观测', count: telemetry?.total_events || undefined },
    { id: 'projects', label: '仓库地图', count: overview?.projects.length || undefined },
    { id: 'config', label: '模型参数' },
  ];

  return (
    <div className="flex flex-col gap-3 max-w-[1440px] mx-auto">
      {/* ================================================================= */}
      {/* 1. 与映射页同体系的顶部摘要卡：标题 + 根路径 + 一级下划线导航 */}
      {/* ================================================================= */}
      <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-4 pt-3 pb-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-surface-secondary border border-zinc-200/80 dark:border-border/70 flex items-center justify-center shrink-0">
              <Network className="w-3.5 h-3.5 text-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[13.5px] font-semibold tracking-tight text-foreground">
                  A8 心智治理面板
                </h1>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      overview?.mount_alive ? 'bg-emerald-500' : 'bg-zinc-400'
                    }`}
                  />
                  <span>{overview?.mount_alive ? 'CowFS 实时透视' : '源码直连'}</span>
                </span>
              </div>
              {overview?.plugin_root && (
                <div className="text-[10.5px] font-mono text-muted truncate mt-0.5">
                  {overview.plugin_root}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-[11px]"
              onPress={() => callTauri('open_agent_mind_dir')}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>打开目录</span>
            </Button>
            {!isStandalone && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 rounded-lg text-[11px]"
                onPress={async () => {
                  try {
                    const url = await callTauri<string>('launch_agent_mind_sidecar');
                    pushToast(`独立看板已就绪: ${url || '127.0.0.1:18765'}`, 'success');
                    await loadOverview(true);
                  } catch (e: any) {
                    pushToast(`启动独立看板失败: ${e}`, 'danger');
                  }
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>独立看板</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              isPending={loading}
              className="h-7 px-2.5 rounded-lg text-[11px]"
              onPress={() => loadOverview(false)}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>刷新</span>
            </Button>
          </div>
        </div>

        {/* 下划线一级导航 */}
        <nav aria-label="心智治理视图切换" className="flex items-center gap-6">
          {navItems.map((item) => {
            const active = subTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSubTab(item.id)}
                className={`relative pb-2.5 text-[12px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted hover:text-foreground'
                }`}
              >
                <span>{item.label}</span>
                {typeof item.count === 'number' && (
                  <span className="text-[10px] font-mono text-muted">{item.count}</span>
                )}
                {active && (
                  <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-foreground rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </section>

      {loadError && (
        <div className="rounded-xl bg-rose-500/8 border border-rose-500/25 px-3.5 py-2 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 1 (首页): 三层治理体系 — Markdown 规则 / Decision 决策 / Lint 检查 */}
      {/* ================================================================= */}
      {subTab === 'rules' && (
        <div className="flex flex-col gap-3">
          {/* 顶栏：三层防线切换 + 作用域过滤 + 数量概览 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setGovLayer('rules')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11.5px] transition-colors cursor-pointer ${
                  govLayer === 'rules'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                    : 'bg-zinc-100/80 dark:bg-surface-secondary text-muted hover:text-foreground'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Markdown 规则</span>
                <span className="text-[10.5px] font-mono opacity-80">
                  {govSummary?.rule_files_count ?? governanceRules.length} 篇 ·{' '}
                  {govSummary?.rule_clauses_count ??
                    governanceRules.reduce((acc, r) => acc + (r.clause_count || 0), 0)}{' '}
                  条
                </span>
              </button>

              <button
                onClick={() => setGovLayer('decisions')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11.5px] transition-colors cursor-pointer ${
                  govLayer === 'decisions'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                    : 'bg-zinc-100/80 dark:bg-surface-secondary text-muted hover:text-foreground'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Decision 决策</span>
                <span className="text-[10.5px] font-mono opacity-80">
                  {govSummary?.decisions_count ?? allDecisions.length} 项 · 启用{' '}
                  {govSummary?.enabled_decisions_count ?? allDecisions.filter((d) => d.enabled).length}
                </span>
              </button>

              <button
                onClick={() => setGovLayer('lints')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11.5px] transition-colors cursor-pointer ${
                  govLayer === 'lints'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                    : 'bg-zinc-100/80 dark:bg-surface-secondary text-muted hover:text-foreground'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Lint 检查</span>
                <span className="text-[10.5px] font-mono opacity-80">
                  {govSummary?.lints_count ?? allLints.length} 项
                </span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setGovScope('ALL')}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  govScope === 'ALL'
                    ? 'bg-zinc-100 dark:bg-surface-secondary text-foreground font-semibold border border-zinc-200 dark:border-border/80'
                    : 'text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/50'
                }`}
              >
                全部
              </button>
              {availableGovScopes.map((sc) => (
                <button
                  key={sc}
                  onClick={() => setGovScope(sc)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-colors cursor-pointer ${
                    govScope === sc
                      ? 'bg-zinc-100 dark:bg-surface-secondary text-foreground font-semibold border border-zinc-200 dark:border-border/80'
                      : 'text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/50'
                  }`}
                >
                  {sc === 'global' ? '全局' : sc}
                </button>
              ))}
            </div>
          </section>

          {/* --------------------------------------------------------------- */}
          {/* Layer 1: Markdown 规则 (全局 mind-rules.md + 各项目 .agents/rules/) */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'rules' && (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  {filteredRules.map((f) => {
                    const ruleRepoCode = f.scope === 'global' ? '' : f.repo;
                    const active = selectedRulePath === f.rel_path && selectedRuleRepo === ruleRepoCode;
                    const isMaster = f.scope === 'global' && f.rel_path === 'rules/mind-rules.md';
                    return (
                      <button
                        key={`${f.repo}::${f.rel_path}`}
                        onClick={() => requestSwitchRule(f.rel_path, ruleRepoCode)}
                        title={f.abs_path || f.rel_path}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                            : 'text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60'
                        }`}
                      >
                        <span>
                          {isMaster ? '全局架构与治理总则' : f.title || f.name.replace(/\.md$/i, '')}
                        </span>
                        <span className="text-[10px] font-mono text-muted/85">{f.name}</span>
                        <span className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-muted">
                          {isMaster ? '主规则' : f.scope === 'global' ? '全局' : f.repo}
                        </span>
                        {f.clause_count > 0 && (
                          <span className="text-[9.5px] font-mono text-muted/80">{f.clause_count}条</span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => {
                      if (govScope !== 'ALL' && govScope !== 'global') {
                        const allowed = writableRepos.some((p) => p.code === govScope);
                        setNewRuleTargetRepo(allowed ? govScope : '');
                      } else {
                        setNewRuleTargetRepo('');
                      }
                      setIsNewRuleOpen((v) => !v);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60 transition-colors cursor-pointer"
                  >
                    {isNewRuleOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    <span>{isNewRuleOpen ? '收起' : '新建规则'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {activeRuleEntry && !activeRuleEntry.editable && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400 px-1.5">
                      <Lock className="w-3 h-3" />
                      只读 (test-bed)
                    </span>
                  )}
                  {isRuleDirty ? (
                    <span className="text-[10.5px] text-amber-600 dark:text-amber-400 px-1.5">未保存</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 px-1.5">
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
                      disabled={activeRuleEntry ? !activeRuleEntry.editable : false}
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
                    isDisabled={
                      (!isRuleDirty && !savingFile) || (activeRuleEntry ? !activeRuleEntry.editable : false)
                    }
                    className="h-7 px-3 rounded-lg text-[11px]"
                    onPress={handleSaveCurrentRule}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>保存 (Ctrl+S)</span>
                  </Button>
                </div>
              </div>

              {isNewRuleOpen && (
                <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-surface-secondary/35 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center gap-2">
                  <select
                    value={newRuleTargetRepo}
                    onChange={(e) => setNewRuleTargetRepo(e.target.value)}
                    aria-label="规则归属作用域"
                    className="h-7 px-2 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 text-[11px] font-mono text-foreground outline-none"
                  >
                    <option value="">全局 (a8-agent-mind/rules/)</option>
                    {writableRepos.map((p) => (
                      <option key={p.code} value={p.code}>
                        项目 {p.code} (.agents/rules/)
                      </option>
                    ))}
                  </select>
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

              <div className="px-4 py-1.5 bg-zinc-50/50 dark:bg-surface-secondary/20 border-b border-zinc-200/60 dark:border-border/40 text-[10.5px] font-mono text-muted flex items-center justify-between gap-2">
                <span>
                  {selectedRuleRepo ? `${selectedRuleRepo} / ${selectedRulePath}` : `a8-agent-mind / ${selectedRulePath}`}
                </span>
                {activeRuleEntry && <span>条款数：{activeRuleEntry.clause_count}</span>}
              </div>

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
            </section>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 2: Decision 决策 (*.decision.json 结构化语义裁决配置)       */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'decisions' && (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
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
                  <button
                    onClick={() => {
                      if (govScope !== 'ALL' && govScope !== 'global') {
                        const allowed = writableRepos.some((p) => p.code === govScope);
                        setNewDecisionTargetRepo(allowed ? govScope : '');
                      } else {
                        setNewDecisionTargetRepo('');
                      }
                      setIsNewDecisionOpen((v) => !v);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60 border border-zinc-200/75 dark:border-border/60 transition-colors cursor-pointer"
                  >
                    {isNewDecisionOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    <span>{isNewDecisionOpen ? '收起' : '新建 Decision'}</span>
                  </button>
                </div>

                <div className="text-[11px] text-muted">
                  确定性优先级：<span className="font-mono text-foreground">Lint &gt; Decision &gt; Prose Rule</span>
                  ，无单次字符上限
                </div>
              </div>

              {isNewDecisionOpen && (
                <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-surface-secondary/35 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center gap-2">
                  <select
                    value={newDecisionTargetRepo}
                    onChange={(e) => setNewDecisionTargetRepo(e.target.value)}
                    aria-label="Decision 归属作用域"
                    className="h-7 px-2 rounded-lg bg-white dark:bg-surface border border-zinc-200/90 dark:border-border/70 text-[11px] font-mono text-foreground outline-none"
                  >
                    <option value="">全局 (a8-agent-mind/decisions/)</option>
                    {writableRepos.map((p) => (
                      <option key={p.code} value={p.code}>
                        项目 {p.code} (scripts/lints/)
                      </option>
                    ))}
                  </select>
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
                            {d.enabled && (d.eval_count ?? 0) >= 5 && (d.hit_count ?? 0) === 0 && (
                              <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-amber-500/8 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                0 拦截 · 可考虑退役
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
                  {!activeDecisionEntry ? (
                    <div className="py-20 text-center text-[11.5px] text-muted">
                      从左侧选择一条 Decision 决策查看裁决判据或编辑 JSON 定义
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2.5 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/40 dark:bg-surface-secondary/20">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-foreground truncate">
                            {activeDecisionEntry.name}
                          </div>
                          <div className="text-[10.5px] font-mono text-muted truncate">
                            {activeDecisionEntry.scope === 'global'
                              ? `a8-agent-mind / ${activeDecisionEntry.rel_path}`
                              : `${activeDecisionEntry.repo} / ${activeDecisionEntry.rel_path}`}
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
                              disabled={!activeDecisionEntry.editable}
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

                          {activeDecisionEntry.editable && !activeDecisionEntry.parse_error && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2.5 rounded-lg text-[11px]"
                              onPress={() => handleToggleDecisionEnabled(activeDecisionEntry)}
                            >
                              {activeDecisionEntry.enabled ? '退役' : '恢复'}
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
                              (!isDecisionDirty && !savingDecision) || !activeDecisionEntry.editable
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
                            {activeDecisionEntry.parse_error && (
                              <div className="rounded-xl bg-rose-500/8 border border-rose-500/25 px-3 py-2 text-[11.5px] text-rose-600 dark:text-rose-400">
                                解析错误：{activeDecisionEntry.parse_error}
                              </div>
                            )}

                            {!activeDecisionEntry.enabled && (
                              <div className="rounded-xl bg-zinc-100/90 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                                <span className="text-muted">
                                  已退役{activeDecisionEntry.retired_at ? ` (${activeDecisionEntry.retired_at})` : ''}
                                  {activeDecisionEntry.retired_reason ? ` · ${activeDecisionEntry.retired_reason}` : ''}
                                </span>
                                {activeDecisionEntry.editable && (
                                  <button
                                    onClick={() => handleToggleDecisionEnabled(activeDecisionEntry)}
                                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                  >
                                    恢复启用
                                  </button>
                                )}
                              </div>
                            )}

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 px-3 py-2 bg-zinc-50/40 dark:bg-surface-secondary/15 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span className="font-mono text-muted">
                                累计评估 {activeDecisionEntry.eval_count ?? 0} 次 · 累计拦截 {activeDecisionEntry.hit_count ?? 0} 次
                              </span>
                              <span className="font-mono text-muted">
                                {activeDecisionEntry.last_hit_ts
                                  ? `最近拦截 ${formatReviewTime('', activeDecisionEntry.last_hit_ts)}`
                                  : activeDecisionEntry.last_eval_ts
                                    ? `最近评估 ${formatReviewTime('', activeDecisionEntry.last_eval_ts)}`
                                    : '暂无评估记录'}
                              </span>
                            </div>

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3 bg-zinc-50/50 dark:bg-surface-secondary/20">
                              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted mb-1">
                                触发与范围 (Triggers & File Patterns)
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {activeDecisionEntry.triggers.map((t) => (
                                  <span
                                    key={t}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white dark:bg-surface border border-zinc-200/80 dark:border-border/70 text-foreground"
                                  >
                                    trigger: {t}
                                  </span>
                                ))}
                                {activeDecisionEntry.file_patterns.length === 0 ? (
                                  <span className="text-[11px] text-muted">匹配全部路径</span>
                                ) : (
                                  activeDecisionEntry.file_patterns.map((fp) => (
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

                            {activeDecisionEntry.why && (
                              <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3">
                                <div className="text-[10.5px] font-semibold text-muted mb-1">
                                  工程根因 (Why)
                                </div>
                                <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {activeDecisionEntry.why}
                                </p>
                              </div>
                            )}

                            <div className="rounded-xl border border-zinc-200/80 dark:border-border/70 p-3">
                              <div className="text-[10.5px] font-semibold text-muted mb-1">
                                裁决指令 (Instructions)
                              </div>
                              <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                                {activeDecisionEntry.instructions || '-'}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                                <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                                  通过判据 (PASSED)
                                </div>
                                <p className="text-[11.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {activeDecisionEntry.passed_criteria || '-'}
                                </p>
                              </div>
                              <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
                                <div className="text-[10.5px] font-semibold text-rose-700 dark:text-rose-400 mb-1">
                                  拦截判据 (VIOLATED)
                                </div>
                                <p className="text-[11.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                                  {activeDecisionEntry.violated_criteria || '-'}
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
            </section>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Layer 3: Lint 检查 (scripts/lints/*.py 确定性脚本只读浏览)        */}
          {/* --------------------------------------------------------------- */}
          {govLayer === 'lints' && (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] font-medium text-foreground">
                  项目确定性结构检查 ({filteredLints.length} 项 · scripts/lints/*.py)
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
                    脚本只读展示（零误报机械防线，提交前自动运行）
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
                <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-zinc-200/80 dark:border-border/60 divide-y divide-zinc-200/70 dark:divide-border/50">
                  {filteredLints.length === 0 ? (
                    <div className="py-16 text-center text-[11.5px] text-muted">
                      当前筛选范围内暂无 Python Lint 检查项
                    </div>
                  ) : (
                    filteredLints.map((lint) => {
                      const active =
                        selectedLint?.id === lint.id &&
                        selectedLint?.repo === lint.repo &&
                        selectedLint?.rel_path === lint.rel_path;
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
                              {lint.name}()
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
                  {!selectedLint ? (
                    <div className="py-20 text-center text-[11.5px] text-muted">
                      从左侧选择一条 Lint 检查项查看脚本源码
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
                          <span className="text-[10.5px] font-mono text-muted">Python Read-Only</span>
                        </div>
                      </div>
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
            </section>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 2: 终审记录 (映射页同款 rounded-2xl 列表卡 <-> 原位全宽阅读卡) */}
      {/* ================================================================= */}
      {subTab === 'reviews' && (
        <>
          {activeReviewView === 'list' && (
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
                  <MarkdownArticle content={displayedProposalBody || '（空提案）'} />
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

          {/* 3b. Decision & Lint 检查器命中追踪与退役治理 */}
          <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12.5px] font-semibold text-foreground">
                  检查器效能追踪 (Decision & Lint 命中排行)
                </h3>
                <span className="text-[10.5px] text-muted">
                  长期 0 拦截的 Decision 可一键退役（保留 JSON 归档与历史，停止进入裁判配额）
                </span>
              </div>
              <span className="text-[10.5px] font-mono text-muted">
                共 {checkerPerfRows.length} 项
              </span>
            </div>

            {checkerPerfRows.length === 0 ? (
              <div className="py-10 text-center text-[11.5px] text-muted">
                暂无可追踪的 Decision 或 Lint 检查器
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
                    {checkerPerfRows.map((row) => (
                      <tr
                        key={row.key}
                        className="hover:bg-zinc-50/70 dark:hover:bg-surface-secondary/30 transition-colors"
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
      {/* Tab 5: 仓库地图 (同款 rounded-2xl + gap-3 卡片与原位阅读编辑) */}
      {/* ================================================================= */}
      {subTab === 'projects' && (
        <>
          {!activeProjectItem ? (
            <div className="flex flex-col gap-3">
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
                  <span className="text-[11px] text-muted">点击查看详情卡或复制物理路径</span>
                </div>

                <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(overview?.projects || []).map((proj) => (
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
                      className="rounded-xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/75 hover:border-zinc-300 dark:hover:border-zinc-600 p-3.5 transition-colors cursor-pointer flex flex-col justify-between gap-2.5 min-h-[110px]"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px] font-semibold text-foreground truncate">{proj.code}</span>
                          <span className="text-[10px] font-mono text-muted shrink-0">
                            {ROLE_LABELS[proj.role] || proj.role.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted leading-relaxed line-clamp-2">{proj.summary}</p>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200/60 dark:border-border/50 text-[10px] font-mono text-muted">
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
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={requestExitProject}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>返回仓库地图</span>
                  </button>
                  <span className="text-zinc-300 dark:text-zinc-700">/</span>
                  <span className="font-mono text-[11.5px] font-medium text-foreground truncate">
                    {activeProjectItem.kind === 'file'
                      ? activeProjectItem.relPath
                      : activeProjectItem.project.detail_rel_path || activeProjectItem.project.code}
                  </span>
                  {projectDocPath &&
                    (isProjectDirty ? (
                      <span className="text-[10.5px] text-amber-600 dark:text-amber-400 shrink-0">未保存</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Check className="w-3 h-3" />
                        已同步
                      </span>
                    ))}
                </div>

                {projectDocPath && (
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
                      onPress={() =>
                        activeProjectItem.kind === 'file'
                          ? openProjectFile(activeProjectItem.title, activeProjectItem.relPath)
                          : openProjectCard(activeProjectItem.project)
                      }
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
                )}
              </div>

              {pendingProjectExit && (
                <UnsavedInlineBar
                  busy={savingProjectDoc}
                  onSaveAndContinue={async () => {
                    const ok = await handleSaveProjectDoc();
                    if (ok) {
                      setPendingProjectExit(false);
                      setActiveProjectItem(null);
                      setProjectDocPath('');
                    }
                  }}
                  onDiscardAndContinue={() => {
                    setPendingProjectExit(false);
                    setActiveProjectItem(null);
                    setProjectDocPath('');
                  }}
                  onCancel={() => setPendingProjectExit(false)}
                />
              )}

              {activeProjectItem.kind === 'repo' && (
                <div className="px-4 py-2.5 bg-zinc-50/70 dark:bg-surface-secondary/25 border-b border-zinc-200/75 dark:border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-semibold text-foreground">{activeProjectItem.project.code}</span>
                    <span className="font-mono text-[10px] text-muted">
                      {ROLE_LABELS[activeProjectItem.project.role] || activeProjectItem.project.role.toUpperCase()}
                    </span>
                    <span className="text-muted">· {activeProjectItem.project.summary}</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(activeProjectItem.project.physical_path);
                      pushToast(`已复制 ${activeProjectItem.project.code} 物理路径`, 'success');
                    }}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 font-mono text-[10px] text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
                  >
                    <span>{activeProjectItem.project.physical_path}</span>
                    <Copy className="w-3 h-3 text-muted" />
                  </button>
                </div>
              )}

              <div className="px-5 py-4">
                {!projectDocPath ? (
                  <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted text-[11.5px]">
                    <FolderGit2 className="w-6 h-6 opacity-40" />
                    <span>该仓库暂未在 repos/ 下配置独立详情卡</span>
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
            </section>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* Tab 4: 模型参数 (与映射页同款 rounded-2xl 容器) */}
      {/* ================================================================= */}
      {subTab === 'config' && (
        <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden max-w-2xl">
          <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[12.5px] font-semibold text-foreground">Decisions API 裁决参数 (config.json)</h2>
            </div>
            <Button
              size="sm"
              variant="primary"
              isPending={savingConfig}
              className="h-7 px-3 rounded-lg text-[11px]"
              onPress={handleSaveConfig}
            >
              <Save className="w-3.5 h-3.5" />
              <span>保存配置</span>
            </Button>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 text-[12px]">
            <TextField value={cfgModel} onChange={setCfgModel}>
              <Label className="text-[11px] font-medium text-foreground">裁决模型 (Model)</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="gemini-decision-1" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>

            <TextField value={cfgThreshold} onChange={setCfgThreshold}>
              <Label className="text-[11px] font-medium text-foreground">置信度阈值 (Confidence Threshold)</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="0.85" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>

            <TextField value={cfgEndpoint} onChange={setCfgEndpoint} className="md:col-span-2">
              <Label className="text-[11px] font-medium text-foreground">Decisions API Endpoint</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input
                  placeholder="https://generativelanguage.googleapis.com/..."
                  className="font-mono text-[11.5px]"
                />
              </InputGroup>
            </TextField>

            <TextField value={cfgTimeout} onChange={setCfgTimeout}>
              <Label className="text-[11px] font-medium text-foreground">请求超时（秒）</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="15" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>

            <TextField value={cfgApiKey} onChange={setCfgApiKey}>
              <Label className="text-[11px] font-medium text-foreground">API Key / Env 变量表达式</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="${GEMINI_API_KEY}" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>
          </div>
        </section>
      )}
    </div>
  );
}
