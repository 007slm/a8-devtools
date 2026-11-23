import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookMarked,
  BookOpen,
  Check,
  Clock,
  Edit3,
  Eye,
  FileText,
  FolderCog,
  FolderOpen,
  Inbox,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCw,
  Save,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import { MarkdownArticle } from './MarkdownArticle';
import { PortalHero, type PortalHeroMetric } from './PortalHero';
import {
  launchConversationInAntigravity,
  type AntigravityLaunchResult,
} from '../utils/antigravityLauncher';

export interface BrainBacklink {
  rel_path: string;
  title: string;
  kind: 'page' | 'raw' | 'meta' | string;
}

export interface BrainWikiEntry {
  rel_path: string;
  slug: string;
  kind: 'page' | 'raw' | 'meta' | string;
  title: string;
  category: string;
  status: 'pending' | 'ingested' | '' | string;
  source: string;
  summary: string;
  tags: string[];
  sources: string[];
  created_at: string;
  updated_at: string;
  ingested_at: string;
  outbound_links: string[];
  broken_links: string[];
  backlinks: BrainBacklink[];
  size_bytes: number;
  modified_ts: number;
}

export interface BrainWikiStats {
  pages_count: number;
  raw_total: number;
  raw_pending: number;
  raw_ingested: number;
  categories_count: number;
  links_count: number;
  broken_links_count: number;
  orphan_pages_count: number;
}

export interface BrainWikiOverview {
  wiki_dir: string;
  default_wiki_dir: string;
  is_custom_dir: boolean;
  stats: BrainWikiStats;
  categories: string[];
  meta_files: BrainWikiEntry[];
  pages: BrainWikiEntry[];
  raw_notes: BrainWikiEntry[];
}

interface BrainWikiViewProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  isStandalone?: boolean;
}

type BrainSubTab = 'wiki' | 'inbox' | 'meta';
type RawStatusFilter = 'all' | 'pending' | 'ingested';

