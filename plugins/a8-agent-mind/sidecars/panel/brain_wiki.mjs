import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const DEFAULT_SCHEMA_MD = `# A8 Brain · LLM Wiki 维护规范 (SCHEMA)

> 本知识库遵循 **LLM Wiki** 分层架构：人类随时记录原始素材（\`raw/\`），由 Antigravity（\`/a8-brain\`）负责消化提炼、分类建链维护知识网络（\`pages/\`、\`index.md\`、\`log.md\`），并在头脑风暴时按索引低 Token 精准调取。

## 1. 目录职责

- \`SCHEMA.md\`：本规范文件（约定分类、Frontmatter、互链与冲突处理）。
- \`index.md\`：全库按分类组织的导航索引（每条附一句话摘要），是 \`/a8-brain\` 检索的第一入口。
- \`log.md\`：追加式操作日志（记录每次整理归档、体检与回写）。
- \`raw/\`：原始素材收件箱（Twitter 帖子、文章摘录、随手记、链接）。整理后只更新 Frontmatter 中的 \`status: ingested\` 与 \`ingested_at\`，**保留原始正文不可变**。
- \`pages/\`：Antigravity 维护的互链知识页（可扁平存放 \`pages/<slug>.md\` 或按一级目录存放）。

## 2. Frontmatter 约定

- \`raw/*.md\`：\`title\`、\`source\`、\`tags\`、\`status\`（\`pending\` | \`ingested\`）、\`created_at\`、\`ingested_at\`
- \`pages/*.md\`：\`title\`、\`category\`、\`tags\`、\`summary\`、\`sources\`（指向 \`raw/...\`）、\`updated_at\`

## 3. 互链与演进原则

1. 正文统一使用 \`[[slug]]\` 或 \`[[slug|可读名]]\` 建立条目双向链接；新建或更新页面时，同步在相关旧页面补齐自然交叉引用。
2. 新旧观点出现冲突时，**严禁静默覆盖旧洞见**，应在条目内显式写出「适用条件分歧 / 观点演进」。
3. 每次整理（Ingest）或体检（Lint）完成后，务必同步更新 \`index.md\` 并在 \`log.md\` 追加一条记录。
`;

const DEFAULT_INDEX_MD = `# A8 Brain · 知识大脑总索引

> 每次发起 \`/a8-brain\` 头脑风暴时，优先读本索引定位 2～5 篇最相关条目，再精读对应 \`pages/\` 全文。

## Agent 与 Skill 玩法

<!-- 示例：- [[subagent-context-isolation|Subagent 上下文隔离原则]] — 通过隔离上下文降低主会话污染并提升并发效率 -->

## 学习与思考原则

## 架构与工程实践

## 工具与效率

## 待分类
`;

const DEFAULT_LOG_MD = `# A8 Brain · 变更日志

> 追加式记录知识库的整理归档（Ingest）、知识体检（Lint）与头脑风暴沉淀（Compound）。

`;

function formatCnDateTime(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return { ymdCompact: `${y}${m}${d}`, formatted: `${y}-${m}-${d} ${hh}:${mm}` };
}

function expandTilde(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = homedir();
    const suffix = trimmed.slice(1).replace(/^[/\\]+/, '');
    return suffix ? join(home, suffix) : home;
  }
  return trimmed;
}

