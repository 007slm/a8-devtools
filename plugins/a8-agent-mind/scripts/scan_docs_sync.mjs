#!/usr/bin/env node
/**
 * 夜间常青文档定时梳理前置增量扫描器 (scan_docs_sync.mjs)
 *
 * 职责：
 *   1. 动态读取 repos.md 中所有非靶场（role !== 'test-bed'）且含 docs/evergreen/ 的仓库；
 *   2. 结合插件数据目录下的水位文件 nightly_docs_sync_state.json 判断自上次梳理以来的增量提交与工作区变动；
 *   3. 静态体检文档断链、被取代旧记录缺失失效横幅、以及受限文档字节逼近/超限（>= 18,500 B / > 20,000 B）；
 *   4. 无新增变动且零体检异常的仓库返回 needs_review=false（直接秒跳过，节省定时任务 Token）；
 *   5. 全程无黑窗调用 git（windowsHide: true），零吞异常，只读扫描（仅 --mark-done 原子更新水位文件）。
 *
 * 用法：
 *   node scan_docs_sync.mjs [--force] [--repo a8-devtools,a8-turbo]
 *   node scan_docs_sync.mjs --mark-done <repoCode|all>
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REPOS_MAP_PATH = path.join(PLUGIN_ROOT, 'repos.md');

const SAFE_BYTES_CAP = 20000;
const WARN_BYTES_CAP = 18500;
const IGNORED_DOC_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|#|mailto:)/i;
const MD_LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

function getPluginDataDir() {
  const envDir = (process.env.PLUGIN_DATA || '').trim();
  if (envDir) return envDir;
  return path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'a8-agent-mind');
}

function getStateFilePath() {
  return path.join(getPluginDataDir(), 'nightly_docs_sync_state.json');
}

function loadSyncState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return { schema_version: 1, repos: {} };
  }
  const raw = fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`同步水位文件格式无效（非 JSON 对象）: ${stateFile}`);
  }
  return {
    schema_version: 1,
    repos: parsed.repos && typeof parsed.repos === 'object' ? parsed.repos : {},
  };
}

function saveSyncStateAtomic(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, `.nightly_docs_sync_state.${process.pid}.tmp`);
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpFile, stateFile);
}

function stripCellCode(cell) {
  return cell.trim().replace(/^`+|`+$/g, '').replace(/^\*\*|\*\*$/g, '').trim();
}

function parseRegisteredRepos() {
  if (!fs.existsSync(REPOS_MAP_PATH)) {
    throw new Error(`未找到宿主机仓库地图: ${REPOS_MAP_PATH}`);
  }
  const raw = fs.readFileSync(REPOS_MAP_PATH, 'utf8').replace(/^\uFEFF/, '');
  const repos = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const code = stripCellCode(cells[0]);
    const physPath = stripCellCode(cells[1]);
    const role = stripCellCode(cells[2]);
    if (!code || code === '仓库代号' || !path.isAbsolute(physPath)) continue;
    if (role.toLowerCase() === 'test-bed') continue;
    const evergreenDir = path.join(physPath, 'docs', 'evergreen');
    if (!fs.existsSync(physPath) || !fs.existsSync(evergreenDir) || !fs.statSync(evergreenDir).isDirectory()) {
      continue;
    }
    repos.push({ code, path: physPath, role });
  }
  return repos;
}

function runGit(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runGitChecked(repoRoot, args) {
  try {
    return { ok: true, stdout: runGit(repoRoot, args) };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      error: (err && err.stderr ? String(err.stderr) : err.message || String(err)).trim(),
    };
  }
}

function collectGitDirtyState(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    return {
      has_git: false,
      head_sha: '',
      dirty_hash: '',
      dirty_files: [],
      error: '未检测到 .git 目录',
    };
  }
  const headRes = runGitChecked(repoRoot, ['rev-parse', 'HEAD']);
  if (!headRes.ok) {
    return {
      has_git: true,
      head_sha: '',
      dirty_hash: '',
      dirty_files: [],
      error: `无法读取 HEAD: ${headRes.error}`,
    };
  }
  const headSha = headRes.stdout.trim();
  const statusRes = runGitChecked(repoRoot, ['status', '--porcelain=v1', '-z', '-uall']);
  if (!statusRes.ok) {
    return {
      has_git: true,
      head_sha: headSha,
      dirty_hash: '',
      dirty_files: [],
      error: `无法读取 git status: ${statusRes.error}`,
    };
  }

  const tokens = statusRes.stdout.split('\0').filter((t) => t.length > 0);
  const dirtyEntries = [];
  const dirtyFiles = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const relPath = entry.slice(3).replace(/\\/g, '/');
    dirtyEntries.push(`${xy}:${relPath}`);
    dirtyFiles.push(relPath);
    if ((xy.startsWith('R') || xy.startsWith('C')) && i + 1 < tokens.length) {
      const origPath = tokens[i + 1].replace(/\\/g, '/');
      dirtyEntries.push(`orig:${origPath}`);
      i += 1;
    }
  }
  const sortedCanonical = [...dirtyEntries].sort();
  const dirtyHash = crypto.createHash('sha256').update(sortedCanonical.join('\n')).digest('hex').slice(0, 16);
  return {
    has_git: true,
    head_sha: headSha,
    dirty_hash: dirtyHash,
    dirty_files: [...new Set(dirtyFiles)].sort(),
    error: '',
  };
}

function collectCommitsDelta(repoRoot, prevSha, headSha) {
  if (!headSha) return { committed_files: [], recent_commits: [], diff_fallback: false };
  if (prevSha && prevSha === headSha) {
    return { committed_files: [], recent_commits: [], diff_fallback: false };
  }
  if (prevSha) {
    const diffRes = runGitChecked(repoRoot, ['diff', '--name-only', `${prevSha}..${headSha}`]);
    const logRes = runGitChecked(repoRoot, ['log', '--oneline', `${prevSha}..${headSha}`, '-n', '30']);
    if (diffRes.ok && logRes.ok) {
      return {
        committed_files: diffRes.stdout
          .split(/\r?\n/)
          .map((s) => s.trim().replace(/\\/g, '/'))
          .filter(Boolean),
        recent_commits: logRes.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        diff_fallback: false,
      };
    }
  }
  const fallbackRes = runGitChecked(repoRoot, ['log', '-n', '10', '--oneline']);
  return {
    committed_files: [],
    recent_commits: fallbackRes.ok
      ? fallbackRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [],
    diff_fallback: true,
  };
}

function readRecordHeaderMeta(fullPath) {
  const raw = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const sepIdx = lines.findIndex((ln) => ln.trim() === '---');
  const headLines = lines.slice(0, sepIdx === -1 ? 15 : sepIdx);
  let status = '';
  let supersedes = '';
  for (const ln of headLines) {
    const t = ln.trim();
    if (t.startsWith('- **状态**：')) {
      status = t.slice('- **状态**：'.length).trim();
    } else if (t.startsWith('- **取代**：')) {
      supersedes = t.slice('- **取代**：'.length).trim();
    }
  }
  const hasInvalidBanner = headLines.some((ln) => {
    const t = ln.trim();
    return t.includes('**[已失效') || t.includes('**[部分失效');
  });
  return { status, supersedes, hasInvalidBanner };
}

function findRootAgentsFile(repoRoot) {
  for (const name of ['AGENTS.md', 'agents.md']) {
    const full = path.join(repoRoot, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

function scanDocHealth(repoRoot) {
  const evergreenDir = path.join(repoRoot, 'docs', 'evergreen');
  const recordsDir = path.join(repoRoot, 'docs', 'records');
  const inFlightRecords = [];
  const brokenLinks = [];
  const unmarkedSuperseded = [];
  const sizeWarnings = [];

  const auditMarkdownFiles = [];
  const agentsPath = findRootAgentsFile(repoRoot);
  if (agentsPath) auditMarkdownFiles.push(agentsPath);
  for (const rootDoc of ['glossary.md', 'verify.md']) {
    const p = path.join(repoRoot, 'docs', rootDoc);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) auditMarkdownFiles.push(p);
  }
  if (fs.existsSync(evergreenDir)) {
    for (const ent of fs.readdirSync(evergreenDir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        auditMarkdownFiles.push(path.join(evergreenDir, ent.name));
      }
    }
  }

  for (const full of auditMarkdownFiles) {
    const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
    const size = fs.statSync(full).size;
    if (size > SAFE_BYTES_CAP) {
      sizeWarnings.push({ rel_path: rel, size_bytes: size, level: 'over_cap' });
    } else if (size >= WARN_BYTES_CAP) {
      sizeWarnings.push({ rel_path: rel, size_bytes: size, level: 'approaching_cap' });
    }

    const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);
    let inFence = false;
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const lineWithoutInlineCode = line.replace(/`[^`]*`/g, '');
      MD_LINK_RE.lastIndex = 0;
      let match;
      while ((match = MD_LINK_RE.exec(lineWithoutInlineCode)) !== null) {
        const rawTarget = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
        if (!rawTarget || IGNORED_DOC_LINK_RE.test(rawTarget)) continue;
        const cleanRel = rawTarget.split('#')[0].split('?')[0];
        if (!cleanRel) continue;
        let decodedTarget = cleanRel;
        try {
          decodedTarget = decodeURIComponent(cleanRel);
        } catch (err) {
          brokenLinks.push({ source: rel, line: idx + 1, target: rawTarget, reason: `链接编码无效: ${err.message}` });
          continue;
        }
        const resolved = path.resolve(path.dirname(full), decodedTarget);
        if (!fs.existsSync(resolved)) {
          brokenLinks.push({ source: rel, line: idx + 1, target: rawTarget, reason: '目标文件不存在' });
        }
      }
    });
  }

  const recordMetas = new Map();
  if (fs.existsSync(recordsDir) && fs.statSync(recordsDir).isDirectory()) {
    for (const ent of fs.readdirSync(recordsDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
      const full = path.join(recordsDir, ent.name);
      const meta = readRecordHeaderMeta(full);
      recordMetas.set(ent.name, meta);
      if (meta.status.startsWith('进行中')) {
        inFlightRecords.push(`docs/records/${ent.name}`);
      }
    }
    for (const [fileName, meta] of recordMetas.entries()) {
      if (!meta.supersedes || meta.supersedes === '无' || meta.supersedes === '-') continue;
      if (meta.status.startsWith('进行中') || meta.status.startsWith('已暂缓') || meta.status.startsWith('已废弃')) {
        continue;
      }
      const fileDate = /^\d{8}/.test(fileName) ? fileName.slice(0, 8) : '';
      const refMatches = meta.supersedes.match(/\d{8}-[^\s,，、）)`]+\.md/g) || [];
      for (const oldName of refMatches) {
        const oldDate = oldName.slice(0, 8);
        // 历史惯例曾把“取代我的新记录”误填在旧记录的 `- **取代**：` 栏；旧日期不能取代新日期，且状态中已写“被 <oldName> ...”说明方向相反
        if ((fileDate && oldDate > fileDate) || meta.status.includes(oldName)) {
          continue;
        }
        const oldMeta = recordMetas.get(oldName);
        if (!oldMeta) continue;
        const isMarked =
          (oldMeta.status.startsWith('已废弃') || oldMeta.status.startsWith('部分失效')) &&
          oldMeta.hasInvalidBanner;
        if (!isMarked) {
          unmarkedSuperseded.push({
            newer_record: `docs/records/${fileName}`,
            old_record: `docs/records/${oldName}`,
            old_status: oldMeta.status || '(缺失)',
            has_invalid_banner: oldMeta.hasInvalidBanner,
          });
        }
      }
    }
  }

  return {
    in_flight_records: inFlightRecords.sort(),
    broken_links: brokenLinks,
    unmarked_superseded_records: unmarkedSuperseded,
    size_warnings: sizeWarnings,
  };
}

function classifyChangedPaths(allChanged, inFlightSet) {
  const codeFiles = [];
  const settledRecords = [];
  const changedEvergreenOrMaps = [];
  for (const rel of allChanged) {
    const lower = rel.toLowerCase();
    if (lower === 'agents.md' || lower === 'docs/glossary.md' || lower === 'docs/verify.md' || lower.startsWith('docs/evergreen/')) {
      changedEvergreenOrMaps.push(rel);
    } else if (lower.startsWith('docs/records/')) {
      if (!inFlightSet.has(rel)) {
        settledRecords.push(rel);
      }
    } else if (!lower.startsWith('docs/')) {
      codeFiles.push(rel);
    }
  }
  return {
    changed_code_files: codeFiles,
    settled_changed_records: settledRecords,
    changed_evergreen_or_maps: changedEvergreenOrMaps,
  };
}

function inspectRepo(repo, state, forceFlag) {
  const prev = state.repos[repo.code] || null;
  const gitState = collectGitDirtyState(repo.path);
  const health = scanDocHealth(repo.path);
  const prevSha = prev ? String(prev.last_head_sha || '') : '';
  const prevDirtyHash = prev ? String(prev.last_dirty_hash || '') : '';
  const headChanged = !prev || prevSha !== gitState.head_sha;
  const dirtyChanged = !prev || prevDirtyHash !== gitState.dirty_hash;
  const delta = collectCommitsDelta(repo.path, prevSha, gitState.head_sha);

  const allChanged = [...new Set([...delta.committed_files, ...gitState.dirty_files])].sort();
  const inFlightSet = new Set(health.in_flight_records);
  const classified = classifyChangedPaths(allChanged, inFlightSet);

  const reasons = [];
  if (forceFlag) reasons.push('强制全量复核 (--force)');
  if (!prev) reasons.push('首次建立同步水位');
  else {
    if (headChanged) reasons.push(`HEAD 提交变化 (${prevSha.slice(0, 7) || '无'} -> ${gitState.head_sha.slice(0, 7)})`);
    if (dirtyChanged) reasons.push('工作区未提交变动变化');
  }
  if (gitState.error) reasons.push(`Git 状态异常: ${gitState.error}`);
  if (health.broken_links.length > 0) reasons.push(`发现 ${health.broken_links.length} 处文档断链`);
  if (health.unmarked_superseded_records.length > 0) {
    reasons.push(`发现 ${health.unmarked_superseded_records.length} 份被取代旧记录缺失效标废`);
  }
  const overCapCount = health.size_warnings.filter((w) => w.level === 'over_cap').length;
  if (overCapCount > 0) reasons.push(`发现 ${overCapCount} 份文档超过 20,000 B 红线`);

  const needsReview =
    forceFlag ||
    !prev ||
    headChanged ||
    dirtyChanged ||
    Boolean(gitState.error) ||
    health.broken_links.length > 0 ||
    health.unmarked_superseded_records.length > 0 ||
    overCapCount > 0;

  return {
    code: repo.code,
    path: repo.path,
    has_git: gitState.has_git,
    git_error: gitState.error || null,
    head_sha: gitState.head_sha,
    previous_head_sha: prevSha || null,
    dirty_hash: gitState.dirty_hash,
    previous_dirty_hash: prevDirtyHash || null,
    head_changed: headChanged,
    dirty_changed: dirtyChanged,
    last_synced_at: prev ? prev.last_synced_at || null : null,
    recent_commits: delta.recent_commits,
    changed_code_files: classified.changed_code_files,
    settled_changed_records: classified.settled_changed_records,
    in_flight_records: health.in_flight_records,
    changed_evergreen_or_maps: classified.changed_evergreen_or_maps,
    broken_links: health.broken_links,
    unmarked_superseded_records: health.unmarked_superseded_records,
    size_warnings: health.size_warnings,
    needs_review: needsReview,
    reasons,
  };
}

function parseCliArgs(argv) {
  const opts = { force: false, reposFilter: null, markDone: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') opts.force = true;
    else if (arg === '--repo' && i + 1 < argv.length) {
      opts.reposFilter = new Set(argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (arg === '--mark-done' && i + 1 < argv.length) {
      opts.markDone = argv[i + 1].trim();
      i += 1;
    }
  }
  return opts;
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const stateFile = getStateFilePath();
  const state = loadSyncState(stateFile);
  let repos = parseRegisteredRepos();
  if (opts.reposFilter) {
    repos = repos.filter((r) => opts.reposFilter.has(r.code));
  }

  if (opts.markDone) {
    const targets =
      opts.markDone === 'all'
        ? repos
        : repos.filter((r) => opts.markDone.split(',').map((s) => s.trim()).includes(r.code));
    if (targets.length === 0) {
      throw new Error(`--mark-done 未匹配任何已登记常青仓库: ${opts.markDone}`);
    }
    const updated = [];
    const nowIso = new Date().toISOString();
    for (const repo of targets) {
      const gitState = collectGitDirtyState(repo.path);
      if (gitState.error) {
        throw new Error(`--mark-done 失败（${repo.code}）: ${gitState.error}`);
      }
      state.repos[repo.code] = {
        last_head_sha: gitState.head_sha,
        last_dirty_hash: gitState.dirty_hash,
        last_synced_at: nowIso,
      };
      updated.push({ code: repo.code, ...state.repos[repo.code] });
    }
    saveSyncStateAtomic(stateFile, state);
    console.log(JSON.stringify({ ok: true, state_file: stateFile, updated }, null, 2));
    return;
  }

  const results = repos.map((r) => inspectRepo(r, state, opts.force));
  const payload = {
    generated_at: new Date().toISOString(),
    state_file: stateFile,
    repos: results,
    any_needs_review: results.some((r) => r.needs_review),
  };
  console.log(JSON.stringify(payload, null, 2));
}

main();
