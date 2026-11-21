import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';

export interface RepoDocEntry {
  repo: string;
  doc_tier: 'glossary' | 'evergreen' | 'record' | 'deferred' | 'other' | string;
  doc_type: string;
  title: string;
  date: string;
  status: string;
  rel_path: string;
  abs_path: string;
  size_bytes: number;
  estimated_tokens: number;
  modified_ts: number;
}

interface RepoDocsBrowserProps {
  docs: RepoDocEntry[];
  allRepoDocs?: RepoDocEntry[];
  variant?: 'evergreen' | 'docs' | 'all';
  showRepoBadge?: boolean;
  emptyHint?: string;
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  renderArticle: (content: string, onOpenDocLink: (href: string) => void) => ReactNode;
}

function getDocKindTag(doc: RepoDocEntry): { label: string; cls: string } {
  if (doc.doc_tier === 'glossary') {
    return {
      label: '术语表',
      cls: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-400 border-cyan-500/25',
    };
  }
  if (doc.doc_tier === 'evergreen') {
    return {
      label: '常青',
      cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    };
  }
  if (doc.status.startsWith('已废弃')) {
    return {
      label: '已废弃',
      cls: 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/25',
    };
  }
  if (doc.doc_tier === 'deferred' || doc.status.startsWith('已暂缓')) {
    return {
      label: '暂缓',
      cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
    };
  }
  if (doc.doc_type === 'ADR') {
    return {
      label: 'ADR',
      cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25',
    };
  }
  if (doc.doc_type === 'BUG') {
    return {
      label: 'BUG',
      cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25',
    };
  }
  if (doc.doc_type === 'SPEC') {
    return {
      label: 'SPEC',
      cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
    };
  }
  return {
    label: doc.doc_type || 'DOC',
    cls: 'bg-zinc-100 dark:bg-surface-secondary text-muted border-zinc-200/80 dark:border-border/70',
  };
}

function getStatusAlert(status: string): {
  kind: 'deprecated' | 'partial' | null;
  shortLabel: string;
  badgeCls: string;
} {
  if (status.startsWith('已废弃')) {
    return {
      kind: 'deprecated',
      shortLabel: '已废弃',
      badgeCls: 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/25',
    };
  }
  if (status.startsWith('部分失效')) {
    return {
      kind: 'partial',
      shortLabel: '部分失效',
      badgeCls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
    };
  }
  return { kind: null, shortLabel: '', badgeCls: '' };
}

function formatKb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function resolveRelativeDocPath(currentRelPath: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0].trim().replace(/\\/g, '/');
  if (!cleanHref || cleanHref.startsWith('http://') || cleanHref.startsWith('https://')) {
    return '';
  }
  if (cleanHref.startsWith('file:///')) {
    return '';
  }
  if (cleanHref.startsWith('docs/')) {
    return cleanHref;
  }
  const baseParts = currentRelPath.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const seg of cleanHref.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      baseParts.pop();
    } else {
      baseParts.push(seg);
    }
  }
  return baseParts.join('/');
}

/**
 * 结构化文档浏览器：
 * - variant="evergreen"：聚焦常青架构文档与置顶共享术语表（点击文内回链可顺藤下钻并原位返回）
 * - variant="docs"：仅列出非常青/非术语表的 docs/ 文档（工作记录 / 暂缓 / 废弃等），不重复列常青与术语表
 * - variant="all"：全部 docs/ 平铺视图，靠简洁 Tag 直观表达类型与状态（术语表置顶）
 */
