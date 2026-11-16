export type DiffScope = 'all' | 'staged' | 'unstaged';
export type DiffViewMode = 'unified' | 'split';
export type ReviewTag = 'design' | 'bug' | 'change' | 'question';
export type ReviewVerdict = 'request_changes' | 'approve_with_notes' | 'approved';

export interface GitDiffFileEntry {
  path: string;
  old_path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | string;
  additions: number;
  deletions: number;
  is_binary: boolean;
  truncated: boolean;
  diff_text: string;
}

export interface GitReviewDiffResult {
  repo_code: string;
  repo_path: string;
  branch: string;
  head_summary: string;
  scope: DiffScope | string;
  has_head: boolean;
  total_additions: number;
  total_deletions: number;
  files: GitDiffFileEntry[];
}

export interface DiffLine {
  index: number;
  type: 'context' | 'add' | 'del' | 'meta';
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface SplitDiffRow {
  key: string;
  left: DiffLine | null;
  right: DiffLine | null;
  leftHighlight?: [number, number] | null;
  rightHighlight?: [number, number] | null;
}

export interface ReviewAnnotation {
  id: string;
  filePath: string;
  side: 'new' | 'old' | 'file';
  lineStart: number | null;
  lineEnd: number | null;
  tag: ReviewTag;
  comment: string;
  suggestion: string;
  codeExcerpt: string;
  createdAt: number;
}

export const REVIEW_TAG_META: Record<
  ReviewTag,
  { label: string; badgeClass: string; borderClass: string }
> = {
  design: {
    label: '设计问题',
    badgeClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
    borderClass: 'border-amber-500/40',
  },
  bug: {
    label: '逻辑缺陷',
    badgeClass: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30',
    borderClass: 'border-rose-500/40',
  },
  change: {
    label: '修改建议',
    badgeClass: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
  },
  question: {
    label: '疑问确认',
    badgeClass: 'bg-zinc-500/12 text-zinc-700 dark:text-zinc-300 border-zinc-400/35',
    borderClass: 'border-zinc-400/40',
  },
};

export function parseUnifiedFileDiff(diffText: string): DiffHunk[] {
  if (!diffText) return [];
  const rawLines = diffText.replace(/\r\n/g, '\n').split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let globalIdx = 0;

  for (const line of rawLines) {
    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldLine = match ? parseInt(match[1], 10) : 1;
      newLine = match ? parseInt(match[2], 10) : 1;
      current = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('\\ ')) {
      current.lines.push({
        index: globalIdx++,
        type: 'meta',
        oldLine: null,
        newLine: null,
        content: line,
      });
    } else if (line.startsWith('+')) {
      current.lines.push({
        index: globalIdx++,
        type: 'add',
        oldLine: null,
        newLine: newLine++,
        content: line.slice(1),
      });
    } else if (line.startsWith('-')) {
      current.lines.push({
        index: globalIdx++,
        type: 'del',
        oldLine: oldLine++,
        newLine: null,
        content: line.slice(1),
      });
    } else {
      current.lines.push({
        index: globalIdx++,
        type: 'context',
        oldLine: oldLine++,
        newLine: newLine++,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  return hunks;
}

/** 计算单对删除/新增行的行内差异高亮区间（避免整行大面积染色掩盖实际变动点） */
export function computeIntraLineDiff(
  oldText: string,
  newText: string
): { left: [number, number] | null; right: [number, number] | null } {
  if (!oldText || !newText || oldText === newText) {
    return { left: null, right: null };
  }
  const minLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  const leftEnd = oldText.length - suffix;
  const rightEnd = newText.length - suffix;
  return {
    left: leftEnd > prefix ? [prefix, leftEnd] : null,
    right: rightEnd > prefix ? [prefix, rightEnd] : null,
  };
}

export function buildSplitRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    if (cur.type === 'context' || cur.type === 'meta') {
      rows.push({
        key: `ctx-${cur.index}`,
        left: cur,
        right: cur.type === 'context' ? cur : null,
      });
      i++;
      continue;
    }

    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') {
      dels.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === 'add') {
      adds.push(lines[i]);
      i++;
    }

    const pairCount = Math.max(dels.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      const left = dels[k] ?? null;
      const right = adds[k] ?? null;
      const intra =
        left && right && dels.length === adds.length
          ? computeIntraLineDiff(left.content, right.content)
          : { left: null, right: null };
      rows.push({
        key: `chg-${left?.index ?? 'x'}-${right?.index ?? 'x'}-${k}`,
        left,
        right,
        leftHighlight: intra.left,
        rightHighlight: intra.right,
      });
    }
  }
  return rows;
}

export function formatAnchorLabel(ann: Pick<ReviewAnnotation, 'side' | 'lineStart' | 'lineEnd'>): string {
  if (ann.side === 'file' || ann.lineStart === null) {
    return '整文件';
  }
  const prefix = ann.side === 'old' ? '旧代码' : '新代码';
  if (ann.lineEnd !== null && ann.lineEnd !== ann.lineStart) {
    return `${prefix} L${ann.lineStart}-L${ann.lineEnd}`;
  }
  return `${prefix} L${ann.lineStart}`;
}

export function formatReviewFeedbackMarkdown(params: {
  repoCode: string;
  branch: string;
  scope: string;
  verdict: ReviewVerdict;
  overallNote: string;
  annotations: ReviewAnnotation[];
  reviewedFilesCount: number;
  totalFilesCount: number;
}): string {
  const {
    repoCode,
    branch,
    scope,
    verdict,
    overallNote,
    annotations,
    reviewedFilesCount,
    totalFilesCount,
  } = params;

  const scopeLabel =
    scope === 'staged' ? '已暂存 (staged)' : scope === 'unstaged' ? '未暂存 (unstaged)' : '全部未提交改动';

  if (verdict === 'approved' && annotations.length === 0) {
    const noteLine = overallNote.trim() ? `\n\n补充说明：${overallNote.trim()}` : '';
    return `代码审核已通过（仓库 \`${repoCode}\` · 分支 \`${branch}\` · 范围：${scopeLabel} · 已核验 ${reviewedFilesCount}/${totalFilesCount} 个文件），请执行 \`git commit\`。${noteLine}`;
  }

  const verdictHeader =
    verdict === 'approved'
      ? '审阅通过（含备注），可继续执行 `git commit`'
      : verdict === 'approve_with_notes'
        ? '有条件通过：请先处理以下备注后即可 `git commit`'
        : '审阅未通过：请先按以下批注修改代码，暂勿执行 `git commit`';

  const lines: string[] = [
    `## 代码提交前人工审核反馈 (${repoCode} · ${branch})`,
    '',
    `- **审核结论**：${verdictHeader}`,
    `- **审核范围**：${scopeLabel}（已审阅 ${reviewedFilesCount}/${totalFilesCount} 个文件，共 ${annotations.length} 条批注）`,
  ];

  if (overallNote.trim()) {
    lines.push(`- **总体意见**：${overallNote.trim()}`);
  }

  if (annotations.length > 0) {
    const byFile = new Map<string, ReviewAnnotation[]>();
    for (const item of annotations) {
      const list = byFile.get(item.filePath) ?? [];
      list.push(item);
      byFile.set(item.filePath, list);
    }

    lines.push('', '### 分文件修改清单');
    let seq = 1;
    for (const [filePath, items] of byFile.entries()) {
      lines.push('', `#### \`${filePath}\``);
      const sorted = [...items].sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0));
      for (const ann of sorted) {
        const tagLabel = REVIEW_TAG_META[ann.tag]?.label || ann.tag;
        const anchor = formatAnchorLabel(ann);
        lines.push(`${seq}. **[${tagLabel}] (${anchor})**：${ann.comment.trim()}`);
        if (ann.codeExcerpt.trim()) {
          lines.push('   ```text');
          for (const codeLine of ann.codeExcerpt.split('\n').slice(0, 12)) {
            lines.push(`   ${codeLine}`);
          }
          lines.push('   ```');
        }
        if (ann.suggestion.trim()) {
          lines.push('   建议替换为：');
          lines.push('   ```text');
          for (const sugLine of ann.suggestion.replace(/\r\n/g, '\n').split('\n')) {
            lines.push(`   ${sugLine}`);
          }
          lines.push('   ```');
        }
        seq++;
      }
    }
  }

  lines.push('', '请按上述意见调整后告知我，我会在工作台刷新 Diff 复核；在得到明确放行前不要执行 `git commit`。');
  return lines.join('\n');
}
