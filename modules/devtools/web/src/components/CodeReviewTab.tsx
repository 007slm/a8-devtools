import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  FolderGit2,
  GitBranch,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Rows2,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  REVIEW_TAG_META,
  buildSplitRows,
  formatAnchorLabel,
  formatReviewFeedbackMarkdown,
  parseUnifiedFileDiff,
  type DiffHunk,
  type DiffLine,
  type DiffScope,
  type DiffViewMode,
  type GitDiffFileEntry,
  type GitReviewDiffResult,
  type ReviewAnnotation,
  type ReviewTag,
  type ReviewVerdict,
  type SplitDiffRow,
} from '../utils/gitDiff';

export interface CodeReviewProjectOption {
  code: string;
  physical_path: string;
  role: string;
  summary: string;
}

interface CodeReviewTabProps {
  projects?: CodeReviewProjectOption[];
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
}

interface LineSelectionDraft {
  filePath: string;
  side: 'new' | 'old' | 'file';
  lineStart: number | null;
  lineEnd: number | null;
  codeExcerpt: string;
  editingId: string | null;
  initialTag: ReviewTag;
  initialComment: string;
  initialSuggestion: string;
}

interface StoredReviewState {
  annotations: ReviewAnnotation[];
  reviewedPaths: string[];
  overallNote: string;
  verdict: ReviewVerdict;
}

interface PreparedHunk {
  hunk: DiffHunk;
  splitRows: SplitDiffRow[];
}