function writeFileAtomic(targetPath, content) {
  const parent = dirname(targetPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const tmpPath = join(
    parent,
    `.${basename(targetPath)}.tmp.${process.pid}.${Date.now()}`
  );
  writeFileSync(tmpPath, content, 'utf-8');
  try {
    renameSync(tmpPath, targetPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    throw err;
  }
}

export function resolveWikiDirForPlugin(pluginRoot) {
  const defaultDir = join(pluginRoot, 'wiki');
  const cfgPath = join(pluginRoot, 'config.json');
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf-8');
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const custom = typeof parsed?.wiki_dir === 'string' ? parsed.wiki_dir.trim() : '';
    if (custom) {
      const expanded = expandTilde(custom);
      const resolved = isAbsolute(expanded) ? expanded : resolve(pluginRoot, expanded);
      return { wikiDir: resolved, defaultDir, isCustomDir: true };
    }
  }
  return { wikiDir: defaultDir, defaultDir, isCustomDir: false };
}

export function ensureBrainWikiScaffold(wikiRoot) {
  mkdirSync(join(wikiRoot, 'raw'), { recursive: true });
  mkdirSync(join(wikiRoot, 'pages'), { recursive: true });
  const defaults = [
    ['SCHEMA.md', DEFAULT_SCHEMA_MD],
    ['index.md', DEFAULT_INDEX_MD],
    ['log.md', DEFAULT_LOG_MD],
  ];
  for (const [name, content] of defaults) {
    const target = join(wikiRoot, name);
    if (!existsSync(target)) {
      writeFileAtomic(target, content);
    }
  }
}

export function normalizeWikiRelPath(raw) {
  const replaced = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!replaced) throw new Error('相对路径不能为空');
  if (
    replaced.includes('\0') ||
    replaced.includes(':') ||
    replaced.startsWith('/') ||
    replaced.startsWith('~')
  ) {
    throw new Error(`非法知识库路径: ${raw}`);
  }
  const segments = replaced.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.')) {
      throw new Error(`路径包含非法片段: ${raw}`);
    }
    if (seg.endsWith('.') || seg.endsWith(' ')) {
      throw new Error(`文件名不能以空格或点结尾: ${raw}`);
    }
  }
  if (!replaced.toLowerCase().endsWith('.md')) {
    throw new Error('知识库仅允许访问 .md 文件');
  }
  const normalized = segments.join('/');
  const allowed =
    (segments.length === 1 && ['SCHEMA.md', 'index.md', 'log.md'].includes(segments[0])) ||
    (segments[0] === 'raw' && segments.length >= 2 && segments.length <= 3) ||
    (segments[0] === 'pages' && segments.length >= 2 && segments.length <= 4);
  if (!allowed) {
    throw new Error(
      `路径越出知识库白名单（仅允许 SCHEMA.md、index.md、log.md、raw/*.md 与 pages/**/*.md）: ${normalized}`
    );
  }
  return normalized;
}

export function resolveSafeWikiPath(wikiRoot, relPath, mustExist) {
  const normalized = normalizeWikiRelPath(relPath);
  const canonicalRoot = realpathSync(wikiRoot);
  const candidate = resolve(canonicalRoot, ...normalized.split('/'));
  const relCheck = relative(canonicalRoot, candidate);
  if (relCheck.startsWith('..') || isAbsolute(relCheck)) {
    throw new Error('安全拦截：路径越出知识库根目录');
  }
  if (mustExist) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error(`知识库文件不存在: ${normalized}`);
    }
    const realTarget = realpathSync(candidate);
    const realRel = relative(canonicalRoot, realTarget);
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new Error('安全拦截：符号链接指向知识库目录之外');
    }
    return { normalized, absPath: realTarget };
  }
  const parent = dirname(candidate);
  if (existsSync(parent)) {
    const realParent = realpathSync(parent);
    const parentRel = relative(canonicalRoot, realParent);
    if (parentRel.startsWith('..') || isAbsolute(parentRel)) {
      throw new Error('安全拦截：目标父目录越出知识库范围');
    }
  }
  return { normalized, absPath: candidate };
}

function unquoteYamlValue(raw) {
  const trimmed = String(raw || '').trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseWikiFrontmatter(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  const scalars = {};
  const lists = {};
  if (!normalized.startsWith('---\n')) {
    return { scalars, lists, body: normalized };
  }
  const rest = normalized.slice(4);
  const endIdx = rest.indexOf('\n---');
  if (endIdx < 0) {
    return { scalars, lists, body: normalized };
  }
  const yamlBlock = rest.slice(0, endIdx);
  const after = rest.slice(endIdx + 4);
  const body = after.startsWith('\n') ? after.slice(1) : after;

  let activeListKey = null;
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ')) {
      if (activeListKey) {
        const val = unquoteYamlValue(trimmed.slice(2));
        if (val) {
          lists[activeListKey] = lists[activeListKey] || [];
          lists[activeListKey].push(val);
        }
      }
      continue;
    }
    activeListKey = null;
    const colon = trimmed.indexOf(':');
    if (colon > 0) {
      const key = trimmed.slice(0, colon).trim().toLowerCase();
      const val = trimmed.slice(colon + 1).trim();
      if (!val) {
        activeListKey = key;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        lists[key] = val
          .slice(1, -1)
          .split(',')
          .map((item) => unquoteYamlValue(item).trim())
          .filter(Boolean);
      } else {
        scalars[key] = unquoteYamlValue(val);
      }
    }
  }
  return { scalars, lists, body };
}

