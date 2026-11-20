export type ProposalMarkupType = 'comment' | 'delete' | 'replace';

export interface ProposalAnnotation {
  id: string;
  type: ProposalMarkupType;
  quote: string;
  section: string;
  comment: string;
  replacement: string;
  createdAt: number;
}

export interface StoredProposalReview {
  annotations: ProposalAnnotation[];
  overallNote: string;
}

export const PROPOSAL_MARKUP_META: Record<
  ProposalMarkupType,
  { label: string; badgeClass: string; borderClass: string }
> = {
  comment: {
    label: '批注',
    badgeClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
    borderClass: 'border-amber-500/35',
  },
  delete: {
    label: '划删 / 不采纳',
    badgeClass: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30',
    borderClass: 'border-rose-500/35',
  },
  replace: {
    label: '替换建议',
    badgeClass: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/35',
  },
};

function storageKey(fileName: string): string {
  return `a8_proposal_annotations_v1:${fileName}`;
}

export function loadProposalReview(fileName: string): StoredProposalReview {
  const empty: StoredProposalReview = { annotations: [], overallNote: '' };
  if (!fileName) return empty;
  try {
    const raw = window.localStorage.getItem(storageKey(fileName));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredProposalReview>;
    return {
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      overallNote: typeof parsed.overallNote === 'string' ? parsed.overallNote : '',
    };
  } catch (err) {
    console.warn('[ProposalAnnotator] 读取批注缓存失败:', err);
    return empty;
  }
}

export function saveProposalReview(fileName: string, state: StoredProposalReview): void {
  if (!fileName) return;
  if (state.annotations.length === 0 && !state.overallNote.trim()) {
    window.localStorage.removeItem(storageKey(fileName));
    return;
  }
  window.localStorage.setItem(storageKey(fileName), JSON.stringify(state));
}

export function formatProposalFeedbackText(params: {
  title: string;
  fileName: string;
  absPath: string;
  annotations: ProposalAnnotation[];
  overallNote: string;
}): string {
  const { title, fileName, absPath, annotations, overallNote } = params;
  const lines: string[] = [
    `## 每日提案人工划词批注 (${title || fileName})`,
    `- **提案文件**：\`${absPath || fileName}\``,
  ];
  if (overallNote.trim()) {
    lines.push(`- **总体推进意见**：${overallNote.trim()}`);
  }
  if (annotations.length > 0) {
    lines.push('', `### 逐条审阅批注（共 ${annotations.length} 条）`);
    annotations.forEach((ann, idx) => {
      const meta = PROPOSAL_MARKUP_META[ann.type] ?? PROPOSAL_MARKUP_META.comment;
      const sectionTag = ann.section ? `（章节：${ann.section}）` : '';
      const shortQuote = ann.quote.replace(/\s+/g, ' ').trim();
      lines.push(`${idx + 1}. **[${meta.label}]**${sectionTag}`);
      lines.push(`   > ${shortQuote}`);
      if (ann.type === 'replace' && ann.replacement.trim()) {
        lines.push(`   - **建议改为**：${ann.replacement.trim()}`);
      }
      if (ann.comment.trim()) {
        lines.push(`   - **意见**：${ann.comment.trim()}`);
      } else if (ann.type === 'delete') {
        lines.push('   - **意见**：不采纳 / 删减该部分内容');
      }
    });
  }
  return lines.join('\n');
}

export function buildProposalAdvancePrompt(params: {
  title: string;
  fileName: string;
  absPath: string;
  annotations: ProposalAnnotation[];
  overallNote: string;
}): string {
  const base = `请阅读提案文件 \`${params.absPath}\` 以及 \`AGENTS.md\`，并与我确认后开始推进实施其中的工作流提升提案（优先推进 P0/P1 项，先给出本次拟落地的改造计划）。`;
  if (params.annotations.length === 0 && !params.overallNote.trim()) {
    return base;
  }
  const feedback = formatProposalFeedbackText(params);
  return `${base}\n\n以下是我在工作台对该提案做的**人工划词审阅意见**，请严格按批注取舍（标记「划删 / 不采纳」的内容跳过勿实施，标记「替换建议」的按新方案推进）：\n\n${feedback}`;
}