const INITIAL_LINE_CAP = 350;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  A: { label: 'A', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  D: { label: 'D', cls: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  R: { label: 'R', cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  U: { label: 'U', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
};

function storageKeyForRepo(repoCode: string): string {
  return `a8_code_review_v1:${repoCode}`;
}

function loadStoredReview(repoCode: string): StoredReviewState {
  const empty: StoredReviewState = {
    annotations: [],
    reviewedPaths: [],
    overallNote: '',
    verdict: 'request_changes',
  };
  if (!repoCode) return empty;
  try {
    const raw = window.localStorage.getItem(storageKeyForRepo(repoCode));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredReviewState>;
    return {
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      reviewedPaths: Array.isArray(parsed.reviewedPaths) ? parsed.reviewedPaths : [],
      overallNote: typeof parsed.overallNote === 'string' ? parsed.overallNote : '',
      verdict:
        parsed.verdict === 'approved' ||
        parsed.verdict === 'approve_with_notes' ||
        parsed.verdict === 'request_changes'
          ? parsed.verdict
          : 'request_changes',
    };
  } catch (err) {
    console.warn('[CodeReview] 读取本地批注缓存失败:', err);
    return empty;
  }
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
    if (copied) return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

function splitFilePath(relPath: string): { dir: string; base: string } {
  const idx = relPath.lastIndexOf('/');
  if (idx < 0) return { dir: '', base: relPath };
  return { dir: relPath.slice(0, idx), base: relPath.slice(idx + 1) };
}

function renderHighlightedCode(text: string, range?: [number, number] | null, hlClass?: string) {
  if (!range) return text || ' ';
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <span className={hlClass}>{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

/** 独立受控的内联批注输入器：键盘输入仅触发自身局部重绘，不重绘整张 Diff 表 */
const InlineAnnotationComposer = memo(function InlineAnnotationComposer({
  draft,
  onSave,
  onCancel,
  pushToast,
}: {
  draft: LineSelectionDraft;
  onSave: (tag: ReviewTag, comment: string, suggestion: string) => void;
  onCancel: () => void;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
}) {
  const [tag, setTag] = useState<ReviewTag>(draft.initialTag);
  const [comment, setComment] = useState<string>(draft.initialComment);
  const [suggestion, setSuggestion] = useState<string>(draft.initialSuggestion);
  const [showSuggestion, setShowSuggestion] = useState<boolean>(
    Boolean(draft.editingId && draft.initialSuggestion.trim())
  );

  useEffect(() => {
    setTag(draft.initialTag);
    setComment(draft.initialComment);
    setSuggestion(draft.initialSuggestion);
    setShowSuggestion(Boolean(draft.editingId && draft.initialSuggestion.trim()));
  }, [draft]);

  const submit = () => {
    const clean = comment.trim();
    if (!clean) {
      pushToast('请输入批注内容', 'info');
      return;
    }
    onSave(tag, clean, showSuggestion ? suggestion : '');
  };

  return (
    <div className="mx-3 my-2 rounded-xl border border-zinc-300 dark:border-border bg-white dark:bg-surface p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono font-semibold text-foreground">{formatAnchorLabel(draft)}</span>
          <span className="text-muted">· 按 Shift+点击行号可跨行框选</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(REVIEW_TAG_META) as ReviewTag[]).map((tagKey) => {
            const meta = REVIEW_TAG_META[tagKey];
            const active = tag === tagKey;
            return (
              <button
                key={tagKey}
                type="button"
                onClick={() => setTag(tagKey)}
                className={`px-2 py-0.5 rounded-md border text-[10.5px] font-medium cursor-pointer ${
                  active
                    ? meta.badgeClass
                    : 'border-zinc-200 dark:border-border/70 text-muted hover:text-foreground'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        rows={3}
        autoFocus
        placeholder="写下审核意见、设计问题或修改要求…（Ctrl+Enter 保存）"
        className="w-full rounded-lg border border-zinc-200/90 dark:border-border/80 bg-zinc-50/50 dark:bg-surface-secondary/40 px-2.5 py-2 text-[12px] text-foreground outline-none focus:border-zinc-400 resize-y"
      />

      {showSuggestion && (
        <div className="space-y-1">
          <div className="text-[10.5px] font-medium text-muted">建议替换代码（可选）</div>
          <textarea
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-200/90 dark:border-border/80 bg-zinc-50/60 dark:bg-surface-secondary/40 px-2.5 py-2 font-mono text-[11px] text-foreground outline-none focus:border-zinc-400 resize-y"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowSuggestion((v) => !v)}
          className="text-[11px] text-muted hover:text-foreground underline-offset-2 hover:underline cursor-pointer"
        >
          {showSuggestion ? '收起建议代码' : '+ 附加建议替换代码'}
        </button>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 px-2.5 rounded-lg text-[11px]" onPress={onCancel}>
            取消
          </Button>
          <Button size="sm" variant="primary" className="h-7 px-3 rounded-lg text-[11px]" onPress={submit}>
            {draft.editingId ? '保存修改' : '添加批注'}
          </Button>
        </div>
      </div>
    </div>
  );
});

const InlineAnnotationCard = memo(function InlineAnnotationCard({
  ann,
  onEdit,
  onDelete,
}: {
  ann: ReviewAnnotation;
  onEdit: (ann: ReviewAnnotation) => void;
  onDelete: (id: string) => void;
}) {
  const meta = REVIEW_TAG_META[ann.tag] ?? REVIEW_TAG_META.change;
  return (
    <div
      className={`mx-3 my-1.5 rounded-xl border ${meta.borderClass} bg-white dark:bg-surface px-3 py-2 text-[11.5px] space-y-1.5`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.badgeClass}`}>
            {meta.label}
          </span>
          <span className="font-mono text-[10.5px] text-muted">{formatAnchorLabel(ann)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onEdit(ann)}
            title="编辑批注"
            className="p-1 rounded text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(ann.id)}
            title="删除批注"
            className="p-1 rounded text-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <p className="text-foreground whitespace-pre-wrap leading-relaxed select-text">{ann.comment}</p>
      {ann.suggestion.trim() && (
        <pre className="p-2 rounded-lg border border-zinc-200/80 dark:border-border/70 bg-zinc-50/70 dark:bg-surface-secondary/40 font-mono text-[11px] text-foreground overflow-x-auto select-text">
          {ann.suggestion}
        </pre>
      )}
    </div>
  );
});

const DiffFileCard = memo(function DiffFileCard({
  file,
  preparedHunks,
  viewMode,
  isCollapsed,
  isReviewed,
  copiedPath,
  fileAnnotations,
  fileDraft,
  showCollapseToggle,
  navControls,
  onToggleCollapse,
  onCopyPath,
  onOpenFileComment,
  onToggleReviewed,
  onOpenLineComposer,
  onEditAnnotation,
  onDeleteAnnotation,
  onSaveDraft,
  onCancelDraft,
  pushToast,
  registerRef,
}: {
  file: GitDiffFileEntry;
  preparedHunks: PreparedHunk[];
  viewMode: DiffViewMode;
  isCollapsed: boolean;
  isReviewed: boolean;
  copiedPath: boolean;
  fileAnnotations: ReviewAnnotation[];
  fileDraft: LineSelectionDraft | null;
  showCollapseToggle: boolean;
  navControls?: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
  onToggleCollapse: (path: string) => void;
  onCopyPath: (path: string) => void;
  onOpenFileComment: (path: string) => void;
  onToggleReviewed: (path: string) => void;
  onOpenLineComposer: (filePath: string, side: 'new' | 'old', lineNum: number, shiftKey: boolean) => void;
  onEditAnnotation: (ann: ReviewAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onSaveDraft: (tag: ReviewTag, comment: string, suggestion: string) => void;
  onCancelDraft: () => void;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  registerRef: (path: string, el: HTMLDivElement | null) => void;
}) {
  const [showAllLines, setShowAllLines] = useState(false);

  useEffect(() => {
    setShowAllLines(false);
  }, [file.path, file.diff_text]);

  const badge = STATUS_BADGE[file.status] ?? STATUS_BADGE.M;
  const fileLevelAnns = useMemo(
    () => fileAnnotations.filter((a) => a.side === 'file'),
    [fileAnnotations]
  );

  const lineAnnotationsMap = useMemo(() => {
    const map = new Map<string, ReviewAnnotation[]>();
    for (const ann of fileAnnotations) {
      if (ann.side === 'file') continue;
      const anchor = ann.lineEnd ?? ann.lineStart;
      if (anchor === null) continue;
      const key = `${ann.side}:${anchor}`;
      const list = map.get(key) ?? [];
      list.push(ann);
      map.set(key, list);
    }
    return map;
  }, [fileAnnotations]);

  const totalRenderedRows = useMemo(
    () =>
      preparedHunks.reduce(
        (acc, item) => acc + (viewMode === 'split' ? item.splitRows.length : item.hunk.lines.length),
        0
      ),
    [preparedHunks, viewMode]
  );

  const isLineSelected = (line: DiffLine): boolean => {
    if (!fileDraft || fileDraft.side === 'file' || fileDraft.lineStart === null) return false;
    const num = fileDraft.side === 'old' ? line.oldLine : line.newLine;
    if (num === null) return false;
    const end = fileDraft.lineEnd ?? fileDraft.lineStart;
    return num >= fileDraft.lineStart && num <= end;
  };

  let remainingBudget = showAllLines ? Number.POSITIVE_INFINITY : INITIAL_LINE_CAP;
  let clippedLines = false;

  return (
    <div
      ref={(el) => registerRef(file.path, el)}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 260px' }}
      className="rounded-xl border border-zinc-200/85 dark:border-border/80 overflow-hidden bg-white dark:bg-surface"
    >
      {/* File Header */}
      <div className="px-3 py-2 bg-zinc-50/75 dark:bg-surface-secondary/50 border-b border-zinc-200/80 dark:border-border/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showCollapseToggle && (
            <button
              type="button"
              onClick={() => onToggleCollapse(file.path)}
              className="p-0.5 rounded hover:bg-zinc-200/60 dark:hover:bg-surface-secondary text-muted cursor-pointer"
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${badge.cls}`}>
            {badge.label}
          </span>
          <FileCode2 className="w-3.5 h-3.5 text-muted shrink-0" />
          <span className="font-mono text-[11.5px] font-medium text-foreground truncate select-text">
            {file.status === 'R' && file.old_path ? `${file.old_path} → ${file.path}` : file.path}
          </span>
          <button
            type="button"
            onClick={() => onCopyPath(file.path)}
            title="复制文件路径"
            className="p-1 rounded text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary cursor-pointer"
          >
            {copiedPath ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
          </button>
          <span className="text-[10.5px] font-mono text-muted shrink-0">
            <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{' '}
            <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {navControls && navControls.total > 1 && (
            <div className="inline-flex items-center rounded-md border border-zinc-200/90 dark:border-border/70 text-[10.5px] mr-1">
              <button
                type="button"
                disabled={navControls.index <= 0}
                onClick={navControls.onPrev}
                title="上一个文件"
                className="h-6 w-6 flex items-center justify-center text-muted hover:text-foreground disabled:opacity-35 cursor-pointer disabled:cursor-default"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 font-mono text-muted border-x border-zinc-200/80 dark:border-border/60">
                {navControls.index + 1}/{navControls.total}
              </span>
              <button
                type="button"
                disabled={navControls.index >= navControls.total - 1}
                onClick={navControls.onNext}
                title="下一个文件"
                className="h-6 w-6 flex items-center justify-center text-muted hover:text-foreground disabled:opacity-35 cursor-pointer disabled:cursor-default"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 rounded-md text-[10.5px]"
            onPress={() => onOpenFileComment(file.path)}
          >
            <MessageSquarePlus className="w-3 h-3" />
            <span>文件批注</span>
          </Button>
          <button
            type="button"
            onClick={() => onToggleReviewed(file.path)}
            className={`h-6 px-2 rounded-md border text-[10.5px] inline-flex items-center gap-1 cursor-pointer ${
              isReviewed
                ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-medium'
                : 'border-zinc-200/90 dark:border-border/70 text-muted hover:text-foreground'
            }`}
          >
            <Check className="w-3 h-3" />
            <span>{isReviewed ? '已审阅' : '标记已审'}</span>
          </button>
        </div>
      </div>

      {/* File-level annotations */}
      {fileLevelAnns.map((ann) => (
        <InlineAnnotationCard
          key={ann.id}
          ann={ann}
          onEdit={onEditAnnotation}
          onDelete={onDeleteAnnotation}
        />
      ))}
      {fileDraft && fileDraft.side === 'file' && (
        <InlineAnnotationComposer
          draft={fileDraft}
          onSave={onSaveDraft}
          onCancel={onCancelDraft}
          pushToast={pushToast}
        />
      )}

      {/* Diff Body */}
      {!isCollapsed && (
        <div className="overflow-x-auto">
          {file.is_binary ? (
            <div className="px-4 py-3 text-[11.5px] text-muted">
              二进制文件变更（不渲染文本 Diff，可使用上方「文件批注」记录意见）。
            </div>
          ) : preparedHunks.length === 0 ? (
            <div className="px-4 py-3 text-[11.5px] text-muted">空文件或仅模式/元信息变更。</div>
          ) : (
            <div className={viewMode === 'split' ? 'min-w-[780px]' : 'min-w-[540px]'}>
              {viewMode === 'split' && (
                <div className="grid grid-cols-2 divide-x divide-zinc-200/75 dark:divide-border/60 border-b border-zinc-200/70 dark:border-border/60 bg-zinc-50/50 dark:bg-surface-secondary/25 text-[10px] font-mono text-muted">
                  <div className="px-3 py-1">旧版本 (Base)</div>
                  <div className="px-3 py-1">新版本 (Working)</div>
                </div>
              )}

              {preparedHunks.map(({ hunk, splitRows }, hi) => {
                if (remainingBudget <= 0) {
                  clippedLines = true;
                  return null;
                }

                if (viewMode === 'unified') {
                  const slice = hunk.lines.slice(0, remainingBudget);
                  if (slice.length < hunk.lines.length) clippedLines = true;
                  remainingBudget -= slice.length;

                  return (
                    <div key={`${file.path}-hu-${hi}`} className="border-b last:border-b-0 border-zinc-200/60 dark:border-border/50">
                      <div className="px-3 py-1 bg-zinc-50/90 dark:bg-surface-secondary/35 font-mono text-[10.5px] text-muted border-b border-zinc-200/60 dark:border-border/50">
                        {hunk.header}
                      </div>
                      {slice.map((ln) => {
                        const targetSide: 'new' | 'old' = ln.type === 'del' ? 'old' : 'new';
                        const targetNum = targetSide === 'old' ? ln.oldLine : ln.newLine;
                        const selected = isLineSelected(ln);
                        const lineAnns =
                          targetNum !== null
                            ? lineAnnotationsMap.get(`${targetSide}:${targetNum}`) ?? []
                            : [];
                        const showDraftHere =
                          fileDraft &&
                          fileDraft.side === targetSide &&
                          (fileDraft.lineEnd ?? fileDraft.lineStart) === targetNum;

                        const rowBg = selected
                          ? 'bg-sky-500/12'
                          : ln.type === 'add'
                            ? 'bg-emerald-500/8'
                            : ln.type === 'del'
                              ? 'bg-rose-500/8'
                              : '';
                        const sign =
                          ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ln.type === 'meta' ? '\\' : ' ';
                        const signColor =
                          ln.type === 'add'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : ln.type === 'del'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted';

                        return (
                          <Fragment key={`${file.path}-${hi}-${ln.index}`}>
                            <div
                              className={`group flex items-stretch font-mono text-[11.5px] leading-[1.48] ${rowBg} hover:bg-zinc-500/5`}
                            >
                              <button
                                type="button"
                                disabled={targetNum === null}
                                onClick={(e) => {
                                  if (targetNum !== null) {
                                    onOpenLineComposer(file.path, targetSide, targetNum, e.shiftKey);
                                  }
                                }}
                                title={targetNum !== null ? '点击批注此行（Shift+点击可框选多行）' : undefined}
                                className="w-24 shrink-0 px-2 py-0.5 flex items-center justify-between text-[10.5px] tabular-nums text-muted border-r border-zinc-200/70 dark:border-border/50 select-none hover:bg-zinc-500/10 cursor-pointer disabled:cursor-default"
                              >
                                <span className="w-8 text-right opacity-75">{ln.oldLine ?? ''}</span>
                                <span className="w-8 text-right opacity-75">{ln.newLine ?? ''}</span>
                                <span className="w-3.5 text-center opacity-0 group-hover:opacity-100 text-sky-600 dark:text-sky-400 font-bold">
                                  {targetNum !== null ? '+' : ''}
                                </span>
                              </button>
                              <span className={`w-5 shrink-0 text-center py-0.5 select-none ${signColor}`}>
                                {sign}
                              </span>
                              <pre className="flex-1 py-0.5 pr-4 whitespace-pre text-foreground select-text">
                                {ln.content || ' '}
                              </pre>
                            </div>
                            {lineAnns.map((ann) => (
                              <InlineAnnotationCard
                                key={ann.id}
                                ann={ann}
                                onEdit={onEditAnnotation}
                                onDelete={onDeleteAnnotation}
                              />
                            ))}
                            {showDraftHere && fileDraft && (
                              <InlineAnnotationComposer
                                draft={fileDraft}
                                onSave={onSaveDraft}
                                onCancel={onCancelDraft}
                                pushToast={pushToast}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  );
                }

                // Split view
                const slice = splitRows.slice(0, remainingBudget);
                if (slice.length < splitRows.length) clippedLines = true;
                remainingBudget -= slice.length;

                return (
                  <div key={`${file.path}-hs-${hi}`} className="border-b last:border-b-0 border-zinc-200/60 dark:border-border/50">
                    <div className="px-3 py-1 bg-zinc-50/90 dark:bg-surface-secondary/35 font-mono text-[10.5px] text-muted border-b border-zinc-200/60 dark:border-border/50">
                      {hunk.header}
                    </div>
                    {slice.map((row) => {
                      const leftNum = row.left?.oldLine ?? null;
                      const rightNum = row.right?.newLine ?? null;
                      const leftSelected = row.left ? isLineSelected(row.left) : false;
                      const rightSelected = row.right ? isLineSelected(row.right) : false;

                      const oldAnns =
                        leftNum !== null && row.left?.type !== 'context'
                          ? lineAnnotationsMap.get(`old:${leftNum}`) ?? []
                          : [];
                      const newAnns =
                        rightNum !== null ? lineAnnotationsMap.get(`new:${rightNum}`) ?? [] : [];

                      const showDraftHere =
                        fileDraft &&
                        ((fileDraft.side === 'old' &&
                          (fileDraft.lineEnd ?? fileDraft.lineStart) === leftNum &&
                          row.left?.type !== 'context') ||
                          (fileDraft.side === 'new' &&
                            (fileDraft.lineEnd ?? fileDraft.lineStart) === rightNum));

                      const leftBg = leftSelected
                        ? 'bg-sky-500/12'
                        : row.left?.type === 'del'
                          ? 'bg-rose-500/8'
                          : row.left === null
                            ? 'bg-zinc-100/60 dark:bg-surface-secondary/30'
                            : '';
                      const rightBg = rightSelected
                        ? 'bg-sky-500/12'
                        : row.right?.type === 'add'
                          ? 'bg-emerald-500/8'
                          : row.right === null
                            ? 'bg-zinc-100/60 dark:bg-surface-secondary/30'
                            : '';

                      return (
                        <Fragment key={`${file.path}-sp-${hi}-${row.key}`}>
                          <div className="grid grid-cols-2 divide-x divide-zinc-200/75 dark:divide-border/60 font-mono text-[11.5px] leading-[1.48] hover:bg-zinc-500/4">
                            <div className={`group flex items-stretch min-w-0 overflow-hidden ${leftBg}`}>
                              <button
                                type="button"
                                disabled={leftNum === null}
                                onClick={(e) => {
                                  if (leftNum !== null) {
                                    onOpenLineComposer(
                                      file.path,
                                      row.left?.type === 'context' ? 'new' : 'old',
                                      row.left?.type === 'context' ? (rightNum ?? leftNum) : leftNum,
                                      e.shiftKey
                                    );
                                  }
                                }}
                                title={leftNum !== null ? '点击批注此行（Shift+点击可框选多行）' : undefined}
                                className="w-12 shrink-0 px-1.5 py-0.5 flex items-center justify-between text-[10.5px] tabular-nums text-muted border-r border-zinc-200/70 dark:border-border/50 select-none hover:bg-zinc-500/10 cursor-pointer disabled:cursor-default"
                              >
                                <span className="opacity-75">{leftNum ?? ''}</span>
                                <span className="opacity-0 group-hover:opacity-100 text-sky-600 dark:text-sky-400 font-bold">
                                  {leftNum !== null ? '+' : ''}
                                </span>
                              </button>
                              <pre className="flex-1 px-2 py-0.5 whitespace-pre text-foreground select-text min-w-0">
                                {row.left
                                  ? renderHighlightedCode(
                                      row.left.content,
                                      row.leftHighlight,
                                      'bg-rose-500/22 rounded-xs'
                                    )
                                  : ' '}
                              </pre>
                            </div>

                            <div className={`group flex items-stretch min-w-0 overflow-hidden ${rightBg}`}>
                              <button
                                type="button"
                                disabled={rightNum === null}
                                onClick={(e) => {
                                  if (rightNum !== null) {
                                    onOpenLineComposer(file.path, 'new', rightNum, e.shiftKey);
                                  }
                                }}
                                title={rightNum !== null ? '点击批注此行（Shift+点击可框选多行）' : undefined}
                                className="w-12 shrink-0 px-1.5 py-0.5 flex items-center justify-between text-[10.5px] tabular-nums text-muted border-r border-zinc-200/70 dark:border-border/50 select-none hover:bg-zinc-500/10 cursor-pointer disabled:cursor-default"
                              >
                                <span className="opacity-75">{rightNum ?? ''}</span>
                                <span className="opacity-0 group-hover:opacity-100 text-sky-600 dark:text-sky-400 font-bold">
                                  {rightNum !== null ? '+' : ''}
                                </span>
                              </button>
                              <pre className="flex-1 px-2 py-0.5 whitespace-pre text-foreground select-text min-w-0">
                                {row.right
                                  ? renderHighlightedCode(
                                      row.right.content,
                                      row.rightHighlight,
                                      'bg-emerald-500/22 rounded-xs'
                                    )
                                  : ' '}
                              </pre>
                            </div>
                          </div>
                          {[...oldAnns, ...newAnns].map((ann) => (
                            <InlineAnnotationCard
                              key={ann.id}
                              ann={ann}
                              onEdit={onEditAnnotation}
                              onDelete={onDeleteAnnotation}
                            />
                          ))}
                          {showDraftHere && fileDraft && (
                            <InlineAnnotationComposer
                              draft={fileDraft}
                              onSave={onSaveDraft}
                              onCancel={onCancelDraft}
                              pushToast={pushToast}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                );
              })}

              {clippedLines && (
                <div className="px-3 py-2 border-t border-zinc-200/70 dark:border-border/60 bg-zinc-50/75 dark:bg-surface-secondary/35 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted">
                    为保障流畅滚动，已先渲染前 {INITIAL_LINE_CAP} 行（本文件共 {totalRenderedRows} 行）
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2.5 rounded-md text-[10.5px]"
                    onPress={() => setShowAllLines(true)}
                  >
                    展开全部 {totalRenderedRows} 行
                  </Button>
                </div>
              )}

              {file.truncated && (
                <div className="px-3 py-1.5 bg-amber-500/8 text-[11px] text-amber-700 dark:text-amber-300">
                  单文件 Diff 体积过大，后端已截断保护性能。
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function CodeReviewTab({ projects: externalProjects, callTauri, pushToast }: CodeReviewTabProps) {
  const [loadedProjects, setLoadedProjects] = useState<CodeReviewProjectOption[]>([]);
  const projects = useMemo(
    () => (externalProjects && externalProjects.length > 0 ? externalProjects : loadedProjects),
    [externalProjects, loadedProjects]
  );

  useEffect(() => {
    if (externalProjects && externalProjects.length > 0) return;
    let active = true;
    callTauri<{ projects?: CodeReviewProjectOption[] }>('get_agent_mind_overview')
      .then((res) => {
        if (active && Array.isArray(res?.projects)) {
          setLoadedProjects(res.projects);
        }
      })
      .catch((err: any) => {
        if (active) {
          pushToast(`加载仓库列表失败: ${err?.message || String(err)}`, 'danger');
        }
      });
    return () => {
      active = false;
    };
  }, [externalProjects, callTauri, pushToast]);

  const [selectedRepo, setSelectedRepo] = useState<string>(() => {
    return window.localStorage.getItem('a8_code_review_active_repo') || '';
  });
  const [scope, setScope] = useState<DiffScope>('all');
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => {
    const saved = window.localStorage.getItem('a8_code_review_view_mode');
    return saved === 'unified' ? 'unified' : 'split';
  });
  const [focusMode, setFocusMode] = useState<'single' | 'all'>('single');
  const [showFileTree, setShowFileTree] = useState<boolean>(true);
  const [fileSearch, setFileSearch] = useState<string>('');
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());

  const [diffResult, setDiffResult] = useState<GitReviewDiffResult | null>(null);
  const [loadingDiff, setLoadingDiff] = useState<boolean>(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [annotations, setAnnotations] = useState<ReviewAnnotation[]>([]);
  const [reviewedPaths, setReviewedPaths] = useState<Set<string>>(() => new Set());
  const [overallNote, setOverallNote] = useState<string>('');
  const [verdict, setVerdict] = useState<ReviewVerdict>('request_changes');

  const [draft, setDraft] = useState<LineSelectionDraft | null>(null);
  const [showPreviewDrawer, setShowPreviewDrawer] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fileCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  const draftAnchorRef = useRef<{ filePath: string; side: 'new' | 'old'; line: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem('a8_code_review_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (projects.length === 0) return;
    if (!selectedRepo || !projects.some((p) => p.code === selectedRepo)) {
      const preferred =
        projects.find((p) => p.code.toLowerCase() === 'a8-turbo')?.code || projects[0].code;
      setSelectedRepo(preferred);
    }
  }, [projects, selectedRepo]);

  useEffect(() => {
    if (!selectedRepo) return;
    window.localStorage.setItem('a8_code_review_active_repo', selectedRepo);
    const stored = loadStoredReview(selectedRepo);
    setAnnotations(stored.annotations);
    setReviewedPaths(new Set(stored.reviewedPaths));
    setOverallNote(stored.overallNote);
    setVerdict(stored.verdict);
    setDraft(null);
  }, [selectedRepo]);

  useEffect(() => {
    if (!selectedRepo) return;
    const payload: StoredReviewState = {
      annotations,
      reviewedPaths: Array.from(reviewedPaths),
      overallNote,
      verdict,
    };
    window.localStorage.setItem(storageKeyForRepo(selectedRepo), JSON.stringify(payload));
  }, [selectedRepo, annotations, reviewedPaths, overallNote, verdict]);

  const loadGitDiff = useCallback(
    async (repoCode: string, diffScope: DiffScope) => {
      if (!repoCode) return;
      setLoadingDiff(true);
      setDiffError(null);
      try {
        const res = await callTauri<GitReviewDiffResult>('get_repo_git_diff', {
          repoCode,
          scope: diffScope,
        });
        setDiffResult(res);
        if (res && res.files.length > 0) {
          const initialActive =
            activeFilePath && res.files.some((f) => f.path === activeFilePath)
              ? activeFilePath
              : res.files[0].path;
          setActiveFilePath(initialActive);
          // 全部文件模式下，多于 5 个文件时默认折叠除首文件外的其余文件，避免瞬间挂载数万 DOM 节点
          if (res.files.length > 5) {
            setCollapsedFiles(
              new Set(res.files.filter((f) => f.path !== initialActive).map((f) => f.path))
            );
          } else {
            setCollapsedFiles(new Set());
          }
        } else {
          setActiveFilePath('');
          setCollapsedFiles(new Set());
        }
      } catch (e: any) {
        setDiffError(e?.message || String(e));
        setDiffResult(null);
      } finally {
        setLoadingDiff(false);
      }
    },
    [callTauri, activeFilePath]
  );

  useEffect(() => {
    if (selectedRepo) {
      void loadGitDiff(selectedRepo, scope);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo, scope]);

  const files = diffResult?.files ?? [];

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, fileSearch]);

  /** 一次性预解析 Hunk 与 Split 行配对，不在滚动或打字时重算 */
  const preparedByPath = useMemo(() => {
    const map = new Map<string, PreparedHunk[]>();
    for (const file of files) {
      if (file.is_binary) {
        map.set(file.path, []);
        continue;
      }
      const hunks = parseUnifiedFileDiff(file.diff_text);
      map.set(
        file.path,
        hunks.map((hunk) => ({
          hunk,
          splitRows: buildSplitRows(hunk.lines),
        }))
      );
    }
    return map;
  }, [files]);

  const annotationsByFile = useMemo(() => {
    const map = new Map<string, ReviewAnnotation[]>();
    for (const ann of annotations) {
      const list = map.get(ann.filePath) ?? [];
      list.push(ann);
      map.set(ann.filePath, list);
    }
    return map;
  }, [annotations]);

  const reviewedCount = useMemo(
    () => files.filter((f) => reviewedPaths.has(f.path)).length,
    [files, reviewedPaths]
  );

  const feedbackMarkdown = useMemo(
    () =>
      formatReviewFeedbackMarkdown({
        repoCode: diffResult?.repo_code || selectedRepo || 'repo',
        branch: diffResult?.branch || 'HEAD',
        scope,
        verdict,
        overallNote,
        annotations,
        reviewedFilesCount: reviewedCount,
        totalFilesCount: files.length,
      }),
    [diffResult, selectedRepo, scope, verdict, overallNote, annotations, reviewedCount, files.length]
  );

  const visibleFiles = useMemo(() => {
    if (focusMode === 'all') return filteredFiles;
    if (filteredFiles.length === 0) return [];
    const target = filteredFiles.find((f) => f.path === activeFilePath) ?? filteredFiles[0];
    return [target];
  }, [focusMode, filteredFiles, activeFilePath]);

  const activeFileIndex = useMemo(() => {
    if (filteredFiles.length === 0) return -1;
    const idx = filteredFiles.findIndex((f) => f.path === activeFilePath);
    return idx >= 0 ? idx : 0;
  }, [filteredFiles, activeFilePath]);

  const jumpToFile = useCallback(
    (path: string) => {
      setActiveFilePath(path);
      setCollapsedFiles((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      if (focusMode === 'single') {
        if (diffScrollRef.current) diffScrollRef.current.scrollTop = 0;
        return;
      }
      requestAnimationFrame(() => {
        const el = fileCardRefs.current.get(path);
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    },
    [focusMode]
  );

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleReviewed = useCallback(
    (path: string, advanceNext = false) => {
      setReviewedPaths((prev) => {
        const next = new Set(prev);
        const nowReviewed = !next.has(path);
        if (nowReviewed) {
          next.add(path);
          if (advanceNext) {
            const nextUnreviewed = files.find((f) => f.path !== path && !next.has(f.path));
            if (nextUnreviewed) {
              setTimeout(() => jumpToFile(nextUnreviewed.path), 40);
            }
          }
        } else {
          next.delete(path);
        }
        return next;
      });
    },
    [files, jumpToFile]
  );

  const extractLinesExcerpt = useCallback(
    (filePath: string, side: 'new' | 'old', start: number, end: number): string => {
      const prepared = preparedByPath.get(filePath) ?? [];
      const collected: string[] = [];
      for (const { hunk } of prepared) {
        for (const ln of hunk.lines) {
          const num = side === 'old' ? ln.oldLine : ln.newLine;
          if (num !== null && num >= start && num <= end) {
            collected.push(ln.content);
          }
        }
      }
      return collected.join('\n');
    },
    [preparedByPath]
  );

  const openLineComposer = useCallback(
    (filePath: string, side: 'new' | 'old', lineNum: number, shiftKey: boolean) => {
      let lineStart = lineNum;
      let lineEnd = lineNum;
      if (
        shiftKey &&
        draftAnchorRef.current &&
        draftAnchorRef.current.filePath === filePath &&
        draftAnchorRef.current.side === side
      ) {
        const prevLine = draftAnchorRef.current.line;
        lineStart = Math.min(prevLine, lineNum);
        lineEnd = Math.max(prevLine, lineNum);
      } else {
        draftAnchorRef.current = { filePath, side, line: lineNum };
      }

      const excerpt = extractLinesExcerpt(filePath, side, lineStart, lineEnd);
      setDraft({
        filePath,
        side,
        lineStart,
        lineEnd,
        codeExcerpt: excerpt,
        editingId: null,
        initialTag: 'design',
        initialComment: '',
        initialSuggestion: excerpt,
      });
    },
    [extractLinesExcerpt]
  );

  const openFileLevelComposer = useCallback((filePath: string) => {
    draftAnchorRef.current = null;
    setDraft({
      filePath,
      side: 'file',
      lineStart: null,
      lineEnd: null,
      codeExcerpt: '',
      editingId: null,
      initialTag: 'design',
      initialComment: '',
      initialSuggestion: '',
    });
  }, []);

  const handleSaveDraft = useCallback(
    (tag: ReviewTag, comment: string, suggestion: string) => {
      if (!draft) return;
      if (draft.editingId) {
        const editId = draft.editingId;
        setAnnotations((prev) =>
          prev.map((item) =>
            item.id === editId ? { ...item, tag, comment, suggestion } : item
          )
        );
        pushToast('已更新批注', 'success');
      } else {
        const nextAnn: ReviewAnnotation = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filePath: draft.filePath,
          side: draft.side,
          lineStart: draft.lineStart,
          lineEnd: draft.lineEnd,
          tag,
          comment,
          suggestion,
          codeExcerpt: draft.codeExcerpt,
          createdAt: Date.now(),
        };
        setAnnotations((prev) => [...prev, nextAnn]);
        if (verdict === 'approved') {
          setVerdict('request_changes');
        }
        pushToast(`已添加批注 (${formatAnchorLabel(nextAnn)})`, 'success');
      }
      setDraft(null);
    },
    [draft, verdict, pushToast]
  );

  const handleCancelDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const startEditAnnotation = useCallback((ann: ReviewAnnotation) => {
    setDraft({
      filePath: ann.filePath,
      side: ann.side,
      lineStart: ann.lineStart,
      lineEnd: ann.lineEnd,
      codeExcerpt: ann.codeExcerpt,
      editingId: ann.id,
      initialTag: ann.tag,
      initialComment: ann.comment,
      initialSuggestion: ann.suggestion,
    });
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((item) => item.id !== id));
    setDraft((cur) => (cur?.editingId === id ? null : cur));
  }, []);

  const handleCopy = useCallback(
    async (key: string, text: string, successTip: string) => {
      const ok = await copyTextSafe(text);
      if (ok) {
        setCopiedKey(key);
        pushToast(successTip, 'success');
        setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
      } else {
        pushToast('复制到剪贴板失败，请展开预览手动复制', 'danger');
      }
    },
    [pushToast]
  );

  const handleCopyPath = useCallback(
    (path: string) => {
      void handleCopy(`path-${path}`, path, `已复制路径: ${path}`);
    },
    [handleCopy]
  );

  const handleToggleReviewedWithAdvance = useCallback(
    (path: string) => {
      toggleReviewed(path, true);
    },
    [toggleReviewed]
  );

  const registerCardRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) fileCardRefs.current.set(path, el);
    else fileCardRefs.current.delete(path);
  }, []);

  return (
    <div className="flex flex-col gap-3 max-w-[1440px] mx-auto">
      {/* 1. 顶部工具条 */}
      <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setShowFileTree((v) => !v)}
            title={showFileTree ? '收起文件树' : '展开文件树'}
            className="h-7 w-7 rounded-lg border border-zinc-200/90 dark:border-border/70 flex items-center justify-center text-muted hover:text-foreground hover:bg-zinc-50 dark:hover:bg-surface-secondary cursor-pointer shrink-0"
          >
            {showFileTree ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
          </button>

          <div className="flex items-center gap-1.5">
            <FolderGit2 className="w-3.5 h-3.5 text-muted shrink-0" />
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              aria-label="选择审核仓库"
              className="h-7 px-2 rounded-lg border border-zinc-200/90 dark:border-border/70 bg-white dark:bg-surface-secondary text-[11.5px] font-medium text-foreground outline-none focus:border-zinc-400 cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </div>

          {diffResult && (
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-zinc-200/80 dark:border-border/60 text-[11px] text-muted max-w-[260px]">
              <GitBranch className="w-3 h-3 shrink-0" />
              <span className="font-mono text-foreground truncate">{diffResult.branch}</span>
              {diffResult.head_summary && (
                <span className="truncate opacity-75 hidden sm:inline">· {diffResult.head_summary}</span>
              )}
            </div>
          )}

          {/* Diff 范围切换 */}
          <div className="inline-flex items-center rounded-lg border border-zinc-200/85 dark:border-border/70 p-0.5 text-[11px]">
            {(
              [
                { id: 'all', label: '全部未提交' },
                { id: 'staged', label: '已暂存' },
                { id: 'unstaged', label: '未暂存' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScope(opt.id)}
                className={`px-2 py-0.5 rounded-md cursor-pointer whitespace-nowrap ${
                  scope === opt.id
                    ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {diffResult && (
            <span className="text-[11px] font-mono text-muted whitespace-nowrap">
              已审 <strong className="text-foreground">{reviewedCount}</strong>/{files.length} ·{' '}
              <span className="text-emerald-600 dark:text-emerald-400">+{diffResult.total_additions}</span>{' '}
              <span className="text-rose-600 dark:text-rose-400">-{diffResult.total_deletions}</span> ·{' '}
              <strong className="text-foreground">{annotations.length}</strong> 批注
            </span>
          )}

          {/* 单文件聚焦 vs 全部展开 */}
          <div className="inline-flex items-center rounded-lg border border-zinc-200/85 dark:border-border/70 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setFocusMode('single')}
              className={`px-2 py-0.5 rounded-md cursor-pointer whitespace-nowrap ${
                focusMode === 'single'
                  ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              单文件
            </button>
            <button
              type="button"
              onClick={() => setFocusMode('all')}
              className={`px-2 py-0.5 rounded-md cursor-pointer whitespace-nowrap ${
                focusMode === 'all'
                  ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              全部文件
            </button>
          </div>

          {/* Split vs Unified */}
          <div className="inline-flex items-center rounded-lg border border-zinc-200/85 dark:border-border/70 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
                viewMode === 'split'
                  ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <Columns2 className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('unified')}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
                viewMode === 'unified'
                  ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <Rows2 className="w-3 h-3" />
              <span>Unified</span>
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            isPending={loadingDiff}
            className="h-7 px-2.5 rounded-lg text-[11px]"
            onPress={() => loadGitDiff(selectedRepo, scope)}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>刷新 Diff</span>
          </Button>
        </div>
      </section>

      {diffError && (
        <div className="rounded-xl bg-rose-500/8 border border-rose-500/25 px-3.5 py-2 text-[11.5px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{diffError}</span>
        </div>
      )}

      {/* 2. 主工作区：左侧文件树 + 右侧 Diff 审阅画布 */}
      <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden flex h-[calc(100vh-275px)] min-h-[420px]">
        {showFileTree && (
          <aside className="w-64 shrink-0 border-r border-zinc-200/85 dark:border-border/70 flex flex-col">
            <div className="p-2.5 border-b border-zinc-200/75 dark:border-border/60">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 pointer-events-none" />
                <input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="筛选变更文件..."
                  className="w-full h-7 pl-7 pr-2 rounded-lg border border-zinc-200/90 dark:border-border/70 bg-zinc-50/60 dark:bg-surface-secondary/50 text-[11px] text-foreground outline-none focus:border-zinc-400"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-200/50 dark:divide-border/40">
              {filteredFiles.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-muted">
                  {loadingDiff ? '正在拉取 Git Diff…' : '当前范围没有待审核改动'}
                </div>
              ) : (
                filteredFiles.map((file) => {
                  const { dir, base } = splitFilePath(file.path);
                  const badge = STATUS_BADGE[file.status] ?? STATUS_BADGE.M;
                  const isActive = activeFilePath === file.path;
                  const isReviewed = reviewedPaths.has(file.path);
                  const annCount = annotationsByFile.get(file.path)?.length ?? 0;
                  return (
                    <div
                      key={file.path}
                      className={`px-2.5 py-2 flex items-start gap-2 ${
                        isActive
                          ? 'bg-zinc-100/90 dark:bg-surface-secondary/70'
                          : 'hover:bg-zinc-50 dark:hover:bg-surface-secondary/35'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleReviewed(file.path, false)}
                        title={isReviewed ? '取消已审阅标记' : '标记为已审阅'}
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer ${
                          isReviewed
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-zinc-300 dark:border-border text-transparent hover:border-zinc-400'
                        }`}
                      >
                        <Check className="w-2.5 h-2.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => jumpToFile(file.path)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span
                            className={`text-[11.5px] font-medium truncate ${
                              isReviewed ? 'text-muted line-through' : 'text-foreground'
                            }`}
                          >
                            {base}
                          </span>
                          <span className={`px-1 rounded border text-[9.5px] font-mono shrink-0 ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        {dir && <div className="text-[10px] font-mono text-muted truncate mt-0.5">{dir}</div>}
                        <div className="flex items-center justify-between gap-2 mt-1 text-[10px] font-mono">
                          <span className="text-muted">
                            <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{' '}
                            <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
                          </span>
                          {annCount > 0 && (
                            <span className="px-1.5 py-0 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 font-sans">
                              {annCount} 批注
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Diff 主滚动流 */}
        <div ref={diffScrollRef} className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3">
          {!loadingDiff && files.length === 0 ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center gap-2 text-muted">
              <CheckCircle2 className="w-8 h-8 text-emerald-500/80" />
              <div className="text-[13px] font-medium text-foreground">当前工作区干净，暂无待审核变更</div>
              <div className="text-[11.5px] max-w-md">
                可切换上方仓库或 Diff 范围（全部未提交 / 已暂存 / 未暂存），在提交 `git commit` 前逐行批注设计问题或放行。
              </div>
            </div>
          ) : (
            visibleFiles.map((file) => (
              <DiffFileCard
                key={file.path}
                file={file}
                preparedHunks={preparedByPath.get(file.path) ?? []}
                viewMode={viewMode}
                isCollapsed={focusMode === 'single' ? false : collapsedFiles.has(file.path)}
                isReviewed={reviewedPaths.has(file.path)}
                copiedPath={copiedKey === `path-${file.path}`}
                fileAnnotations={annotationsByFile.get(file.path) ?? []}
                fileDraft={draft && draft.filePath === file.path ? draft : null}
                showCollapseToggle={focusMode === 'all'}
                navControls={
                  focusMode === 'single' && activeFileIndex >= 0
                    ? {
                        index: activeFileIndex,
                        total: filteredFiles.length,
                        onPrev: () => {
                          if (activeFileIndex > 0) jumpToFile(filteredFiles[activeFileIndex - 1].path);
                        },
                        onNext: () => {
                          if (activeFileIndex < filteredFiles.length - 1) {
                            jumpToFile(filteredFiles[activeFileIndex + 1].path);
                          }
                        },
                      }
                    : undefined
                }
                onToggleCollapse={toggleCollapse}
                onCopyPath={handleCopyPath}
                onOpenFileComment={openFileLevelComposer}
                onToggleReviewed={handleToggleReviewedWithAdvance}
                onOpenLineComposer={openLineComposer}
                onEditAnnotation={startEditAnnotation}
                onDeleteAnnotation={deleteAnnotation}
                onSaveDraft={handleSaveDraft}
                onCancelDraft={handleCancelDraft}
                pushToast={pushToast}
                registerRef={registerCardRef}
              />
            ))
          )}
        </div>
      </section>

      {/* 3. 底部审核结论与剪贴板反馈区 */}
      <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-foreground">提交前人工审核结论</span>
            <div className="inline-flex items-center rounded-lg border border-zinc-200/85 dark:border-border/70 p-0.5 text-[11px]">
              {(
                [
                  { id: 'request_changes', label: '需修改再提交' },
                  { id: 'approve_with_notes', label: '带备注通过' },
                  { id: 'approved', label: '准予 Commit' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setVerdict(item.id)}
                  className={`px-2 py-0.5 rounded-md cursor-pointer whitespace-nowrap ${
                    verdict === item.id
                      ? 'bg-zinc-100 dark:bg-surface-secondary font-semibold text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 rounded-lg text-[11px]"
              onPress={() => setShowPreviewDrawer((v) => !v)}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{showPreviewDrawer ? '收起文本预览' : '预览反馈文本'}</span>
            </Button>

            {annotations.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 rounded-lg text-[11px] text-rose-600 dark:text-rose-400"
                onPress={() => {
                  setAnnotations([]);
                  setReviewedPaths(new Set());
                  setOverallNote('');
                  setDraft(null);
                  pushToast('已清空本轮批注与审阅标记', 'info');
                }}
              >
                <X className="w-3.5 h-3.5" />
                <span>清空批注</span>
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-[11px]"
              onPress={() =>
                handleCopy(
                  'approve-commit',
                  formatReviewFeedbackMarkdown({
                    repoCode: diffResult?.repo_code || selectedRepo || 'repo',
                    branch: diffResult?.branch || 'HEAD',
                    scope,
                    verdict: 'approved',
                    overallNote,
                    annotations: [],
                    reviewedFilesCount: reviewedCount,
                    totalFilesCount: files.length,
                  }),
                  '已复制放行 Commit 指令，可回 Antigravity 粘贴提交'
                )
              }
            >
              {copiedKey === 'approve-commit' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>复制放行 Commit</span>
            </Button>

            <Button
              size="sm"
              variant="primary"
              className="h-7 px-3 rounded-lg text-[11px]"
              onPress={() =>
                handleCopy(
                  'feedback',
                  feedbackMarkdown,
                  '已复制结构化审阅反馈，回 Antigravity 对话粘贴即可'
                )
              }
            >
              {copiedKey === 'feedback' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>复制审阅反馈 ({annotations.length})</span>
            </Button>
          </div>
        </div>

        {annotations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {annotations.map((ann) => {
              const meta = REVIEW_TAG_META[ann.tag] ?? REVIEW_TAG_META.change;
              const { base } = splitFilePath(ann.filePath);
              return (
                <button
                  key={ann.id}
                  type="button"
                  onClick={() => jumpToFile(ann.filePath)}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-200/85 dark:border-border/70 text-[11px] hover:bg-zinc-50 dark:hover:bg-surface-secondary cursor-pointer max-w-[260px]"
                >
                  <span className={`px-1 rounded border text-[9.5px] shrink-0 ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                  <span className="font-mono text-muted shrink-0">
                    {base}:{ann.lineStart ?? 'file'}
                  </span>
                  <span className="truncate text-foreground">{ann.comment}</span>
                </button>
              );
            })}
          </div>
        )}

        <input
          value={overallNote}
          onChange={(e) => setOverallNote(e.target.value)}
          placeholder="补充全局设计意见或建议的 Commit Message（可选，会随复制文本一并带出）…"
          className="w-full h-8 px-3 rounded-lg border border-zinc-200/90 dark:border-border/70 bg-zinc-50/50 dark:bg-surface-secondary/40 text-[11.5px] text-foreground outline-none focus:border-zinc-400"
        />

        {showPreviewDrawer && (
          <pre className="p-3 rounded-xl border border-zinc-200/85 dark:border-border/75 bg-zinc-50/70 dark:bg-surface-secondary/40 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto max-h-56 select-text">
            {feedbackMarkdown}
          </pre>
        )}
      </section>
    </div>
  );
}