function formatTsShort(ts: number, fallbackStr?: string): string {
  if (fallbackStr && fallbackStr.trim()) return fallbackStr.trim();
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildClientBrainPrompt(
  wikiDir: string,
  mode: 'ingest' | 'brainstorm' | 'lint',
  relPath?: string,
  topic?: string
): { title: string; prompt: string } {
  if (mode === 'ingest') {
    const rp = (relPath || '').trim();
    if (rp) {
      const stem = (rp.split('/').pop() || rp).replace(/\.md$/i, '');
      return {
        title: `A8 Brain 整理素材 (${stem})`,
        prompt: `/a8-brain 请按整理归档模式（Mode 2 Ingest）处理知识库 \`${wikiDir}\` 中的原始素材 \`${rp}\`：先读 \`SCHEMA.md\` 与 \`index.md\`，提炼核心观点与方法论，写入或合并到 \`pages/\` 并建立 \`[[slug]]\` 双向链接，同步更新 \`index.md\`、\`log.md\`，最后将该 raw 素材标记为 \`status: ingested\`（保留原始正文不变）。`,
      };
    }
    return {
      title: 'A8 Brain 批量整理待归档素材',
      prompt: `/a8-brain 请按整理归档模式（Mode 2 Ingest）扫描知识库 \`${wikiDir}\` 下 \`raw/\` 目录中所有 \`status: pending\` 的待整理素材：先读 \`SCHEMA.md\` 与 \`index.md\`，逐篇消化提炼后写入或合并到 \`pages/\` 并建立 \`[[slug]]\` 双向链接，同步更新 \`index.md\`、\`log.md\` 并将已处理素材标记为 \`status: ingested\`。`,
    };
  }
  if (mode === 'lint') {
    return {
      title: 'A8 Brain 知识库体检',
      prompt: `/a8-brain 请按知识库体检模式（Mode 3 Lint）对 \`${wikiDir}\` 执行一次全面健康巡检：检查断链 \`[[target]]\`、孤立页面、未登进 \`index.md\` 的漏网页面、概念重复或观点冲突以及待整理积压，先给出清晰体检报告再按确认修复。`,
    };
  }
  const cleanTopic = (topic || '').trim();
  if (cleanTopic) {
    return {
      title: `A8 头脑风暴：${Array.from(cleanTopic).slice(0, 28).join('')}`,
      prompt: `/a8-brain 请先读取知识库 \`${wikiDir}\` 的 \`index.md\`，挑选最相关的 2～5 篇 \`pages/\` 条目精读，然后结合库中沉淀的原则、模式与玩法，围绕以下主题展开结构化头脑风暴并显式引用 \`[[slug]]\`：\n\n${cleanTopic}`,
    };
  }
  return {
    title: 'A8 头脑风暴',
    prompt: `/a8-brain 请先读取知识库 \`${wikiDir}\` 的 \`index.md\` 了解我已沉淀的方法论与主题脉络，准备好随时和我展开头脑风暴；简短告诉我目前库里有哪些核心思维武器可以调用。`,
  };
}

export function BrainWikiView({ callTauri, pushToast, isStandalone = false }: BrainWikiViewProps) {
  const [overview, setOverview] = useState<BrainWikiOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<BrainSubTab>('wiki');
  const [listOpen, setListOpen] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [rawFilter, setRawFilter] = useState<RawStatusFilter>('all');

  const [activeRelPath, setActiveRelPath] = useState<string>('');
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteRel, setConfirmDeleteRel] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Quick-capture raw note modal
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capTitle, setCapTitle] = useState('');
  const [capSource, setCapSource] = useState('');
  const [capTags, setCapTags] = useState('');
  const [capContent, setCapContent] = useState('');
  const [capSubmitting, setCapSubmitting] = useState(false);

  // Brainstorm topic modal
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [brainstormTopic, setBrainstormTopic] = useState('');

  // Wiki directory config modal
  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [dirInput, setDirInput] = useState('');
  const [dirSaving, setDirSaving] = useState(false);

  const allEntries = useMemo(() => {
    if (!overview) return [] as BrainWikiEntry[];
    return [...overview.pages, ...overview.raw_notes, ...overview.meta_files];
  }, [overview]);

  const entryByRel = useMemo(() => {
    const map = new Map<string, BrainWikiEntry>();
    for (const e of allEntries) map.set(e.rel_path, e);
    return map;
  }, [allEntries]);

  const resolveWikiTarget = useCallback(
    (rawTarget: string): BrainWikiEntry | null => {
      const cleaned = rawTarget
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .split('#')[0]
        .trim();
      if (!cleaned) return null;
      const lower = cleaned.toLowerCase();
      const lowerMd = lower.endsWith('.md') ? lower : `${lower}.md`;

      // Exact rel_path match
      for (const e of allEntries) {
        const er = e.rel_path.toLowerCase();
        if (er === lowerMd || er === `pages/${lowerMd}` || er === `raw/${lowerMd}`) {
          return e;
        }
      }
      // Slug match (prefer pages)
      const slugKey = lower.replace(/\.md$/, '').split('/').pop() || '';
      const pageSlugHit = allEntries.find(
        (e) => e.kind === 'page' && e.slug.toLowerCase() === slugKey
      );
      if (pageSlugHit) return pageSlugHit;
      const anySlugHit = allEntries.find((e) => e.slug.toLowerCase() === slugKey);
      if (anySlugHit) return anySlugHit;

      // Title match
      return allEntries.find((e) => e.title.toLowerCase() === lower) || null;
    },
    [allEntries]
  );

  const isWikiLinkResolved = useCallback(
    (target: string) => Boolean(resolveWikiTarget(target)),
    [resolveWikiTarget]
  );

  const loadFile = useCallback(
    async (relPath: string, opts?: { pushHistory?: boolean; switchTabForEntry?: BrainWikiEntry }) => {
      if (!relPath) {
        setActiveRelPath('');
        setContent('');
        return;
      }
      if (opts?.pushHistory && activeRelPath && activeRelPath !== relPath) {
        setNavHistory((prev) => [...prev.slice(-15), activeRelPath]);
      }
      if (opts?.switchTabForEntry) {
        const k = opts.switchTabForEntry.kind;
        if (k === 'page') setSubTab('wiki');
        else if (k === 'raw') setSubTab('inbox');
        else setSubTab('meta');
      }
      setActiveRelPath(relPath);
      setIsEditing(false);
      setConfirmDeleteRel(null);
      setContentLoading(true);
      try {
        const text = await callTauri<string>('read_brain_wiki_file', { relPath });
        setContent(text ?? '');
      } catch (e: unknown) {
        pushToast(`读取词条失败: ${e}`, 'danger');
      } finally {
        setContentLoading(false);
      }
    },
    [activeRelPath, callTauri, pushToast]
  );

  const loadOverview = useCallback(
    async (silent = true, selectRelPath?: string) => {
      setLoading(true);
      try {
        const data = await callTauri<BrainWikiOverview>('get_brain_wiki_overview');
        if (!data) return;
        setOverview(data);
        setDirInput(data.is_custom_dir ? data.wiki_dir : '');

        const pool = [...data.pages, ...data.raw_notes, ...data.meta_files];
        const targetRel =
          selectRelPath ||
          (activeRelPath && pool.some((e) => e.rel_path === activeRelPath) ? activeRelPath : '') ||
          data.pages[0]?.rel_path ||
          data.raw_notes[0]?.rel_path ||
          data.meta_files[0]?.rel_path ||
          '';

        if (targetRel) {
          const hit = pool.find((e) => e.rel_path === targetRel);
          if (!activeRelPath && hit) {
            if (hit.kind === 'raw' && data.pages.length === 0) setSubTab('inbox');
            else if (hit.kind === 'meta' && data.pages.length === 0 && data.raw_notes.length === 0) {
              setSubTab('meta');
            }
          }
          await loadFile(targetRel);
        } else {
          setActiveRelPath('');
          setContent('');
        }
        if (!silent) pushToast('知识大脑已刷新', 'success');
      } catch (e: unknown) {
        pushToast(`加载知识大脑失败: ${e}`, 'danger');
      } finally {
        setLoading(false);
      }
    },
    [activeRelPath, callTauri, loadFile, pushToast]
  );

  useEffect(() => {
    void loadOverview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeEntry = useMemo(
    () => (activeRelPath ? entryByRel.get(activeRelPath) || null : null),
    [activeRelPath, entryByRel]
  );

  const filteredPages = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    return overview.pages.filter((p) => {
      if (selectedCategory === '__ISSUES__') {
        const isOrphan =
          !p.outbound_links.some((o) => o.startsWith('pages/')) &&
          !p.backlinks.some((b) => b.kind === 'page');
        if (p.broken_links.length === 0 && !isOrphan) return false;
      } else if (selectedCategory !== 'ALL' && p.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [overview, searchQuery, selectedCategory]);

  const filteredRawNotes = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    return overview.raw_notes.filter((r) => {
      if (rawFilter !== 'all' && r.status !== rawFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [overview, rawFilter, searchQuery]);

  const handleOpenWikiTarget = useCallback(
    (target: string) => {
      const hit = resolveWikiTarget(target);
      if (!hit) {
        pushToast(`未找到词条 [[${target}]]，可点击「知识库体检」修复断链`, 'info');
        return;
      }
      void loadFile(hit.rel_path, { pushHistory: true, switchTabForEntry: hit });
    },
    [loadFile, pushToast, resolveWikiTarget]
  );

  const handleGoBack = () => {
    if (navHistory.length === 0) return;
    const prevRel = navHistory[navHistory.length - 1];
    setNavHistory((h) => h.slice(0, -1));
    const entry = entryByRel.get(prevRel);
    void loadFile(prevRel, { switchTabForEntry: entry });
  };

  const handleStartEdit = () => {
    setDraftContent(content);
    setIsEditing(true);
  };

  const handleSaveEdit = useCallback(async () => {
    if (!activeRelPath) return;
    setSaving(true);
    try {
      await callTauri('save_brain_wiki_file', {
        relPath: activeRelPath,
        content: draftContent,
      });
      setContent(draftContent);
      setIsEditing(false);
      pushToast('已保存修改', 'success');
      await loadOverview(true, activeRelPath);
    } catch (e: unknown) {
      pushToast(`保存失败: ${e}`, 'danger');
    } finally {
      setSaving(false);
    }
  }, [activeRelPath, callTauri, draftContent, loadOverview, pushToast]);

  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveEdit, isEditing]);

  const handleDeleteEntry = async (relPath: string) => {
    setDeleting(true);
    try {
      await callTauri('delete_brain_wiki_file', { relPath });
      pushToast('已删除条目', 'success');
      setConfirmDeleteRel(null);
      setActiveRelPath('');
      setContent('');
      await loadOverview(true);
    } catch (e: unknown) {
      pushToast(`删除失败: ${e}`, 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const handleLaunchAntigravity = useCallback(
    async (mode: 'ingest' | 'brainstorm' | 'lint', opts?: { relPath?: string; topic?: string }) => {
      const wikiDir = overview?.wiki_dir || 'plugins/a8-agent-mind/wiki';
      const { title, prompt } = buildClientBrainPrompt(wikiDir, mode, opts?.relPath, opts?.topic);
      setLaunching(true);
      try {
        const res = await launchConversationInAntigravity({
          isStandalone,
          title,
          prompt,
          fallbackInvoke: () =>
            callTauri<AntigravityLaunchResult>('launch_brain_in_antigravity', {
              mode,
              relPath: opts?.relPath || undefined,
              topic: opts?.topic || undefined,
              title,
              prompt,
            }),
        });
        const label =
          mode === 'ingest' ? '整理归档' : mode === 'lint' ? '知识库体检' : 'A8 头脑风暴';
        pushToast(
          res.focused_antigravity
            ? `已回到 Antigravity 发起「${label}」`
            : `已在 Antigravity 创建「${label}」会话`,
          'success'
        );
      } catch (e: unknown) {
        pushToast(`唤起 Antigravity 失败: ${e}`, 'danger');
      } finally {
        setLaunching(false);
      }
    },
    [callTauri, isStandalone, overview?.wiki_dir, pushToast]
  );

  const handleSubmitCapture = async (andOrganize: boolean) => {
    const cleanTitle = capTitle.trim();
    const cleanContent = capContent.trim();
    if (!cleanTitle || !cleanContent) {
      pushToast('请填写标题与素材正文', 'danger');
      return;
    }
    const tags = capTags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    setCapSubmitting(true);
    try {
      const created = await callTauri<BrainWikiEntry>('create_brain_raw_note', {
        title: cleanTitle,
        source: capSource.trim() || undefined,
        tags,
        content: cleanContent,
      });
      setCaptureOpen(false);
      setCapTitle('');
      setCapSource('');
      setCapTags('');
      setCapContent('');
      setSubTab('inbox');
      pushToast('素材已写入收件箱 (raw/)', 'success');
      if (created?.rel_path) {
        await loadOverview(true, created.rel_path);
        if (andOrganize) {
          await handleLaunchAntigravity('ingest', { relPath: created.rel_path });
        }
      } else {
        await loadOverview(true);
      }
    } catch (e: unknown) {
      pushToast(`写入素材失败: ${e}`, 'danger');
    } finally {
      setCapSubmitting(false);
    }
  };

  const handleSaveWikiDir = async (resetToDefault = false) => {
    setDirSaving(true);
    try {
      const nextVal = resetToDefault ? '' : dirInput.trim();
      const updated = await callTauri<BrainWikiOverview>('set_brain_wiki_dir', {
        wikiDir: nextVal,
      });
      if (updated) {
        setOverview(updated);
        setDirInput(updated.is_custom_dir ? updated.wiki_dir : '');
      }
      setDirModalOpen(false);
      pushToast(resetToDefault ? '已恢复默认知识库目录' : '知识库目录已更新', 'success');
      await loadOverview(true);
    } catch (e: unknown) {
      pushToast(`切换目录失败: ${e}`, 'danger');
    } finally {
      setDirSaving(false);
    }
  };

  const handlePickWikiDir = async () => {
    if (isStandalone) return;
    try {
      const picked = await callTauri<string | null>('pick_folder');
      if (picked) setDirInput(picked);
    } catch (e: unknown) {
      pushToast(`选择目录失败: ${e}`, 'danger');
    }
  };

  const stats = overview?.stats;
  const issuesTotal = (stats?.broken_links_count || 0) + (stats?.orphan_pages_count || 0);

  const heroMetrics: PortalHeroMetric[] = [
    { label: 'Wiki 条目', value: stats?.pages_count ?? 0 },
    {
      label: '待整理素材',
      value: stats?.raw_pending ?? 0,
      tone: (stats?.raw_pending ?? 0) > 0 ? 'amber' : 'emerald',
      hint: `收件箱共 ${stats?.raw_total ?? 0} 条，已归档 ${stats?.raw_ingested ?? 0} 条`,
    },
    { label: '知识互链', value: stats?.links_count ?? 0, tone: 'blue' },
    {
      label: '断链 / 孤立',
      value: `${stats?.broken_links_count ?? 0} / ${stats?.orphan_pages_count ?? 0}`,
      tone: issuesTotal > 0 ? 'rose' : 'default',
    },
  ];

  const renderListItems = () => {
    if (subTab === 'wiki') {
      if (filteredPages.length === 0) {
        return (
          <div className="px-3 py-8 text-center">
            <BookOpen className="w-5 h-5 text-muted mx-auto mb-2 opacity-60" />
            <p className="text-[11.5px] font-medium text-foreground">
              {overview?.pages.length ? '没有匹配的 Wiki 条目' : 'Wiki 知识库还是空的'}
            </p>
            <p className="text-[10.5px] text-muted mt-1 leading-relaxed">
              先点击右上角「+ 随手记」贴入 Twitter 帖子、文章或思考，再一键「回 Antigravity 整理」自动分类建链。
            </p>
          </div>
        );
      }
      return filteredPages.map((p) => {
        const active = p.rel_path === activeRelPath;
        const isOrphan =
          !p.outbound_links.some((o) => o.startsWith('pages/')) &&
          !p.backlinks.some((b) => b.kind === 'page');
        return (
          <button
            key={p.rel_path}
            type="button"
            onClick={() => void loadFile(p.rel_path)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
              active
                ? 'bg-zinc-100/85 dark:bg-surface-secondary/80 border-zinc-300 dark:border-zinc-600'
                : 'bg-transparent border-transparent hover:bg-zinc-50 dark:hover:bg-surface-secondary/40 hover:border-zinc-200/70 dark:hover:border-border/60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">
                {p.title}
              </span>
              {p.broken_links.length > 0 ? (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-rose-500/12 text-rose-700 dark:text-rose-300 border border-rose-500/25">
                  断链 {p.broken_links.length}
                </span>
              ) : isOrphan ? (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                  孤立
                </span>
              ) : null}
            </div>
            {p.summary && (
              <p className="text-[10.5px] text-muted mt-1 line-clamp-2 leading-relaxed">
                {p.summary}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {p.category && (
                <span className="px-1.5 py-0.25 rounded-md text-[9.5px] bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border border-zinc-200/70 dark:border-border/60">
                  {p.category}
                </span>
              )}
              {p.backlinks.length > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9.5px] font-mono text-blue-700 dark:text-blue-400">
                  <Link2 className="w-2.5 h-2.5" />
                  {p.backlinks.length}
                </span>
              )}
              {p.tags.slice(0, 2).map((t) => (
                <span key={t} className="text-[9.5px] font-mono text-muted">
                  #{t}
                </span>
              ))}
            </div>
          </button>
        );
      });
    }

    if (subTab === 'inbox') {
      if (filteredRawNotes.length === 0) {
        return (
          <div className="px-3 py-8 text-center">
            <Inbox className="w-5 h-5 text-muted mx-auto mb-2 opacity-60" />
            <p className="text-[11.5px] font-medium text-foreground">收件箱暂无匹配素材</p>
            <p className="text-[10.5px] text-muted mt-1">
              点击「+ 随手记」把看到的 Twitter 帖子、技术文章或灵感先丢进来。
            </p>
          </div>
        );
      }
      return filteredRawNotes.map((r) => {
        const active = r.rel_path === activeRelPath;
        const isPending = r.status === 'pending';
        return (
          <button
            key={r.rel_path}
            type="button"
            onClick={() => void loadFile(r.rel_path)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
              active
                ? 'bg-zinc-100/85 dark:bg-surface-secondary/80 border-zinc-300 dark:border-zinc-600'
                : 'bg-transparent border-transparent hover:bg-zinc-50 dark:hover:bg-surface-secondary/40 hover:border-zinc-200/70 dark:hover:border-border/60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">
                {r.title}
              </span>
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[9.5px] border ${
                  isPending
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                }`}
              >
                {isPending ? '待整理' : '已归档'}
              </span>
            </div>
            {r.summary && (
              <p className="text-[10.5px] text-muted mt-1 line-clamp-2 leading-relaxed">
                {r.summary}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 mt-1.5 text-[9.5px] font-mono text-muted">
              <span className="truncate">{r.source || r.rel_path}</span>
              <span className="shrink-0">{formatTsShort(r.modified_ts, r.created_at)}</span>
            </div>
          </button>
        );
      });
    }

    // meta tab: index.md, log.md, SCHEMA.md
    return (
      <div className="space-y-1.5">
        {(overview?.meta_files || []).map((m) => {
          const active = m.rel_path === activeRelPath;
          const desc =
            m.rel_path === 'index.md'
              ? '全库分类目录，/a8-brain 低 Token 检索第一入口'
              : m.rel_path === 'log.md'
                ? '按时间追加的整理、体检与头脑风暴沉淀日志'
                : 'LLM Wiki 维护契约、分类与双链演进规范';
          return (
            <button
              key={m.rel_path}
              type="button"
              onClick={() => void loadFile(m.rel_path)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                active
                  ? 'bg-zinc-100/85 dark:bg-surface-secondary/80 border-zinc-300 dark:border-zinc-600'
                  : 'bg-transparent border-transparent hover:bg-zinc-50 dark:hover:bg-surface-secondary/40 hover:border-zinc-200/70 dark:hover:border-border/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold font-mono text-foreground">
                  {m.rel_path}
                </span>
                <span className="text-[9.5px] font-mono text-muted">
                  {(m.size_bytes / 1024).toFixed(1)} KB
                </span>
              </div>
              <p className="text-[10.5px] text-muted mt-1 leading-relaxed">{desc}</p>
            </button>
          );
        })}

        <div className="mt-3 p-3 rounded-xl border border-zinc-200/80 dark:border-border/70 bg-zinc-50/70 dark:bg-surface-secondary/30">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Stethoscope className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>知识库健康巡检</span>
          </div>
          <p className="text-[10.5px] text-muted mt-1 leading-relaxed">
            定期回到 Antigravity 执行 Lint，排查断链、孤立页面、未登索引项与概念冲突。
          </p>
          <Button
            size="sm"
            variant="outline"
            isPending={launching}
            className="mt-2.5 h-7 w-full rounded-lg text-[11px]"
            onPress={() => void handleLaunchAntigravity('lint')}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>回 Antigravity 体检 Wiki</span>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <PortalHero
        icon={<BookMarked className="w-4 h-4" />}
        eyebrow="A8 BRAIN · LLM WIKI"
        title="个人知识大脑"
        description="随时记录 Twitter 摘录、文章与方法论到 raw/，一键回到 Antigravity 自动整理分类建链；头脑风暴时按 index.md 低 Token 精准调取。"
        badge={
          <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-mono bg-zinc-100 dark:bg-surface-secondary border border-zinc-200/80 dark:border-border/70 text-muted">
            /a8-brain
          </span>
        }
        metrics={heroMetrics}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              className="h-7 px-2.5 rounded-lg text-[11px] whitespace-nowrap"
              onPress={() => setCaptureOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>随手记</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              isPending={launching}
              className={`h-7 px-2.5 rounded-lg text-[11px] whitespace-nowrap ${
                (stats?.raw_pending ?? 0) > 0
                  ? 'border-amber-500/45 text-amber-700 dark:text-amber-300'
                  : ''
              }`}
              onPress={() => void handleLaunchAntigravity('ingest')}
            >
              <Send className="w-3 h-3" />
              <span>
                回 Antigravity 整理
                {(stats?.raw_pending ?? 0) > 0 ? ` (${stats?.raw_pending})` : ''}
              </span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              isPending={launching}
              className="h-7 px-2.5 rounded-lg text-[11px] whitespace-nowrap"
              onPress={() => setBrainstormOpen(true)}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>头脑风暴</span>
            </Button>
            <button
              type="button"
              title={`配置知识库存储目录（当前：${overview?.wiki_dir || ''}）`}
              onClick={() => setDirModalOpen(true)}
              className="h-7 w-7 rounded-lg border border-zinc-200/85 dark:border-border/70 flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <FolderCog className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="在资源管理器打开知识库目录"
              onClick={() => void callTauri('open_brain_wiki_dir')}
              className="h-7 w-7 rounded-lg border border-zinc-200/85 dark:border-border/70 flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="刷新知识库"
              disabled={loading}
              onClick={() => void loadOverview(false)}
              className="h-7 w-7 rounded-lg border border-zinc-200/85 dark:border-border/70 flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      {/* 二级视图导航 + 物理目录微提示 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-zinc-100/80 dark:bg-surface-secondary/60 border border-zinc-200/80 dark:border-border/70">
          {(
            [
              { id: 'wiki' as const, label: 'Wiki 知识库', count: stats?.pages_count ?? 0, icon: BookOpen },
              {
                id: 'inbox' as const,
                label: '素材收件箱',
                count: stats?.raw_pending ?? 0,
                total: stats?.raw_total ?? 0,
                icon: Inbox,
              },
              { id: 'meta' as const, label: '索引与日志', count: overview?.meta_files.length ?? 3, icon: FileText },
            ]
          ).map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-surface font-semibold text-foreground border border-zinc-200/85 dark:border-border/80'
                    : 'text-muted hover:text-foreground border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.25 rounded-md text-[9.5px] font-mono ${
                    tab.id === 'inbox' && tab.count > 0
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-muted'
                  }`}
                >
                  {tab.id === 'inbox' ? `${tab.count}/${tab.total}` : tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {overview?.wiki_dir && (
          <button
            type="button"
            onClick={() => setDirModalOpen(true)}
            title="点击更改知识库目录"
            className="flex items-center gap-1.5 text-[10.5px] font-mono text-muted hover:text-foreground transition-colors cursor-pointer truncate max-w-[460px]"
          >
            <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-surface-secondary border border-zinc-200/75 dark:border-border/60 text-[9.5px]">
              {overview.is_custom_dir ? '自定义路径' : '默认本地'}
            </span>
            <span className="truncate">{overview.wiki_dir}</span>
          </button>
        )}
      </div>

      {/* 主工作区：收敛两栏（左列表可收起 + 右阅读/编辑/反向链接） */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {listOpen && (
          <aside className="lg:col-span-4 rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 flex flex-col overflow-hidden min-h-[540px] max-h-[calc(100vh-230px)]">
            {subTab !== 'meta' && (
              <div className="p-2.5 border-b border-zinc-200/75 dark:border-border/60 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      subTab === 'wiki' ? '搜索标题、摘要、标签或分类...' : '搜索收件箱标题、来源或标签...'
                    }
                    className="w-full h-7 pl-8 pr-7 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[11px] text-foreground placeholder:text-muted focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {subTab === 'wiki' && (
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('ALL')}
                      className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors cursor-pointer whitespace-nowrap ${
                        selectedCategory === 'ALL'
                          ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent font-medium'
                          : 'bg-transparent border-zinc-200/80 dark:border-border/70 text-muted hover:text-foreground'
                      }`}
                    >
                      全部 ({overview?.pages.length ?? 0})
                    </button>
                    {(overview?.categories || []).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors cursor-pointer whitespace-nowrap ${
                          selectedCategory === cat
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent font-medium'
                            : 'bg-transparent border-zinc-200/80 dark:border-border/70 text-muted hover:text-foreground'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                    {issuesTotal > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('__ISSUES__')}
                        className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors cursor-pointer whitespace-nowrap ${
                          selectedCategory === '__ISSUES__'
                            ? 'bg-rose-600 text-white border-transparent font-medium'
                            : 'bg-rose-500/8 border-rose-500/25 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        断链/孤立
                      </button>
                    )}
                  </div>
                )}

                {subTab === 'inbox' && (
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'all' as const, label: `全部 (${stats?.raw_total ?? 0})` },
                        { id: 'pending' as const, label: `待整理 (${stats?.raw_pending ?? 0})` },
                        { id: 'ingested' as const, label: `已归档 (${stats?.raw_ingested ?? 0})` },
                      ]
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setRawFilter(f.id)}
                        className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors cursor-pointer whitespace-nowrap ${
                          rawFilter === f.id
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent font-medium'
                            : 'bg-transparent border-zinc-200/80 dark:border-border/70 text-muted hover:text-foreground'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1">{renderListItems()}</div>
          </aside>
        )}

        {/* 右侧阅读器 / 编辑器 */}
        <section
          className={`${
            listOpen ? 'lg:col-span-8' : 'lg:col-span-12'
          } rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 flex flex-col overflow-hidden min-h-[540px] max-h-[calc(100vh-230px)]`}
        >
          {/* 顶栏 */}
          <div className="px-3.5 py-2.5 border-b border-zinc-200/75 dark:border-border/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                title={listOpen ? '收起左侧列表' : '展开左侧列表'}
                onClick={() => setListOpen((v) => !v)}
                className="h-7 w-7 rounded-lg border border-zinc-200/80 dark:border-border/70 flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer shrink-0"
              >
                {listOpen ? (
                  <PanelLeftClose className="w-3.5 h-3.5" />
                ) : (
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                )}
              </button>

              {navHistory.length > 0 && (
                <button
                  type="button"
                  onClick={handleGoBack}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-zinc-200/80 dark:border-border/70 text-[11px] text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary transition-colors cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>返回</span>
                </button>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-[13px] font-semibold text-foreground truncate">
                    {activeEntry?.title || '选择左侧条目查看'}
                  </h2>
                  {activeEntry?.kind === 'raw' && (
                    <span
                      className={`shrink-0 px-1.5 py-0.25 rounded text-[9.5px] border ${
                        activeEntry.status === 'pending'
                          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25'
                          : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                      }`}
                    >
                      {activeEntry.status === 'pending' ? '待整理' : '已归档'}
                    </span>
                  )}
                  {activeEntry?.category && (
                    <span className="shrink-0 px-1.5 py-0.25 rounded text-[9.5px] bg-zinc-100 dark:bg-zinc-800/80 text-muted border border-zinc-200/70 dark:border-border/60">
                      {activeEntry.category}
                    </span>
                  )}
                </div>
                {activeEntry && (
                  <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] font-mono text-muted">
                    <span>{activeEntry.rel_path}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTsShort(
                        activeEntry.modified_ts,
                        activeEntry.updated_at || activeEntry.created_at
                      )}
                    </span>
                    {activeEntry.source &&
                      (/^https?:\/\//i.test(activeEntry.source) ? (
                        <a
                          href={activeEntry.source}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[260px]"
                        >
                          <span className="truncate">{activeEntry.source}</span>
                          <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="truncate max-w-[220px]">来源: {activeEntry.source}</span>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {activeEntry && (
              <div className="flex items-center gap-1.5 shrink-0">
                {activeEntry.kind === 'raw' && !isEditing && (
                  <Button
                    size="sm"
                    variant="outline"
                    isPending={launching}
                    className="h-7 px-2.5 rounded-lg text-[11px] border-amber-500/40 text-amber-700 dark:text-amber-300 whitespace-nowrap"
                    onPress={() =>
                      void handleLaunchAntigravity('ingest', { relPath: activeEntry.rel_path })
                    }
                  >
                    <Send className="w-3 h-3" />
                    <span>回 Antigravity 整理此条</span>
                  </Button>
                )}

                {activeEntry.kind === 'page' && !isEditing && (
                  <Button
                    size="sm"
                    variant="outline"
                    isPending={launching}
                    className="h-7 px-2.5 rounded-lg text-[11px] whitespace-nowrap"
                    onPress={() => {
                      setBrainstormTopic(`结合 [[${activeEntry.slug}]]（${activeEntry.title}）展开分析：`);
                      setBrainstormOpen(true);
                    }}
                  >
                    <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span>以此头脑风暴</span>
                  </Button>
                )}

                {isEditing ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      isPending={saving}
                      className="h-7 px-2.5 rounded-lg text-[11px]"
                      onPress={() => void handleSaveEdit()}
                    >
                      <Save className="w-3 h-3" />
                      <span>保存</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 rounded-lg text-[11px]"
                      onPress={() => setIsEditing(false)}
                    >
                      <Eye className="w-3 h-3" />
                      <span>取消</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 rounded-lg text-[11px]"
                    onPress={handleStartEdit}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>编辑</span>
                  </Button>
                )}

                {activeEntry.kind !== 'meta' && !isEditing && (
                  confirmDeleteRel === activeEntry.rel_path ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteEntry(activeEntry.rel_path)}
                        className="h-7 px-2 rounded-lg bg-rose-600 text-white text-[10.5px] font-medium hover:bg-rose-700 cursor-pointer"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteRel(null)}
                        className="h-7 px-2 rounded-lg border border-zinc-200 dark:border-border text-[10.5px] text-muted hover:text-foreground cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="删除条目"
                      onClick={() => setConfirmDeleteRel(activeEntry.rel_path)}
                      className="h-7 w-7 rounded-lg border border-zinc-200/80 dark:border-border/70 flex items-center justify-center text-muted hover:text-rose-600 hover:border-rose-500/40 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* 正文区 */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {contentLoading ? (
              <div className="py-12 text-center text-[11.5px] text-muted">正在加载内容...</div>
            ) : !activeEntry ? (
              <div className="py-16 text-center space-y-2">
                <BookMarked className="w-7 h-7 text-muted mx-auto opacity-50" />
                <p className="text-[12.5px] font-semibold text-foreground">欢迎使用 A8 Brain 知识大脑</p>
                <p className="text-[11px] text-muted max-w-md mx-auto leading-relaxed">
                  平时看到有价值的 Twitter 帖子、Skill 玩法、多 Agent 协作心得或学习原则，随时点「随手记」扔进收件箱，再一键「回 Antigravity 整理」构建你的个人互链 Wiki。
                </p>
              </div>
            ) : isEditing ? (
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                spellCheck={false}
                className="w-full h-[420px] p-3 rounded-xl bg-zinc-50/70 dark:bg-surface-secondary/40 border border-zinc-200/85 dark:border-border/70 font-mono text-[11.5px] leading-relaxed text-foreground focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500 resize-y"
              />
            ) : (
              <>
                {activeEntry.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {activeEntry.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-zinc-100 dark:bg-surface-secondary border border-zinc-200/75 dark:border-border/60 text-muted"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <MarkdownArticle
                  content={content || '（空内容）'}
                  stripFrontmatter={activeEntry.kind !== 'meta'}
                  onOpenWikiLink={handleOpenWikiTarget}
                  onOpenDocLink={handleOpenWikiTarget}
                  isWikiLinkResolved={isWikiLinkResolved}
                />

                {/* 双向链接与来源脉络区 */}
                {(activeEntry.backlinks.length > 0 ||
                  activeEntry.outbound_links.length > 0 ||
                  activeEntry.broken_links.length > 0) && (
                  <div className="mt-6 pt-4 border-t border-zinc-200/80 dark:border-border/70 space-y-3">
                    {activeEntry.backlinks.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                          <Link2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          <span>反向引用 ({activeEntry.backlinks.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {activeEntry.backlinks.map((bl) => (
                            <button
                              key={bl.rel_path}
                              type="button"
                              onClick={() => handleOpenWikiTarget(bl.rel_path)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-foreground hover:border-blue-500/45 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
                            >
                              <span>{bl.title}</span>
                              <span className="text-[9.5px] font-mono text-muted">
                                {bl.kind === 'raw' ? 'raw' : 'wiki'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeEntry.outbound_links.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                          <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>关联条目与来源 ({activeEntry.outbound_links.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {activeEntry.outbound_links.map((outRel) => {
                            const targetEntry = entryByRel.get(outRel);
                            return (
                              <button
                                key={outRel}
                                type="button"
                                onClick={() => handleOpenWikiTarget(outRel)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-foreground hover:border-emerald-500/45 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
                              >
                                <span>{targetEntry?.title || outRel}</span>
                                <span className="text-[9.5px] font-mono text-muted">
                                  {outRel.startsWith('raw/') ? '原始素材' : 'wiki'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeEntry.broken_links.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-wider mb-1.5">
                          <AlertTriangle className="w-3 h-3" />
                          <span>未解析断链 ({activeEntry.broken_links.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {activeEntry.broken_links.map((b) => (
                            <span
                              key={b}
                              className="px-2 py-0.5 rounded-lg text-[10.5px] font-mono bg-rose-500/10 border border-rose-500/30 border-dashed text-rose-700 dark:text-rose-300"
                            >
                              [[{b}]]
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* 弹窗 1：随手记（新建 raw/ 素材） */}
      {captureOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-surface border border-zinc-200 dark:border-border shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-border/70 flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">随手记 · 写入原始素材收件箱</h3>
                <p className="text-[10.5px] text-muted mt-0.5">
                  直接粘贴 Twitter 帖子、文章摘录、Skill/Subagent 玩法或灵感，原文保存于 raw/ 目录
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCaptureOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-foreground mb-1">标题 *</label>
                <input
                  type="text"
                  value={capTitle}
                  onChange={(e) => setCapTitle(e.target.value)}
                  placeholder="例如：Karpathy LLM Wiki 与 Subagent 上下文隔离心得"
                  className="w-full h-8 px-3 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[12px] text-foreground focus:outline-none focus:border-zinc-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    来源链接 / 出处（可选）
                  </label>
                  <input
                    type="text"
                    value={capSource}
                    onChange={(e) => setCapSource(e.target.value)}
                    placeholder="https://x.com/... 或 随手记"
                    className="w-full h-8 px-3 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[11.5px] font-mono text-foreground focus:outline-none focus:border-zinc-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    初始标签（逗号或空格分隔，可选）
                  </label>
                  <input
                    type="text"
                    value={capTags}
                    onChange={(e) => setCapTags(e.target.value)}
                    placeholder="subagent, skill, learning"
                    className="w-full h-8 px-3 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[11.5px] font-mono text-foreground focus:outline-none focus:border-zinc-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-foreground mb-1">
                  正文内容 *（支持粘贴原文与 Markdown）
                </label>
                <textarea
                  value={capContent}
                  onChange={(e) => setCapContent(e.target.value)}
                  rows={9}
                  placeholder="把读到的文章段落、推文观点或你自己的思考直接贴在这里..."
                  className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-zinc-400 resize-y"
                />
              </div>
            </div>

            <div className="px-4 py-3 border-t border-zinc-200/80 dark:border-border/70 flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 rounded-lg text-[11.5px]"
                onPress={() => setCaptureOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="outline"
                isPending={capSubmitting}
                className="h-8 px-3 rounded-lg text-[11.5px]"
                onPress={() => void handleSubmitCapture(false)}
              >
                <Check className="w-3.5 h-3.5" />
                <span>仅存入收件箱</span>
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={capSubmitting}
                className="h-8 px-3.5 rounded-lg text-[11.5px]"
                onPress={() => void handleSubmitCapture(true)}
              >
                <Send className="w-3.5 h-3.5" />
                <span>保存并回 Antigravity 整理</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 2：发起头脑风暴 */}
      {brainstormOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-surface border border-zinc-200 dark:border-border shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-border/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-[13px] font-semibold text-foreground">发起 A8 头脑风暴 (/a8-brain)</h3>
              </div>
              <button
                type="button"
                onClick={() => setBrainstormOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2.5">
              <p className="text-[11px] text-muted leading-relaxed">
                Antigravity 将先读 <code className="font-mono">index.md</code>，挑选最相关的 2～5 篇 Wiki 条目精读，结合你存下来的方法论与玩法来一起拆解分析。
              </p>
              <textarea
                value={brainstormTopic}
                onChange={(e) => setBrainstormTopic(e.target.value)}
                rows={4}
                placeholder="输入你想分析的问题、架构构想或学习主题（留空则直接检阅库中可用思维武器）..."
                className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-zinc-400"
              />
            </div>

            <div className="px-4 py-3 border-t border-zinc-200/80 dark:border-border/70 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 rounded-lg text-[11.5px]"
                onPress={() => setBrainstormOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={launching}
                className="h-8 px-3.5 rounded-lg text-[11.5px]"
                onPress={async () => {
                  const topic = brainstormTopic.trim();
                  setBrainstormOpen(false);
                  await handleLaunchAntigravity('brainstorm', { topic });
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>在 Antigravity 发起</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 3：知识库目录设置 */}
      {dirModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-surface border border-zinc-200 dark:border-border shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-border/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderCog className="w-4 h-4 text-foreground" />
                <h3 className="text-[13px] font-semibold text-foreground">知识库物理存储路径 (config.json)</h3>
              </div>
              <button
                type="button"
                onClick={() => setDirModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-[11px] text-muted leading-relaxed">
                默认存放在 <code className="font-mono text-foreground">{overview?.default_wiki_dir}</code>（已加入 <code className="font-mono">.gitignore</code> 仅本地保存）。你也可以改指向任意外部目录或独立私有 Git 仓库。
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  placeholder={overview?.default_wiki_dir || '留空则使用默认路径'}
                  className="flex-1 h-8 px-3 rounded-lg bg-zinc-50 dark:bg-surface-secondary/50 border border-zinc-200/85 dark:border-border/70 font-mono text-[11.5px] text-foreground focus:outline-none focus:border-zinc-400"
                />
                {!isStandalone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 rounded-lg text-[11px] shrink-0"
                    onPress={() => void handlePickWikiDir()}
                  >
                    浏览...
                  </Button>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-zinc-200/80 dark:border-border/70 flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                isPending={dirSaving}
                className="h-8 px-3 rounded-lg text-[11px]"
                onPress={() => void handleSaveWikiDir(true)}
              >
                恢复默认路径
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 rounded-lg text-[11px]"
                  onPress={() => setDirModalOpen(false)}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  isPending={dirSaving}
                  className="h-8 px-3.5 rounded-lg text-[11px]"
                  onPress={() => void handleSaveWikiDir(false)}
                >
                  保存路径
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