export function RepoDocsBrowser({
  docs,
  allRepoDocs,
  variant = 'all',
  showRepoBadge = false,
  emptyHint = '暂无文档',
  callTauri,
  pushToast,
  renderArticle,
}: RepoDocsBrowserProps) {
  const [listOpen, setListOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [docContent, setDocContent] = useState<string>('');
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const baseDocs = useMemo(() => {
    if (variant === 'evergreen') {
      return docs.filter((d) => d.doc_tier === 'glossary' || d.doc_tier === 'evergreen');
    }
    if (variant === 'docs') {
      return docs.filter((d) => d.doc_tier !== 'evergreen' && d.doc_tier !== 'glossary');
    }
    return docs;
  }, [docs, variant]);

  const filteredDocs = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return baseDocs;
    return baseDocs.filter(
      (d) =>
        d.title.toLowerCase().includes(kw) ||
        d.rel_path.toLowerCase().includes(kw) ||
        d.doc_type.toLowerCase().includes(kw) ||
        getDocKindTag(d).label.toLowerCase().includes(kw) ||
        d.status.toLowerCase().includes(kw) ||
        d.date.toLowerCase().includes(kw) ||
        d.repo.toLowerCase().includes(kw)
    );
  }, [baseDocs, search]);

  const docKey = (d: RepoDocEntry) => `${d.repo}::${d.rel_path}`;

  useEffect(() => {
    if (filteredDocs.length === 0) {
      setSelectedKey('');
      setDocContent('');
      setDocError(null);
      return;
    }
    const pool = allRepoDocs || docs;
    const isHistoryJump = historyStack.length > 0 && pool.some((d) => docKey(d) === selectedKey);
    if (!selectedKey || (!isHistoryJump && !filteredDocs.some((d) => docKey(d) === selectedKey))) {
      setSelectedKey(docKey(filteredDocs[0]));
      setHistoryStack([]);
    }
  }, [filteredDocs, selectedKey, historyStack.length, allRepoDocs, docs]);

  const activeDoc = useMemo(() => {
    const pool = allRepoDocs || docs;
    return pool.find((d) => docKey(d) === selectedKey) || filteredDocs[0] || null;
  }, [allRepoDocs, docs, filteredDocs, selectedKey]);

  useEffect(() => {
    if (!activeDoc) return;
    let alive = true;
    setLoadingDoc(true);
    setDocError(null);
    callTauri<string>('read_agent_mind_file', {
      relPath: activeDoc.rel_path,
      repoCode: activeDoc.repo,
    })
      .then((raw) => {
        if (!alive) return;
        setDocContent(raw || '');
      })
      .catch((e: any) => {
        if (!alive) return;
        setDocContent('');
        setDocError(String(e?.message || e || '读取文档失败'));
      })
      .finally(() => {
        if (alive) setLoadingDoc(false);
      });
    return () => {
      alive = false;
    };
  }, [activeDoc, callTauri]);

  const handleOpenDocLink = (href: string) => {
    if (!activeDoc) return;
    const resolved = resolveRelativeDocPath(activeDoc.rel_path, href);
    if (!resolved) {
      pushToast(`外部或绝对路径链接：${href}`, 'info');
      return;
    }
    const pool = (allRepoDocs || docs).filter((d) => d.repo === activeDoc.repo);
    const target = pool.find((d) => d.rel_path.toLowerCase() === resolved.toLowerCase());
    if (!target) {
      pushToast(`未找到文档：${resolved}`, 'info');
      return;
    }
    setHistoryStack((prev) => [...prev.slice(-15), docKey(activeDoc)]);
    setSelectedKey(docKey(target));
  };

  const handleGoBack = () => {
    if (historyStack.length === 0) return;
    const prevKey = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    setSelectedKey(prevKey);
  };

  if (baseDocs.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted text-[11.5px]">
        <BookOpen className="w-6 h-6 opacity-35" />
        <span>{emptyHint}</span>
      </div>
    );
  }

  const showSearchBar = variant !== 'evergreen' || baseDocs.length > 6;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
      {/* 左侧列表（支持一键收起为沉浸阅读）：用 Tag 表达文档类型与状态，不做冗余分类 */}
      {listOpen && (
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-zinc-200/75 dark:border-border/60 flex flex-col max-h-[640px]">
          {showSearchBar && (
            <div className="p-2.5 border-b border-zinc-200/70 dark:border-border/55 bg-zinc-50/40 dark:bg-surface-secondary/15 flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="筛选标题、Tag 或路径..."
                  className="w-full h-7 pl-8 pr-7 rounded-lg bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/75 text-[11px] text-foreground placeholder-muted outline-none focus:border-zinc-400"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <span className="text-[10.5px] font-mono text-muted shrink-0">
                {filteredDocs.length}
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y divide-zinc-200/60 dark:divide-border/50">
            {filteredDocs.length === 0 ? (
              <div className="py-12 text-center text-[11px] text-muted">无匹配文档</div>
            ) : (
              filteredDocs.map((doc) => {
                const key = docKey(doc);
                const selected = activeDoc && docKey(activeDoc) === key;
                const kindTag = getDocKindTag(doc);
                const statusAlert = getStatusAlert(doc.status);
                const isOverCap = doc.size_bytes >= 20000;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setHistoryStack([]);
                      setSelectedKey(key);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer flex flex-col gap-1 ${
                      selected
                        ? 'bg-zinc-100/85 dark:bg-surface-secondary/75'
                        : 'hover:bg-zinc-50 dark:hover:bg-surface-secondary/35'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-[9.5px] font-medium px-1.5 py-[1px] rounded border shrink-0 ${kindTag.cls}`}
                        >
                          {kindTag.label}
                        </span>
                        {statusAlert.kind === 'partial' && (
                          <span
                            className={`text-[9.5px] font-medium px-1.5 py-[1px] rounded border shrink-0 ${statusAlert.badgeCls}`}
                          >
                            {statusAlert.shortLabel}
                          </span>
                        )}
                        {showRepoBadge && (
                          <span className="text-[10px] font-mono text-muted truncate">
                            {doc.repo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-mono text-muted shrink-0">
                        {isOverCap && (
                          <span title={`体积 ${formatKb(doc.size_bytes)}，接近或超出 24KB 截断阈值`}>
                            <ShieldAlert className="w-3 h-3 text-amber-500" />
                          </span>
                        )}
                        <span>{formatKb(doc.size_bytes)}</span>
                      </div>
                    </div>

                    <div className="text-[12px] font-medium text-foreground leading-snug line-clamp-2">
                      {doc.title}
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
                      <span className="truncate">{doc.rel_path}</span>
                      {doc.date && (
                        <span className="inline-flex items-center gap-0.5 shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {doc.date}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 右侧阅读区 */}
      <div
        className={`${
          listOpen ? 'lg:col-span-8' : 'lg:col-span-12'
        } flex flex-col min-w-0 max-h-[640px] overflow-y-auto`}
      >
        {activeDoc && (
          <>
            <div className="px-4 py-2 border-b border-zinc-200/75 dark:border-border/60 bg-zinc-50/50 dark:bg-surface-secondary/20 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setListOpen((v) => !v)}
                  title={listOpen ? '收起文档列表' : '展开文档列表'}
                  className="p-1 rounded-md border border-zinc-200/85 dark:border-border/75 bg-white dark:bg-surface text-muted hover:text-foreground cursor-pointer shrink-0"
                >
                  {listOpen ? (
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                  )}
                </button>
                {historyStack.length > 0 && (
                  <button
                    type="button"
                    onClick={handleGoBack}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-200/90 dark:border-border bg-white dark:bg-surface text-[11px] text-foreground hover:bg-zinc-50 cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>返回</span>
                  </button>
                )}
                <span
                  className={`text-[9.5px] font-medium px-1.5 py-[1px] rounded border shrink-0 ${
                    getDocKindTag(activeDoc).cls
                  }`}
                >
                  {getDocKindTag(activeDoc).label}
                </span>
                <span className="text-[10.5px] font-mono text-muted truncate">
                  {activeDoc.rel_path}
                </span>
                {activeDoc.status && (
                  <span
                    className={`text-[10px] px-1.5 py-[1px] rounded border shrink-0 ${
                      getStatusAlert(activeDoc.status).badgeCls ||
                      'bg-zinc-100 dark:bg-surface-secondary border-zinc-200/80 dark:border-border/70 text-muted'
                    }`}
                  >
                    {activeDoc.status}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10.5px] font-mono text-muted shrink-0">
                <span>
                  {formatKb(activeDoc.size_bytes)} · ~{activeDoc.estimated_tokens.toLocaleString()}t
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(activeDoc.abs_path || activeDoc.rel_path);
                    pushToast(`已复制路径：${activeDoc.rel_path}`, 'success');
                  }}
                  title="复制绝对路径"
                  className="p-1 rounded hover:bg-zinc-200/60 dark:hover:bg-surface-secondary text-muted hover:text-foreground cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>

            {(() => {
              const st = getStatusAlert(activeDoc.status);
              if (!st.kind) return null;
              const isDep = st.kind === 'deprecated';
              return (
                <div
                  className={`mx-5 mt-3 px-3 py-2 rounded-xl border text-[11px] flex items-start gap-2 ${
                    isDep
                      ? 'bg-rose-500/8 border-rose-500/25 text-rose-700 dark:text-rose-300'
                      : 'bg-amber-500/8 border-amber-500/25 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {isDep
                      ? '已废弃：以下内容为历史快照，现行设计请以常青文档为准。'
                      : '部分失效：部分结论已被后续演进更新，请对照常青文档阅读。'}
                  </span>
                </div>
              );
            })()}

            <div className="px-5 py-4">
              {loadingDoc ? (
                <div className="py-12 text-center text-[11.5px] text-muted">正在加载...</div>
              ) : docError ? (
                <div className="py-12 text-center text-[11.5px] text-rose-500">{docError}</div>
              ) : (
                renderArticle(docContent, handleOpenDocLink)
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
