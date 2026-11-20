import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import {
  Check,
  Copy,
  Edit3,
  Highlighter,
  MessageSquarePlus,
  Replace,
  Send,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react';
import { copyTextSafe } from '../utils/clipboard';
import {
  PROPOSAL_MARKUP_META,
  formatProposalFeedbackText,
  type ProposalAnnotation,
  type ProposalMarkupType,
} from '../utils/proposalAnnotations';

interface ProposalDetailAnnotatorProps {
  fileName: string;
  title: string;
  absPath: string;
  annotations: ProposalAnnotation[];
  overallNote: string;
  onChangeAnnotations: (next: ProposalAnnotation[]) => void;
  onChangeOverallNote: (next: string) => void;
  onAdvanceWithAnnotations: () => void;
  advancing: boolean;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  children: ReactNode;
}

interface FloatingSelectionState {
  quote: string;
  section: string;
  top: number;
  left: number;
  mode: 'bar' | 'compose';
  markupType: ProposalMarkupType;
  editingId: string | null;
}

function findNearestSectionHeading(articleEl: HTMLElement, anchorNode: Node): string {
  const headings = Array.from(articleEl.querySelectorAll<HTMLElement>('[data-section-heading]'));
  let best = '';
  for (const h of headings) {
    if (h.contains(anchorNode)) {
      return h.dataset.sectionHeading || h.textContent?.trim() || '';
    }
    const pos = h.compareDocumentPosition(anchorNode);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = h.dataset.sectionHeading || h.textContent?.trim() || '';
    }
  }
  return best;
}