function inferTitleAndSummary(body, fallbackSlug) {
  let heading = '';
  let summary = '';
  let inCode = false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !t) continue;
    if (!heading && t.startsWith('# ')) {
      heading = t.slice(2).trim();
      continue;
    }
    if (
      !summary &&
      !t.startsWith('#') &&
      !t.startsWith('>') &&
      !t.startsWith('---') &&
      !t.startsWith('<!--')
    ) {
      const clean = t.replace(/^[-*\s]+/, '').trim();
      if (clean) summary = Array.from(clean).slice(0, 120).join('');
    }
    if (heading && summary) break;
  }
  return { title: heading || fallbackSlug, summary };
}

export function extractWikiLinks(markdown) {
  const links = [];
  const seen = new Set();
  let inFence = false;
  for (const rawLine of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let stripped = '';
    let inCode = false;
    for (const ch of rawLine) {
      if (ch === '`') {
        inCode = !inCode;
        continue;
      }
      if (!inCode) stripped += ch;
    }

    const wikiRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikiRegex.exec(stripped)) !== null) {
      const target = match[1].split('|')[0].split('#')[0].trim();
      if (target) {
        const key = target.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          links.push(target);
        }
      }
    }

    const mdLinkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
    while ((match = mdLinkRegex.exec(stripped)) !== null) {
      const href = match[1].trim();
      const lower = href.toLowerCase();
      if (
        href &&
        !lower.startsWith('http://') &&
        !lower.startsWith('https://') &&
        !lower.startsWith('mailto:') &&
        !lower.startsWith('#')
      ) {
        const cleanHref = href.split('#')[0].trim();
        if (cleanHref.toLowerCase().endsWith('.md')) {
          const key = cleanHref.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            links.push(cleanHref);
          }
        }
      }
    }
  }
  return links;
}

