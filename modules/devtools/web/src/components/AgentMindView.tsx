import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  InputGroup,
  Label,
  TextField,
} from '@heroui/react';
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  FolderGit2,
  FolderOpen,
  History,
  Network,
  Plus,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';

export interface AgentMindFileEntry {
  rel_path: string;
  name: string;
  category: string;
  extension: string;
  size_bytes: number;
  modified_ts: number;
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
  files: AgentMindFileEntry[];
}

interface AgentMindViewProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  isStandalone?: boolean;
}

const PROTECTED_FILES = new Set([
  'plugin.json',
  'config.json',
  'repos.md',
  'rules/mind-rules.md',
  'repos/relations.md',
]);

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

function getRuleTabLabel(file: AgentMindFileEntry): string {
  if (file.rel_path === 'rules/mind-rules.md') {
    return '全局架构与治理总则';
  }
  return file.name.replace(/\.md$/i, '');
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

export function AgentMindView({ callTauri, pushToast, isStandalone = false }: AgentMindViewProps) {
  // 默认首页即“规则维护”，直接加载并呈现主规则 rules/mind-rules.md
  const [subTab, setSubTab] = useState<'rules' | 'reviews' | 'projects' | 'config'>('rules');
  const [overview, setOverview] = useState<AgentMindOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab 1 (默认首页): Rules state - 默认直接展示主规则 rules/mind-rules.md
  const [selectedRulePath, setSelectedRulePath] = useState<string>('rules/mind-rules.md');
  const [ruleMode, setRuleMode] = useState<'preview' | 'edit'>('preview');
  const [editorContent, setEditorContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [pendingRuleSwitch, setPendingRuleSwitch] = useState<string | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(false);
  const [isNewRuleOpen, setIsNewRuleOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleDesc, setNewRuleDesc] = useState('');
  const [creatingRule, setCreatingRule] = useState(false);

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
    async (relPath: string, nextMode?: 'preview' | 'edit') => {
      setSelectedRulePath(relPath);
      if (nextMode) setRuleMode(nextMode);
      setConfirmDeleteRule(false);
      setPendingRuleSwitch(null);
      setLoadingFile(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', { relPath });
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

  const requestSwitchRule = (relPath: string) => {
    if (relPath === selectedRulePath && !isRuleDirty) {
      return;
    }
    if (isRuleDirty) {
      setPendingRuleSwitch(relPath);
      return;
    }
    loadRuleFileDirect(relPath);
  };

  const handleSaveCurrentRule = useCallback(async (): Promise<boolean> => {
    if (!selectedRulePath) return false;
    setSavingFile(true);
    try {
      await callTauri('save_agent_mind_file', {
        relPath: selectedRulePath,
        content: editorContent,
      });
      setSavedContent(editorContent);
      pushToast(`已保存 ${selectedRulePath}`, 'success');
      await loadOverview(true);
      return true;
    } catch (e: any) {
      pushToast(`保存失败: ${e}`, 'danger');
      return false;
    } finally {
      setSavingFile(false);
    }
  }, [selectedRulePath, editorContent, callTauri, pushToast, loadOverview]);

  const handleCreateRule = async () => {
    const cleanName = newRuleName.trim();
    if (!cleanName) {
      pushToast('请输入规则文件名，例如 redline-sql.md', 'danger');
      return;
    }
    setCreatingRule(true);
    try {
      const title = cleanName.replace(/\.md$/i, '');
      const template = `# ${title}\n\n> ${newRuleDesc.trim() || 'Agent Mind 架构治理与工程红线规范'}\n\n## 1. 核心约束\n\n- **${title}核心原则**：待补充具体工程约束与物理判据。\n\n## 2. 验证与拦截标准\n\n- **门禁与验证**：变更提交前由 AI 自主通过 \`arch-judge\` 语义审查。\n`;
      const createdRel = await callTauri<string>('create_agent_mind_rule', {
        relPath: cleanName,
        content: template,
      });
      setIsNewRuleOpen(false);
      setNewRuleName('');
      setNewRuleDesc('');
      pushToast(`已新建规则 ${createdRel}`, 'success');
      await loadOverview(true);
      if (createdRel) {
        await loadRuleFileDirect(createdRel, 'edit');
      }
    } catch (e: any) {
      pushToast(`创建规则失败: ${e}`, 'danger');
    } finally {
      setCreatingRule(false);
    }
  };

  // Initial load: 总览数据 + 默认直接加载主规则 rules/mind-rules.md
  useEffect(() => {
    loadOverview(true);
    loadRuleFileDirect('rules/mind-rules.md', 'preview');
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
        relPath: 'skills/dsh-review/SKILL.md',
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
      if (subTab === 'rules' && selectedRulePath && isRuleDirty && !savingFile) {
        e.preventDefault();
        handleSaveCurrentRule();
      } else if (subTab === 'projects' && activeProjectItem && projectDocPath && isProjectDirty && !savingProjectDoc) {
        e.preventDefault();
        handleSaveProjectDoc();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    subTab,
    selectedRulePath,
    isRuleDirty,
    savingFile,
    handleSaveCurrentRule,
    activeProjectItem,
    projectDocPath,
    isProjectDirty,
    savingProjectDoc,
    handleSaveProjectDoc,
  ]);

  const executeDeleteFile = async (relPath: string, source: 'review' | 'rule') => {
    setDeletingFile(true);
    try {
      await callTauri('delete_agent_mind_file', { relPath });
      pushToast(`已删除文件 ${relPath}`, 'success');
      if (source === 'review') {
        setConfirmDeleteReview(false);
        setActiveReviewView('list');
        setOpenedReview(null);
        setOpenedReviewRaw('');
        await loadOverview(true);
      } else {
        setConfirmDeleteRule(false);
        await loadOverview(true);
        await loadRuleFileDirect('rules/mind-rules.md', 'preview');
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
  const ruleFiles = useMemo(() => {
    const list = (overview?.files || []).filter(
      (f) => f.category === 'rules' && f.extension === 'md'
    );
    const rank = (rel: string) => (rel === 'rules/mind-rules.md' ? 0 : 1);
    return [...list].sort(
      (a, b) => rank(a.rel_path) - rank(b.rel_path) || a.rel_path.localeCompare(b.rel_path)
    );
  }, [overview]);

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

  const displayedReviewBody = useMemo(
    () => (reviewSourceMode === 'raw' ? openedReviewRaw.trim() : stripReviewFrontmatter(openedReviewRaw)),
    [reviewSourceMode, openedReviewRaw]
  );

  const canDeleteSelectedRule =
    selectedRulePath &&
    !PROTECTED_FILES.has(selectedRulePath) &&
    selectedRulePath.startsWith('rules/');

  const navItems: { id: typeof subTab; label: string; count?: number }[] = [
    { id: 'rules', label: '规则规范', count: ruleFiles.length || undefined },
    { id: 'reviews', label: '终审记录', count: allReviews.length || undefined },
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
                  agent-mind 治理面板
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
        <nav aria-label="Agent Mind 视图切换" className="flex items-center gap-6">
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
      {/* Tab 1 (首页): 规则规范 — 默认直接呈现主规则 rules/mind-rules.md */}
      {/* ================================================================= */}
      {subTab === 'rules' && (
        <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex flex-col">
          {/* 卡片头栏：主规则及扩展规则切换 + 阅读/编辑/新建/保存（完全对齐映射页 px-4 py-2.5 规范） */}
          <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {ruleFiles.map((f) => {
                const active = selectedRulePath === f.rel_path;
                const isMaster = f.rel_path === 'rules/mind-rules.md';
                return (
                  <button
                    key={f.rel_path}
                    onClick={() => requestSwitchRule(f.rel_path)}
                    title={f.rel_path}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                        : 'text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60'
                    }`}
                  >
                    <span>{getRuleTabLabel(f)}</span>
                    <span className="text-[10px] font-mono text-muted/85">{f.name}</span>
                    {isMaster && (
                      <span className="text-[9.5px] font-mono px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/70 text-muted">
                        主规则
                      </span>
                    )}
                  </button>
                );
              })}

              <button
                onClick={() => setIsNewRuleOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary/60 transition-colors cursor-pointer"
              >
                {isNewRuleOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                <span>{isNewRuleOpen ? '收起' : '新建规则'}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
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
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
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
                  onConfirm={() => executeDeleteFile(selectedRulePath, 'rule')}
                />
              )}

              <Button
                size="sm"
                variant="outline"
                isPending={loadingFile}
                className="h-7 px-2.5 rounded-lg text-[11px]"
                onPress={() => requestSwitchRule(selectedRulePath)}
              >
                重载
              </Button>

              <Button
                size="sm"
                variant="primary"
                isPending={savingFile}
                isDisabled={!isRuleDirty && !savingFile}
                className="h-7 px-3 rounded-lg text-[11px]"
                onPress={handleSaveCurrentRule}
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存 (Ctrl+S)</span>
              </Button>
            </div>
          </div>

          {/* 原位新建规则条 */}
          {isNewRuleOpen && (
            <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-surface-secondary/35 border-b border-zinc-200/80 dark:border-border/60 flex flex-wrap items-center gap-2">
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

          {/* 原位未保存提示条 */}
          {pendingRuleSwitch && (
            <UnsavedInlineBar
              busy={savingFile}
              onSaveAndContinue={async () => {
                const next = pendingRuleSwitch;
                const ok = await handleSaveCurrentRule();
                if (ok && next) await loadRuleFileDirect(next);
              }}
              onDiscardAndContinue={() => loadRuleFileDirect(pendingRuleSwitch)}
              onCancel={() => setPendingRuleSwitch(null)}
            />
          )}

          {/* 主规则内容展示 / 编辑器 */}
          <div className="px-5 py-4">
            {loadingFile && !editorContent ? (
              <div className="py-16 text-center text-[11.5px] text-muted">正在加载 {selectedRulePath}...</div>
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
                    <span className="text-[10.5px]">执行 /dsh-review 后归档结果将自动呈现在此</span>
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
                <span className="font-mono text-[11px] text-muted">skills/dsh-review/SKILL.md</span>
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
      {/* Tab 3: 仓库地图 (同款 rounded-2xl + gap-3 卡片与原位阅读编辑) */}
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
