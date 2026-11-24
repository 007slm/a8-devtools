export type DiffScope = 'all' | 'staged' | 'unstaged';
export type DiffViewMode = 'unified' | 'split';
export type DiffFileCategory = 'source' | 'test' | 'config_docs' | 'generated';
export type ReviewTag = 'design' | 'bug' | 'change' | 'question';
export type ReviewVerdict = 'request_changes' | 'approve_with_notes' | 'approved';

export interface RemovedTestHit {
  filePath: string;
  name: string;
  line: number | null;
  side: 'old' | 'new';
  kind: 'removed' | 'disabled';
}

export const DIFF_CATEGORY_ORDER: readonly DiffFileCategory[] = [
  'source',
  'test',
  'config_docs',
  'generated',
] as const;

export const DIFF_CATEGORY_META: Record<
  DiffFileCategory,
  {
    label: string;
    shortLabel: string;
    badgeClass: string;
    defaultCollapsedWhenSourcePresent: boolean;
  }
> = {
  source: {
    label: '核心源码',
    shortLabel: '源码',
    badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25',
    defaultCollapsedWhenSourcePresent: false,
  },
  test: {
    label: '测试代码',
    shortLabel: '测试',
    badgeClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25',
    defaultCollapsedWhenSourcePresent: true,
  },
  config_docs: {
    label: '配置与文档',
    shortLabel: '配置文档',
    badgeClass: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-400/30',
    defaultCollapsedWhenSourcePresent: true,
  },
  generated: {
    label: '锁文件与产物',
    shortLabel: '产物',
    badgeClass: 'bg-zinc-500/8 text-muted border-zinc-300/70 dark:border-border/70',
    defaultCollapsedWhenSourcePresent: true,
  },
};

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

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'poetry.lock',
  'uv.lock',
  'go.sum',
  'composer.lock',
  'gemfile.lock',
  'gradle.lockfile',
  'bun.lock',
  'bun.lockb',
]);

const CONFIG_EXACT_NAMES = new Set([
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
  'package.json',
  'jsconfig.json',
  'cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'makefile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  'oxlintrc.json',
]);

/**
 * 按确定性路径与命名约定对变更文件分层（Java / Maven-Gradle 优先，兼顾全栈项目）
 */
export function classifyDiffFile(file: Pick<GitDiffFileEntry, 'path' | 'is_binary'>): DiffFileCategory {
  const norm = file.path.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const slashIdx = norm.lastIndexOf('/');
  const base = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
  const baseLower = base.toLowerCase();

  // 1. 锁文件与打包/生成产物
  if (
    LOCKFILE_NAMES.has(baseLower) ||
    /(?:^|\/)(?:dist|build|target|out|generated|\.next|ui\/assets)\//.test(lower) ||
    /\.(?:min\.js|min\.css|map|snap|pb\.go|d\.ts\.map)$/i.test(baseLower) ||
    /\.generated\.[a-z0-9]+$/i.test(baseLower)
  ) {
    return 'generated';
  }

  // 2. 测试代码与测试资源（Java Maven/Gradle src/test 最高优先级，大小写敏感避免误伤 Commit.java/Limit.java）
  if (
    /(?:^|\/)(?:src\/(?:test|it|integration-test|integration-tests|androidtest)|test|tests|__tests__|__mocks__|e2e|integration-test|integration-tests|unit-test|unit-tests|specs?|testdata|fixtures)\//i.test(
      lower
    ) ||
    /(?:Test|Tests|TestCase|IT|ITCase|Spec|Specs)\.(?:java|kt|kts|groovy|scala)$/.test(base) ||
    /^Test[A-Z].*\.(?:java|kt|kts|groovy|scala)$/.test(base) ||
    /(?:\.test|\.spec|-test|-spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(baseLower) ||
    /(?:^test_.*|_test)\.py$/i.test(baseLower) ||
    baseLower === 'conftest.py' ||
    /_test\.(?:go|rs)$/i.test(baseLower)
  ) {
    return 'test';
  }

  // 非测试目录下的二进制资产归入产物
  if (file.is_binary) {
    return 'generated';
  }

  // 3. 文档与构建/工程配置
  if (
    /(?:^|\/)(?:docs|doc|\.github|\.gitlab|\.vscode|\.idea|\.agents)\//.test(lower) ||
    CONFIG_EXACT_NAMES.has(baseLower) ||
    /^(?:readme|changelog|license|contributing|agents|gemini|claude)(?:\.[a-z0-9]+)?$/i.test(baseLower) ||
    /^(?:tsconfig(?:\.[^.]+)?\.json|vite\.config\.[a-z]+|vitest\.config\.[a-z]+|jest\.config\.[a-z]+|dockerfile(?:\..+)?|docker-compose.*\.ya?ml|\.prettierrc.*|\.eslintrc.*|requirements.*\.txt)$/i.test(
      baseLower
    ) ||
    /\.(?:md|mdx|txt|rst|adoc|ya?ml|toml|ini|properties|cfg|conf|env|json|jsonc|json5)$/i.test(baseLower)
  ) {
    return 'config_docs';
  }

  // 4. 核心业务源码（.java/.kt/.ts/.tsx/.js/.sql/MyBatis .xml/.py/.go/.rs 等）
  return 'source';
}