function collectMdFiles(currentDir, depth, maxDepth, out) {
  if (depth > maxDepth || !existsSync(currentDir)) return;
  for (const ent of readdirSync(currentDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = join(currentDir, ent.name);
    if (ent.isDirectory()) {
      collectMdFiles(full, depth + 1, maxDepth, out);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

function resolveTargetRelPath(rawTarget, fromRelPath, byRel, bySlug, byTitle) {
  const cleaned = String(rawTarget || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!cleaned) return null;

  let resolvedRel = cleaned;
  if (cleaned.startsWith('../')) {
    const baseParts = fromRelPath.split('/');
    baseParts.pop();
    const targetParts = [];
    for (const seg of cleaned.split('/')) {
      if (seg === '..') baseParts.pop();
      else if (seg && seg !== '.') targetParts.push(seg);
    }
    resolvedRel = [...baseParts, ...targetParts].join('/');
  }

  const lower = resolvedRel.toLowerCase();
  const lowerWithMd = lower.endsWith('.md') ? lower : `${lower}.md`;
  if (byRel.has(lowerWithMd)) return byRel.get(lowerWithMd);
  if (byRel.has(`pages/${lowerWithMd}`)) return byRel.get(`pages/${lowerWithMd}`);
  if (byRel.has(`raw/${lowerWithMd}`)) return byRel.get(`raw/${lowerWithMd}`);

  const slugKey = lower.replace(/\.md$/, '').split('/').pop() || '';
  if (bySlug.has(slugKey)) return bySlug.get(slugKey);
  if (byTitle.has(cleaned.toLowerCase())) return byTitle.get(cleaned.toLowerCase());
  return null;
}

function buildEntryFromFile(wikiRoot, absPath, kind) {
  const relPath = relative(wikiRoot, absPath).split(sep).join('/');
  const slug = basename(absPath, extname(absPath));
  const st = statSync(absPath);
  const rawContent = readFileSync(absPath, 'utf-8');
  const { scalars, lists, body } = parseWikiFrontmatter(rawContent);
  const inferred = inferTitleAndSummary(body, slug);

  const title = scalars.title || inferred.title;
  const summary = scalars.summary || inferred.summary;
  let category = scalars.category || '';
  if (!category && kind === 'page') {
    const parts = relPath.split('/');
    category = parts.length >= 3 ? parts[1] : '未分类';
  }
  const status =
    kind === 'raw'
      ? (scalars.status || 'pending').toLowerCase() === 'ingested'
        ? 'ingested'
        : 'pending'
      : '';

  const tags = lists.tags || [];
  const sources = lists.sources || [];
  const extracted = extractWikiLinks(body);
  for (const src of sources) {
    const s = src.trim();
    if (s && !extracted.some((x) => x.toLowerCase() === s.toLowerCase())) {
      extracted.push(s);
    }
  }

  return {
    dto: {
      rel_path: relPath,
      slug,
      kind,
      title,
      category,
      status,
      source: scalars.source || '',
      summary,
      tags,
      sources,
      created_at: scalars.created_at || '',
      updated_at: scalars.updated_at || '',
      ingested_at: scalars.ingested_at || '',
      outbound_links: [],
      broken_links: [],
      backlinks: [],
      size_bytes: st.size,
      modified_ts: Math.floor(st.mtimeMs / 1000),
    },
    extracted,
  };
}

export function scanBrainWikiOverview(pluginRoot) {
  const { wikiDir, defaultDir, isCustomDir } = resolveWikiDirForPlugin(pluginRoot);
  ensureBrainWikiScaffold(wikiDir);

  const items = [];
  for (const metaName of ['index.md', 'log.md', 'SCHEMA.md']) {
    const p = join(wikiDir, metaName);
    if (existsSync(p) && statSync(p).isFile()) {
      items.push(buildEntryFromFile(wikiDir, p, 'meta'));
    }
  }

  const pageFiles = [];
  collectMdFiles(join(wikiDir, 'pages'), 0, 3, pageFiles);
  for (const p of pageFiles) items.push(buildEntryFromFile(wikiDir, p, 'page'));

  const rawFiles = [];
  collectMdFiles(join(wikiDir, 'raw'), 0, 2, rawFiles);
  for (const p of rawFiles) items.push(buildEntryFromFile(wikiDir, p, 'raw'));

  const byRel = new Map();
  const bySlug = new Map();
  const byTitle = new Map();

  for (const { dto } of items) {
    byRel.set(dto.rel_path.toLowerCase(), dto.rel_path);
  }
  for (const { dto } of items.filter((x) => x.dto.kind === 'page')) {
    if (!bySlug.has(dto.slug.toLowerCase())) bySlug.set(dto.slug.toLowerCase(), dto.rel_path);
    if (!byTitle.has(dto.title.toLowerCase())) byTitle.set(dto.title.toLowerCase(), dto.rel_path);
  }
  for (const { dto } of items.filter((x) => x.dto.kind !== 'page')) {
    if (!bySlug.has(dto.slug.toLowerCase())) bySlug.set(dto.slug.toLowerCase(), dto.rel_path);
    if (!byTitle.has(dto.title.toLowerCase())) byTitle.set(dto.title.toLowerCase(), dto.rel_path);
  }

  const backlinksMap = new Map();
  let linksCount = 0;
  let brokenLinksCount = 0;

  for (const { dto, extracted } of items) {
    const resolvedSeen = new Set();
    for (const link of extracted) {
      const targetRel = resolveTargetRelPath(link, dto.rel_path, byRel, bySlug, byTitle);
      if (targetRel) {
        if (targetRel !== dto.rel_path && !resolvedSeen.has(targetRel)) {
          resolvedSeen.add(targetRel);
          dto.outbound_links.push(targetRel);
          if (dto.kind === 'page') linksCount += 1;
          if (dto.kind !== 'meta') {
            if (!backlinksMap.has(targetRel)) backlinksMap.set(targetRel, []);
            backlinksMap.get(targetRel).push({
              rel_path: dto.rel_path,
              title: dto.title,
              kind: dto.kind,
            });
          }
        }
      } else if (dto.kind === 'page') {
        dto.broken_links.push(link);
        brokenLinksCount += 1;
      }
    }
  }

  const metaFiles = [];
  const pages = [];
  const rawNotes = [];
  const categorySet = new Set();

  for (const { dto } of items) {
    const bls = backlinksMap.get(dto.rel_path) || [];
    bls.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
    dto.backlinks = bls;
    if (dto.kind === 'meta') metaFiles.push(dto);
    else if (dto.kind === 'page') {
      if (dto.category) categorySet.add(dto.category);
      pages.push(dto);
    } else if (dto.kind === 'raw') rawNotes.push(dto);
  }

  pages.sort((a, b) => b.modified_ts - a.modified_ts || a.rel_path.localeCompare(b.rel_path));
  rawNotes.sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    return pa - pb || b.modified_ts - a.modified_ts || a.rel_path.localeCompare(b.rel_path);
  });

  const orphanPagesCount = pages.filter((p) => {
    const hasPageOut = p.outbound_links.some((o) => o.startsWith('pages/'));
    const hasPageIn = p.backlinks.some((b) => b.kind === 'page');
    return !hasPageOut && !hasPageIn;
  }).length;
  const rawPending = rawNotes.filter((r) => r.status === 'pending').length;
  const categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

  return {
    wiki_dir: wikiDir,
    default_wiki_dir: defaultDir,
    is_custom_dir: isCustomDir,
    stats: {
      pages_count: pages.length,
      raw_total: rawNotes.length,
      raw_pending: rawPending,
      raw_ingested: rawNotes.length - rawPending,
      categories_count: categories.length,
      links_count: linksCount,
      broken_links_count: brokenLinksCount,
      orphan_pages_count: orphanPagesCount,
    },
    categories,
    meta_files: metaFiles,
    pages,
    raw_notes: rawNotes,
  };
}

function slugifyRawTitle(title) {
  let out = '';
  let lastDash = false;
  for (const ch of String(title || '').trim()) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toLowerCase();
      lastDash = false;
    } else if (/[\u4e00-\u9fff]/.test(ch)) {
      out += ch;
      lastDash = false;
    } else if (!lastDash && out.length > 0) {
      out += '-';
      lastDash = true;
    }
    if (Array.from(out).length >= 42) break;
  }
  const trimmed = out.replace(/^-+|-+$/g, '');
  return trimmed || 'note';
}