export function ProposalDetailAnnotator({
  fileName,
  title,
  absPath,
  annotations,
  overallNote,
  onChangeAnnotations,
  onChangeOverallNote,
  onAdvanceWithAnnotations,
  advancing,
  pushToast,
  children,
}: ProposalDetailAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [selectionUI, setSelectionUI] = useState<FloatingSelectionState | null>(null);
  const [composeComment, setComposeComment] = useState('');
  const [composeReplacement, setComposeReplacement] = useState('');
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const closePopover = useCallback(() => {
    setSelectionUI(null);
    setComposeComment('');
    setComposeReplacement('');
  }, []);

  useEffect(() => {
    closePopover();
  }, [fileName, closePopover]);

  useEffect(() => {
    if (!selectionUI) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      if (selectionUI.mode === 'bar') {
        setSelectionUI(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectionUI, closePopover]);

  const handleArticleMouseUp = useCallback(() => {
    const containerEl = containerRef.current;
    const articleEl = articleRef.current;
    if (!containerEl || !articleEl) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (!articleEl.contains(range.commonAncestorContainer)) return;

    const rawQuote = sel.toString().replace(/\r\n/g, '\n').trim();
    if (rawQuote.length < 2) return;

    const rect = range.getBoundingClientRect();
    const hostRect = containerEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const top = Math.max(8, rect.top - hostRect.top - 42);
    const maxLeft = Math.max(8, hostRect.width - 280);
    const left = Math.min(maxLeft, Math.max(8, rect.left - hostRect.left));
    const section = findNearestSectionHeading(articleEl, range.startContainer);

    setSelectionUI({
      quote: rawQuote.slice(0, 600),
      section,
      top,
      left,
      mode: 'bar',
      markupType: 'comment',
      editingId: null,
    });
    setComposeComment('');
    setComposeReplacement(rawQuote.slice(0, 600));
  }, []);

  const quickStrikeDelete = useCallback(() => {
    if (!selectionUI) return;
    const nextAnn: ProposalAnnotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'delete',
      quote: selectionUI.quote,
      section: selectionUI.section,
      comment: '',
      replacement: '',
      createdAt: Date.now(),
    };
    onChangeAnnotations([...annotations, nextAnn]);
    window.getSelection()?.removeAllRanges();
    closePopover();
    pushToast('已标记「划删 / 不采纳」', 'success');
  }, [selectionUI, annotations, onChangeAnnotations, closePopover, pushToast]);

  const openComposeMode = useCallback((type: ProposalMarkupType) => {
    setSelectionUI((prev) =>
      prev
        ? {
            ...prev,
            mode: 'compose',
            markupType: type,
          }
        : null
    );
  }, []);

  const saveCompose = useCallback(() => {
    if (!selectionUI) return;
    const cleanComment = composeComment.trim();
    const cleanReplacement = composeReplacement.trim();
    if (selectionUI.markupType === 'comment' && !cleanComment) {
      pushToast('请输入批注内容', 'info');
      return;
    }
    if (selectionUI.markupType === 'replace' && !cleanReplacement) {
      pushToast('请输入替换后的内容', 'info');
      return;
    }

    if (selectionUI.editingId) {
      const targetId = selectionUI.editingId;
      onChangeAnnotations(
        annotations.map((item) =>
          item.id === targetId
            ? {
                ...item,
                type: selectionUI.markupType,
                comment: cleanComment,
                replacement: selectionUI.markupType === 'replace' ? cleanReplacement : '',
              }
            : item
        )
      );
      pushToast('已更新提案批注', 'success');
    } else {
      const nextAnn: ProposalAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: selectionUI.markupType,
        quote: selectionUI.quote,
        section: selectionUI.section,
        comment: cleanComment,
        replacement: selectionUI.markupType === 'replace' ? cleanReplacement : '',
        createdAt: Date.now(),
      };
      onChangeAnnotations([...annotations, nextAnn]);
      pushToast(`已添加${PROPOSAL_MARKUP_META[selectionUI.markupType].label}`, 'success');
    }

    window.getSelection()?.removeAllRanges();
    closePopover();
  }, [
    selectionUI,
    composeComment,
    composeReplacement,
    annotations,
    onChangeAnnotations,
    closePopover,
    pushToast,
  ]);

  const startEditAnnotation = useCallback((ann: ProposalAnnotation) => {
    setSelectionUI({
      quote: ann.quote,
      section: ann.section,
      top: 12,
      left: 12,
      mode: 'compose',
      markupType: ann.type,
      editingId: ann.id,
    });
    setComposeComment(ann.comment);
    setComposeReplacement(ann.replacement || ann.quote);
  }, []);

  const deleteAnnotation = useCallback(
    (id: string) => {
      onChangeAnnotations(annotations.filter((item) => item.id !== id));
    },
    [annotations, onChangeAnnotations]
  );

  const feedbackText = useMemo(
    () =>
      formatProposalFeedbackText({
        title,
        fileName,
        absPath,
        annotations,
        overallNote,
      }),
    [title, fileName, absPath, annotations, overallNote]
  );

  const handleCopyFeedback = useCallback(async () => {
    const ok = await copyTextSafe(feedbackText);
    if (ok) {
      setCopiedFeedback(true);
      pushToast('已复制提案划词批注，可粘贴到 Antigravity 对话中', 'success');
      setTimeout(() => setCopiedFeedback(false), 1800);
    } else {
      pushToast('复制失败，请检查剪贴板权限', 'danger');
    }
  }, [feedbackText, pushToast]);

  return (
    <div ref={containerRef} className="relative space-y-4">
      {/* 可划词正文区域 */}
      <div ref={articleRef} onMouseUp={handleArticleMouseUp}>
        {children}
      </div>

      {/* Plannotator 风格划词浮动条 / 批注弹框 */}
      {selectionUI && (
        <div
          ref={popoverRef}
          style={{ top: `${selectionUI.top}px`, left: `${selectionUI.left}px` }}
          className="absolute z-30 rounded-xl border border-zinc-300 dark:border-border bg-white dark:bg-surface shadow-lg"
        >
          {selectionUI.mode === 'bar' ? (
            <div className="flex items-center gap-1 p-1 text-[11px]">
              <button
                type="button"
                onClick={() => openComposeMode('comment')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-amber-500/12 text-amber-700 dark:text-amber-300 font-medium cursor-pointer whitespace-nowrap"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>批注</span>
              </button>
              <button
                type="button"
                onClick={quickStrikeDelete}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-rose-500/12 text-rose-700 dark:text-rose-300 font-medium cursor-pointer whitespace-nowrap"
              >
                <Strikethrough className="w-3.5 h-3.5" />
                <span>划删</span>
              </button>
              <button
                type="button"
                onClick={() => openComposeMode('replace')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-sky-500/12 text-sky-700 dark:text-sky-300 font-medium cursor-pointer whitespace-nowrap"
              >
                <Replace className="w-3.5 h-3.5" />
                <span>替换</span>
              </button>
              <button
                type="button"
                onClick={closePopover}
                className="p-1 rounded-lg text-muted hover:text-foreground cursor-pointer"
                title="关闭"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="w-[340px] sm:w-[400px] p-3 space-y-2.5 text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1">
                  {(['comment', 'delete', 'replace'] as ProposalMarkupType[]).map((t) => {
                    const meta = PROPOSAL_MARKUP_META[t];
                    const active = selectionUI.markupType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => openComposeMode(t)}
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
                <button
                  type="button"
                  onClick={closePopover}
                  className="p-1 rounded text-muted hover:text-foreground cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-2.5 py-1.5 rounded-lg border border-zinc-200/80 dark:border-border/70 bg-zinc-50/70 dark:bg-surface-secondary/40 text-[11px] text-muted line-clamp-2">
                “{selectionUI.quote}”
              </div>

              {selectionUI.markupType === 'replace' && (
                <div className="space-y-1">
                  <div className="text-[10.5px] font-medium text-muted">替换为</div>
                  <textarea
                    value={composeReplacement}
                    onChange={(e) => setComposeReplacement(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-zinc-200/90 dark:border-border/80 bg-white dark:bg-surface px-2.5 py-1.5 text-[11.5px] text-foreground outline-none focus:border-zinc-400 resize-y"
                  />
                </div>
              )}

              <textarea
                value={composeComment}
                onChange={(e) => setComposeComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    saveCompose();
                  }
                }}
                rows={2}
                autoFocus
                placeholder={
                  selectionUI.markupType === 'delete'
                    ? '补充不采纳理由（可选，Ctrl+Enter 保存）…'
                    : '输入批注或实施要求（Ctrl+Enter 保存）…'
                }
                className="w-full rounded-lg border border-zinc-200/90 dark:border-border/80 bg-white dark:bg-surface px-2.5 py-1.5 text-[11.5px] text-foreground outline-none focus:border-zinc-400 resize-y"
              />

              <div className="flex items-center justify-end gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 px-2.5 rounded-lg text-[11px]" onPress={closePopover}>
                  取消
                </Button>
                <Button size="sm" variant="primary" className="h-7 px-3 rounded-lg text-[11px]" onPress={saveCompose}>
                  {selectionUI.editingId ? '保存修改' : '确认标记'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部划词批注清单与推进区 */}
      <div className="rounded-xl border border-zinc-200/85 dark:border-border/75 bg-zinc-50/50 dark:bg-surface-secondary/25 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11.5px]">
            <Highlighter className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-semibold text-foreground">划词审阅批注</span>
            <span className="text-[10.5px] font-mono text-muted">
              {annotations.length > 0 ? `${annotations.length} 条批注` : '划选上方任意文字可批注 / 划删 / 替换'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(annotations.length > 0 || overallNote.trim()) && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 rounded-lg text-[11px] text-rose-600 dark:text-rose-400"
                  onPress={() => {
                    onChangeAnnotations([]);
                    onChangeOverallNote('');
                    pushToast('已清空本提案划词批注', 'info');
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 rounded-lg text-[11px]"
                  onPress={handleCopyFeedback}
                >
                  {copiedFeedback ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>复制批注反馈</span>
                </Button>
              </>
            )}

            <Button
              size="sm"
              variant="primary"
              isPending={advancing}
              className="h-7 px-3 rounded-lg text-[11px]"
              onPress={onAdvanceWithAnnotations}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {annotations.length > 0 ? `带 ${annotations.length} 条批注回 Antigravity 推进` : '回到 Antigravity 推进'}
              </span>
            </Button>
          </div>
        </div>

        {annotations.length > 0 && (
          <div className="space-y-1.5">
            {annotations.map((ann, idx) => {
              const meta = PROPOSAL_MARKUP_META[ann.type] ?? PROPOSAL_MARKUP_META.comment;
              return (
                <div
                  key={ann.id}
                  className={`rounded-lg border ${meta.borderClass} bg-white dark:bg-surface px-3 py-2 text-[11.5px] space-y-1`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] text-muted">#{idx + 1}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                      {ann.section && (
                        <span className="text-[10.5px] text-muted truncate">{ann.section}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditAnnotation(ann)}
                        title="编辑批注"
                        className="p-1 rounded text-muted hover:text-foreground hover:bg-zinc-100 dark:hover:bg-surface-secondary cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAnnotation(ann.id)}
                        title="删除批注"
                        className="p-1 rounded text-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`text-[11px] text-muted border-l-2 border-zinc-200 dark:border-border pl-2 line-clamp-2 ${
                      ann.type === 'delete' ? 'line-through' : ''
                    }`}
                  >
                    {ann.quote}
                  </div>
                  {ann.type === 'replace' && ann.replacement.trim() && (
                    <div className="text-[11px] text-sky-700 dark:text-sky-300">
                      <span className="font-medium">替换为：</span>
                      {ann.replacement}
                    </div>
                  )}
                  {ann.comment.trim() && (
                    <div className="text-foreground whitespace-pre-wrap">{ann.comment}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <input
          value={overallNote}
          onChange={(e) => onChangeOverallNote(e.target.value)}
          placeholder="补充全局推进指示（例如：优先做提案 1 和 2，其余先延后；点击推进或复制时一并带出）…"
          className="w-full h-7 px-2.5 rounded-lg border border-zinc-200/90 dark:border-border/70 bg-white dark:bg-surface text-[11px] text-foreground outline-none focus:border-zinc-400"
        />
      </div>
    </div>
  );
}