export function sortFilesByReviewCategory<T extends Pick<GitDiffFileEntry, 'path' | 'is_binary'>>(
  files: T[]
): T[] {
  const rank = (cat: DiffFileCategory) => DIFF_CATEGORY_ORDER.indexOf(cat);
  return [...files].sort((a, b) => {
    const diff = rank(classifyDiffFile(a)) - rank(classifyDiffFile(b));
    if (diff !== 0) return diff;
    return a.path.localeCompare(b.path);
  });
}

const JAVA_TEST_ANNOTATION_RE = /^\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|DynamicTest)\b/;
const JAVA_DISABLE_ANNOTATION_RE = /^\s*@(?:Disabled|Ignore)\b/;
const JAVA_METHOD_NAME_RE =
  /\b(?:void|fun)\s+([A-Za-z_][A-Za-z0-9_]*|`[^`]+`)\s*(?:<[^>]*>)?\s*\(/;
const JAVA_LEGACY_TEST_METHOD_RE = /\bvoid\s+(test[A-Z0-9_][A-Za-z0-9_]*)\s*\(/;
const JS_TEST_CALL_RE = /^\s*(?:it|test)(?:\.(?:only|concurrent))?\s*\(\s*(['"`])(.+?)\1/;
const JS_SKIP_CALL_RE = /^\s*(?:it|test)\.skip\s*\(\s*(['"`])(.+?)\1/;
const PY_TEST_DEF_RE = /^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/;
const PY_SKIP_DECORATOR_RE = /^\s*@(?:pytest\.mark\.skip(?:if)?|unittest\.skip(?:If|Unless)?)\b/;
const GO_TEST_FUNC_RE = /^\s*func\s+(Test[A-Za-z0-9_]+)\s*\(/;

function findUpcomingJavaMethodName(
  lines: DiffLine[],
  fromIdx: number,
  allowedTypes: Set<DiffLine['type']>
): { name: string; line: DiffLine } | null {
  let scanned = 0;
  for (let i = fromIdx + 1; i < lines.length && scanned < 7; i++) {
    const ln = lines[i];
    if (!allowedTypes.has(ln.type)) continue;
    const trimmed = ln.content.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    scanned++;
    if (trimmed.startsWith('@')) continue;
    const m = ln.content.match(JAVA_METHOD_NAME_RE);
    if (m) {
      return { name: m[1].replace(/^`|`$/g, ''), line: ln };
    }
    // 遇到非注解且非方法声明的代码行即停止前探，避免跨到下一个方法
    if (trimmed.includes(';') || trimmed.startsWith('class ') || trimmed.startsWith('interface ')) {
      break;
    }
  }
  return null;
}

/**
 * 删测雷达（借鉴 /summarize-pr removed-tests 思想）：
 * 识别测试文件中被删除或新增 @Disabled/@Ignore/.skip 禁用的测试用例，自动剔除仅改签名/重排的误报。
 */
export function detectRemovedTests(
  file: GitDiffFileEntry,
  preParsedHunks?: DiffHunk[]
): RemovedTestHit[] {
  if (file.is_binary || classifyDiffFile(file) !== 'test') return [];

  const hunks = preParsedHunks ?? parseUnifiedFileDiff(file.diff_text);
  if (hunks.length === 0) return [];

  const lowerPath = file.path.toLowerCase();
  const isJvm = /\.(?:java|kt|kts|groovy|scala)$/.test(lowerPath);
  const isJs = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(lowerPath);
  const isPy = /\.py$/.test(lowerPath);
  const isGo = /\.go$/.test(lowerPath);

  if (!isJvm && !isJs && !isPy && !isGo) return [];

  const removedCandidates: RemovedTestHit[] = [];
  const disabledCandidates: RemovedTestHit[] = [];
  const addedActiveNames = new Set<string>();

  for (const hunk of hunks) {
    const lines = hunk.lines;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];

      if (isJvm) {
        if (ln.type === 'add') {
          if (JAVA_TEST_ANNOTATION_RE.test(ln.content)) {
            const found = findUpcomingJavaMethodName(lines, i, new Set(['add', 'context']));
            if (found) addedActiveNames.add(found.name);
          } else if (JAVA_DISABLE_ANNOTATION_RE.test(ln.content)) {
            const found = findUpcomingJavaMethodName(lines, i, new Set(['add', 'context']));
            disabledCandidates.push({
              filePath: file.path,
              name: found ? found.name : `L${ln.newLine ?? '?'}`,
              line: ln.newLine,
              side: 'new',
              kind: 'disabled',
            });
          } else {
            const legacy = ln.content.match(JAVA_LEGACY_TEST_METHOD_RE);
            if (legacy) addedActiveNames.add(legacy[1]);
          }
        } else if (ln.type === 'del') {
          if (JAVA_TEST_ANNOTATION_RE.test(ln.content)) {
            const found = findUpcomingJavaMethodName(lines, i, new Set(['del', 'context']));
            removedCandidates.push({
              filePath: file.path,
              name: found ? found.name : `L${ln.oldLine ?? '?'}`,
              line: found?.line.oldLine ?? ln.oldLine,
              side: 'old',
              kind: 'removed',
            });
          } else {
            const legacy = ln.content.match(JAVA_LEGACY_TEST_METHOD_RE);
            if (legacy) {
              removedCandidates.push({
                filePath: file.path,
                name: legacy[1],
                line: ln.oldLine,
                side: 'old',
                kind: 'removed',
              });
            }
          }
        }
      } else if (isJs) {
        if (ln.type === 'add') {
          const skipM = ln.content.match(JS_SKIP_CALL_RE);
          if (skipM) {
            disabledCandidates.push({
              filePath: file.path,
              name: skipM[2],
              line: ln.newLine,
              side: 'new',
              kind: 'disabled',
            });
          } else {
            const activeM = ln.content.match(JS_TEST_CALL_RE);
            if (activeM) addedActiveNames.add(activeM[2]);
          }
        } else if (ln.type === 'del') {
          const delM = ln.content.match(JS_TEST_CALL_RE);
          if (delM) {
            removedCandidates.push({
              filePath: file.path,
              name: delM[2],
              line: ln.oldLine,
              side: 'old',
              kind: 'removed',
            });
          }
        }
      } else if (isPy) {
        if (ln.type === 'add') {
          const defM = ln.content.match(PY_TEST_DEF_RE);
          if (defM) addedActiveNames.add(defM[1]);
          else if (PY_SKIP_DECORATOR_RE.test(ln.content)) {
            for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
              if (lines[j].type === 'del') continue;
              const nextDef = lines[j].content.match(PY_TEST_DEF_RE);
              if (nextDef) {
                disabledCandidates.push({
                  filePath: file.path,
                  name: nextDef[1],
                  line: ln.newLine,
                  side: 'new',
                  kind: 'disabled',
                });
                break;
              }
            }
          }
        } else if (ln.type === 'del') {
          const delM = ln.content.match(PY_TEST_DEF_RE);
          if (delM) {
            removedCandidates.push({
              filePath: file.path,
              name: delM[1],
              line: ln.oldLine,
              side: 'old',
              kind: 'removed',
            });
          }
        }
      } else if (isGo) {
        if (ln.type === 'add') {
          const addM = ln.content.match(GO_TEST_FUNC_RE);
          if (addM) addedActiveNames.add(addM[1]);
        } else if (ln.type === 'del') {
          const delM = ln.content.match(GO_TEST_FUNC_RE);
          if (delM) {
            removedCandidates.push({
              filePath: file.path,
              name: delM[1],
              line: ln.oldLine,
              side: 'old',
              kind: 'removed',
            });
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  const results: RemovedTestHit[] = [];

  for (const hit of disabledCandidates) {
    const key = `disabled:${hit.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(hit);
    }
  }
  for (const hit of removedCandidates) {
    // 同一测试名若在同文件重新添加（如仅改签名/注解）则不算删除；但若已被新增 @Disabled/.skip 禁用则不再重复报删除
    if (addedActiveNames.has(hit.name) || seen.has(`disabled:${hit.name}`)) continue;
    const key = `removed:${hit.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(hit);
    }
  }

  return results;
}