function escapeYamlStr(raw) {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

export function createBrainRawNote(pluginRoot, { title, source, tags, content }) {
  const { wikiDir } = resolveWikiDirForPlugin(pluginRoot);
  ensureBrainWikiScaffold(wikiDir);
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  if (!cleanTitle) throw new Error('素材标题不能为空');
  if (!cleanContent) throw new Error('素材正文不能为空');

  const { ymdCompact, formatted } = formatCnDateTime();
  const baseSlug = slugifyRawTitle(cleanTitle);
  let relPath = `raw/${ymdCompact}-${baseSlug}.md`;
  let seq = 2;
  while (existsSync(join(wikiDir, relPath))) {
    relPath = `raw/${ymdCompact}-${baseSlug}-${seq}.md`;
    seq += 1;
  }

  const cleanTags = Array.isArray(tags)
    ? tags.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  const tagsYaml = cleanTags.map((t) => `"${escapeYamlStr(t)}"`).join(', ');
  const doc = `---\ntitle: "${escapeYamlStr(cleanTitle)}"\nsource: "${escapeYamlStr(
    source || ''
  )}"\ntags: [${tagsYaml}]\nstatus: pending\ncreated_at: "${formatted}"\ningested_at: ""\n---\n\n${cleanContent}\n`;

  const { absPath } = resolveSafeWikiPath(wikiDir, relPath, false);
  writeFileAtomic(absPath, doc);
  return buildEntryFromFile(wikiDir, absPath, 'raw').dto;
}

export function readBrainWikiFile(pluginRoot, relPath) {
  const { wikiDir } = resolveWikiDirForPlugin(pluginRoot);
  ensureBrainWikiScaffold(wikiDir);
  const { absPath } = resolveSafeWikiPath(wikiDir, relPath, true);
  return readFileSync(absPath, 'utf-8');
}

export function saveBrainWikiFile(pluginRoot, relPath, content) {
  const { wikiDir } = resolveWikiDirForPlugin(pluginRoot);
  ensureBrainWikiScaffold(wikiDir);
  const { absPath } = resolveSafeWikiPath(wikiDir, relPath, false);
  writeFileAtomic(absPath, String(content ?? ''));
}

export function deleteBrainWikiFile(pluginRoot, relPath) {
  const { wikiDir } = resolveWikiDirForPlugin(pluginRoot);
  ensureBrainWikiScaffold(wikiDir);
  const { normalized, absPath } = resolveSafeWikiPath(wikiDir, relPath, true);
  if (!normalized.startsWith('raw/') && !normalized.startsWith('pages/')) {
    throw new Error('不允许删除知识库核心元数据文件（SCHEMA.md / index.md / log.md）');
  }
  unlinkSync(absPath);
}

export function setBrainWikiDir(pluginRoot, nextDir) {
  const cfgPath = join(pluginRoot, 'config.json');
  let obj = {};
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf-8');
    obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  }
  const trimmed = String(nextDir || '').trim();
  if (!trimmed) {
    delete obj.wiki_dir;
  } else {
    if (trimmed.includes('\0')) throw new Error('知识库路径包含非法字符');
    const expanded = expandTilde(trimmed);
    const resolved = isAbsolute(expanded) ? expanded : resolve(pluginRoot, expanded);
    ensureBrainWikiScaffold(resolved);
    obj.wiki_dir = trimmed;
  }
  writeFileAtomic(cfgPath, `${JSON.stringify(obj, null, 2)}\n`);
  return scanBrainWikiOverview(pluginRoot);
}

export function buildBrainLaunchPrompt(wikiDir, mode, relPath, topic) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'ingest') {
    const cleanRel = String(relPath || '').trim();
    if (cleanRel) {
      const stem = cleanRel.split('/').pop().replace(/\.md$/i, '');
      return {
        title: `A8 Brain 整理素材 (${stem})`,
        prompt: `/a8-brain 请按整理归档模式（Mode 2 Ingest）处理知识库 \`${wikiDir}\` 中的原始素材 \`${cleanRel}\`：先读 \`SCHEMA.md\` 与 \`index.md\`，提炼核心观点与方法论，写入或合并到 \`pages/\` 并建立 \`[[slug]]\` 双向链接，同步更新 \`index.md\`、\`log.md\`，最后将该 raw 素材标记为 \`status: ingested\`（保留原始正文不变）。`,
      };
    }
    return {
      title: 'A8 Brain 批量整理待归档素材',
      prompt: `/a8-brain 请按整理归档模式（Mode 2 Ingest）扫描知识库 \`${wikiDir}\` 下 \`raw/\` 目录中所有 \`status: pending\` 的待整理素材：先读 \`SCHEMA.md\` 与 \`index.md\`，逐篇消化提炼后写入或合并到 \`pages/\` 并建立 \`[[slug]]\` 双向链接，同步更新 \`index.md\`、\`log.md\` 并将已处理素材标记为 \`status: ingested\`。`,
    };
  }
  if (m === 'lint') {
    return {
      title: 'A8 Brain 知识库体检',
      prompt: `/a8-brain 请按知识库体检模式（Mode 3 Lint）对 \`${wikiDir}\` 执行一次全面健康巡检：检查断链 \`[[target]]\`、孤立页面、未登进 \`index.md\` 的漏网页面、概念重复或观点冲突以及待整理积压，先给出清晰体检报告再按确认修复。`,
    };
  }
  const cleanTopic = String(topic || '').trim();
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
