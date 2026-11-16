import { createServer } from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '..', '..');
const port = parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || '18766', 10);
const requireFromHere = createRequire(import.meta.url);

const PROTECTED_FILES = new Set([
  'plugin.json',
  'config.json',
  'repos.md',
  'rules/mind-rules.md',
  'repos/relations.md',
  'decisions/lifecycle_and_evolution.decision.json',
  'decisions/topology_and_boundaries.decision.json',
  'decisions/concurrency_and_performance.decision.json',
  'decisions/implementation_hygiene.decision.json',
]);

const ALLOWED_EXTENSIONS = new Set(['md', 'json', 'html', 'py', 'mjs', 'ts', 'tsx', 'txt']);

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const LOCAL_CUSTOM_SCHEMES = new Set([
  'tauri:',
  'plugin:',
  'vscode-webview:',
  'antigravity:',
  'antigravity-sidecar:',
  'file:',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const trimmed = origin.trim();
  if (trimmed.toLowerCase() === 'null') {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    if (LOCAL_CUSTOM_SCHEMES.has(parsed.protocol)) {
      return true;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return ['127.0.0.1', 'localhost', 'tauri.localhost', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, payload, headers) {
  res.writeHead(statusCode, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 8 * 1024 * 1024) {
        rejectBody(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolveBody(text ? JSON.parse(text) : {});
      } catch {
        rejectBody(new Error('无效的 JSON 请求体'));
      }
    });
    req.on('error', rejectBody);
  });
}

function stripMdCell(raw) {
  return String(raw || '').trim().replace(/^[*`]+|[*`]+$/g, '').trim();
}

function extractMdLinkPath(raw) {
  const s = String(raw || '').trim();
  const l = s.indexOf('(');
  const r = s.lastIndexOf(')');
  if (l >= 0 && r > l + 1) {
    return s.slice(l + 1, r).trim().replace(/\\/g, '/');
  }
  return stripMdCell(s);
}

function parseReposMd() {
  try {
    const content = readFileSync(join(pluginRoot, 'repos.md'), 'utf-8');
    const repos = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || trimmed.includes('---')) continue;
      const cols = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cols.length < 5) continue;
      const code = stripMdCell(cols[0]);
      if (!code || code.includes('仓库代号') || code.includes('项目代号')) continue;
      const physicalPath = stripMdCell(cols[1]);
      const role = stripMdCell(cols[2]);
      const summary = cols[3];
      const detailRelPath = extractMdLinkPath(cols[4]);
      const detailExists = Boolean(detailRelPath && existsSync(join(pluginRoot, detailRelPath)));
      repos.push({
        code,
        physicalPath,
        physical_path: physicalPath,
        role,
        summary,
        detail_rel_path: detailRelPath,
        detail_exists: detailExists,
      });
    }
    return repos;
  } catch {
    return [];
  }
}

function parseFrontmatter(raw) {
  const clean = String(raw || '').replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { fm: {}, body: clean };
  }
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (k) fm[k] = v;
  }
  return { fm, body: match[2] };
}

function inferVerdictFromBody(body) {
  if (/【\s*不通过|不通过\s*\((HOLD|VIOLATED)\)|\bVIOLATED\b/.test(body)) return 'VIOLATED';
  if (/需人工拍板|\bREQUIRES_APPROVAL\b/.test(body)) return 'REQUIRES_APPROVAL';
  if (/终审通过|准予\s*Commit|\bPASSED\b/.test(body)) return 'PASSED';
  return 'REQUIRES_APPROVAL';
}

function extractBodyTitleAndSummary(body, fallbackId) {
  let title = '';
  let summary = '';
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!title && line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (!summary && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('```')) {
      const plain = line.replace(/^[-*>\s]+/, '').trim();
      if (plain) summary = plain.slice(0, 180);
    }
    if (title && summary) break;
  }
  return {
    title: title || fallbackId,
    summary: summary || 'DSH 架构审查归档报告',
  };
}

function collectReviewMdFiles(dirPath, out) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectReviewMdFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(fullPath);
    }
  }
}

function parseReviewsDir() {
  const reviewsDir = join(pluginRoot, 'reviews');
  if (!existsSync(reviewsDir)) return [];
  const mdFiles = [];
  collectReviewMdFiles(reviewsDir, mdFiles);

  const records = [];
  for (const fullPath of mdFiles) {
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      const st = statSync(fullPath);
      const relPath = fullPath.slice(pluginRoot.length + 1).replace(/\\/g, '/');
      const relFromReviews = fullPath.slice(reviewsDir.length + 1).replace(/\\/g, '/');
      const slashIdx = relFromReviews.indexOf('/');
      const inferredRepo = slashIdx > 0 ? relFromReviews.slice(0, slashIdx) : '';
      const fileName = relFromReviews.split('/').pop() || 'review.md';
      const stem = fileName.replace(/\.md$/i, '');
      const { fm, body } = parseFrontmatter(raw);
      const fb = extractBodyTitleAndSummary(body, stem);
      records.push({
        id: fm.id || stem,
        rel_path: relPath,
        timestamp: fm.timestamp || '',
        modified_ts: Math.floor(st.mtimeMs / 1000),
        repo: fm.repo || inferredRepo || 'unknown',
        workspace: fm.workspace || '',
        round: parseInt(fm.round || '1', 10) || 1,
        verdict: (fm.verdict || inferVerdictFromBody(body)).toUpperCase(),
        title: fm.title || fb.title,
        session_id: fm.session_id || '',
        duration_sec: parseFloat(fm.duration_sec || '0') || 0,
        summary: fm.summary || fb.summary,
        size_bytes: st.size,
      });
    } catch {
      // skip unreadable entry
    }
  }
  records.sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp.localeCompare(a.timestamp);
    if (b.modified_ts !== a.modified_ts) return b.modified_ts - a.modified_ts;
    return b.id.localeCompare(a.id);
  });
  return records;
}

function isDevtoolsRepoRoot(dir) {
  return Boolean(dir && existsSync(join(dir, 'Cargo.toml')) && existsSync(join(dir, 'modules', 'devtools')));
}

function resolveDevtoolsRepoRoot() {
  const candidates = [resolve(pluginRoot, '..', '..')];
  for (const repo of parseReposMd()) {
    if (repo.code.toLowerCase() === 'a8-devtools' && repo.physicalPath) {
      candidates.push(repo.physicalPath);
    }
  }
  candidates.push('E:\\a8-devtools');
  for (const candidate of candidates) {
    if (isDevtoolsRepoRoot(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveUiDistDir() {
  const repoRoot = resolveDevtoolsRepoRoot();
  if (repoRoot) {
    const uiDir = join(repoRoot, 'modules', 'devtools', 'ui');
    if (existsSync(join(uiDir, 'index.html'))) {
      return uiDir;
    }
  }
  return null;
}

function grokProposalsDir() {
  const repoRoot = resolveDevtoolsRepoRoot();
  return repoRoot ? join(repoRoot, 'logs', 'grok-proposals') : null;
}

function countProposalHeadings(body) {
  let explicit = 0;
  let h3 = 0;
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('## 提案') || line.startsWith('### 提案')) {
      explicit += 1;
    } else if (line.startsWith('### ')) {
      h3 += 1;
    }
  }
  return explicit > 0 ? explicit : h3;
}

function parseGrokProposalsDir(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return [];
  const records = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }
    const fullPath = join(dirPath, entry.name);
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      const st = statSync(fullPath);
      const stem = entry.name.replace(/\.md$/i, '');
      const { fm, body } = parseFrontmatter(raw);
      const fb = extractBodyTitleAndSummary(body, stem);
      const dateFromStem = /^\d{4}-\d{2}-\d{2}/.test(stem) ? stem.slice(0, 10) : '';
      const fallbackSummary =
        fb.summary === 'DSH 架构审查归档报告' ? 'Grok AI 工作流提升提案' : fb.summary;
      const parsedCount = parseInt(fm.proposal_count || '', 10);
      records.push({
        id: stem,
        file_name: entry.name,
        abs_path: fullPath,
        date: fm.date || dateFromStem,
        modified_ts: Math.floor(st.mtimeMs / 1000),
        title: fm.title || fb.title,
        source_subject: fm.source_subject || '',
        source_date: fm.source_date || '',
        status: (fm.status || 'pending').toLowerCase(),
        proposal_count: Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : countProposalHeadings(body),
        summary: fm.summary || fallbackSummary,
        size_bytes: st.size,
      });
    } catch {
      // skip unreadable proposal
    }
  }
  records.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    if (b.modified_ts !== a.modified_ts) return b.modified_ts - a.modified_ts;
    return b.file_name.localeCompare(a.file_name);
  });
  return records;
}

function locateHarnessMetricsPath() {
  const pd = String(process.env.PLUGIN_DATA || '').trim();
  if (pd) return join(pd, 'harness_metrics.jsonl');
  return join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'a8-agent-mind', 'harness_metrics.jsonl');
}

function toCnYmd(unixSecs) {
  const d = new Date((unixSecs + 8 * 3600) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function normStrArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x || '').trim()).filter(Boolean);
}

function bumpCheckerStat(map, key, ts, isHit) {
  const cur = map.get(key) || { eval_count: 0, hit_count: 0, last_eval_ts: 0, last_hit_ts: 0 };
  if (isHit) {
    cur.hit_count += 1;
    if (ts > cur.last_hit_ts) cur.last_hit_ts = ts;
  } else {
    cur.eval_count += 1;
    if (ts > cur.last_eval_ts) cur.last_eval_ts = ts;
  }
  map.set(key, cur);
}

function parseHarnessTelemetryWithStats(threshold = 0.85) {
  const metricsPath = locateHarnessMetricsPath();
  const events = [];
  if (existsSync(metricsPath) && statSync(metricsPath).isFile()) {
    try {
      const lines = readFileSync(metricsPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const v = JSON.parse(t);
          const ts = Number(v?.ts || 0);
          const date = String(v?.date || '').trim() || (ts > 0 ? toCnYmd(ts) : '');
          events.push({
            ts,
            date,
            source: String(v?.source || ''),
            mode: String(v?.mode || ''),
            repo: String(v?.repo || ''),
            verdict: String(v?.verdict || ''),
            confidence: Number(v?.confidence || 0),
            docs_choice: String(v?.docs_choice || ''),
            lesson_choice: String(v?.lesson_choice || ''),
            evaluated_ids: normStrArray(v?.evaluated_ids),
            violated_ids: normStrArray(v?.violated_ids),
          });
        } catch {
          // skip malformed jsonl row
        }
      }
    } catch {
      // ignore read failure
    }
  }

  const dayBuckets = new Map();
  const stats = {
    decisionGlobal: new Map(),
    decisionByRepo: new Map(),
    lintGlobal: new Map(),
    lintByRepo: new Map(),
  };
  let stop_hook_events = 0;
  let judge_events = 0;
  let docs_gate_triggered = 0;
  let auto_lint_triggered = 0;
  let confSum = 0;
  let confCnt = 0;

  for (const ev of events) {
    if (ev.source === 'stop_hook') stop_hook_events += 1;
    else if (ev.source === 'a8_judge') judge_events += 1;
    if (ev.mode.includes('DOCS_MAINTENANCE')) docs_gate_triggered += 1;
    if (ev.mode.includes('AUTO_LINT') || ev.mode.includes('AUTO_DECISION')) auto_lint_triggered += 1;
    if (ev.confidence > 0) {
      confSum += ev.confidence;
      confCnt += 1;
    }

    const repoLower = ev.repo.toLowerCase();
    if (ev.source === 'a8_judge') {
      for (const id of ev.evaluated_ids) {
        bumpCheckerStat(stats.decisionGlobal, id, ev.ts, false);
        if (repoLower) bumpCheckerStat(stats.decisionByRepo, `${repoLower}::${id}`, ev.ts, false);
      }
      for (const id of ev.violated_ids) {
        bumpCheckerStat(stats.decisionGlobal, id, ev.ts, true);
        if (repoLower) bumpCheckerStat(stats.decisionByRepo, `${repoLower}::${id}`, ev.ts, true);
      }
    } else if (ev.source === 'repo_lint') {
      for (const id of ev.evaluated_ids) {
        const up = id.toUpperCase();
        bumpCheckerStat(stats.lintGlobal, up, ev.ts, false);
        if (repoLower) bumpCheckerStat(stats.lintByRepo, `${repoLower}::${up}`, ev.ts, false);
      }
      for (const id of ev.violated_ids) {
        const up = id.toUpperCase();
        bumpCheckerStat(stats.lintGlobal, up, ev.ts, true);
        if (repoLower) bumpCheckerStat(stats.lintByRepo, `${repoLower}::${up}`, ev.ts, true);
      }
    }

    if (ev.date) {
      const cur = dayBuckets.get(ev.date) || [0, 0, 0];
      const isErrOrViolated =
        ev.verdict === 'VIOLATED' ||
        ev.verdict === 'REQUIRES_APPROVAL' ||
        ev.verdict === 'ERROR' ||
        ev.mode.includes('API_ERROR') ||
        ev.mode.includes('SCHEMA_ERROR');
      if (isErrOrViolated) cur[2] += 1;
      else if (ev.source === 'stop_hook' && ev.verdict === 'continue') cur[1] += 1;
      else cur[0] += 1;
      dayBuckets.set(ev.date, cur);
    }
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  const daily_trends = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const ymd = toCnYmd(nowSecs - offset * 86400);
    const [allow_or_pass, hook_woke, violated_or_error] = dayBuckets.get(ymd) || [0, 0, 0];
    daily_trends.push({ date: ymd, allow_or_pass, hook_woke, violated_or_error });
  }

  events.sort((a, b) => b.ts - a.ts);
  const recent_events = events.slice(0, 60);

  return {
    telemetry: {
      metrics_path: metricsPath,
      total_events: recent_events.length,
      stop_hook_events,
      judge_events,
      docs_gate_triggered,
      auto_lint_triggered,
      avg_confidence: confCnt > 0 ? Math.round((confSum / confCnt) * 10000) / 10000 : 0,
      threshold,
      daily_trends,
      recent_events,
    },
    stats,
  };
}

function updateProposalStatusFile(targetPath, nextStatus) {
  const raw = readFileSync(targetPath, 'utf-8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const clean = raw.replace(/^\uFEFF/, '');
  let updated;
  if (clean.startsWith('---\n') || clean.startsWith('---\r\n')) {
    const marker = clean.startsWith('---\r\n') ? '---\r\n' : '---\n';
    const rest = clean.slice(marker.length);
    const endIdx = rest.indexOf(`${eol}---`);
    if (endIdx >= 0) {
      const fmBlock = rest.slice(0, endIdx);
      const tail = rest.slice(endIdx + eol.length);
      let found = false;
      const newLines = fmBlock.split(/\r?\n/).map((ln) => {
        if (ln.trimStart().startsWith('status:')) {
          found = true;
          return `status: ${nextStatus}`;
        }
        return ln;
      });
      if (!found) newLines.push(`status: ${nextStatus}`);
      updated = `${marker}${newLines.join(eol)}${eol}${tail}`;
    } else {
      updated = `---${eol}status: ${nextStatus}${eol}---${eol}${clean}`;
    }
  } else {
    updated = `---${eol}status: ${nextStatus}${eol}---${eol}${eol}${clean}`;
  }
  writeFileSync(targetPath, updated, 'utf-8');
}

function resolveSafeProposalFile(dirPath, fileName) {
  if (!dirPath) {
    throw new Error('未定位到 a8-devtools 仓库根目录，无法访问 logs/grok-proposals');
  }
  const trimmed = String(fileName || '').trim();
  if (
    !trimmed ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes(':') ||
    trimmed.includes('..') ||
    trimmed.includes('~') ||
    trimmed.includes('\0') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith(' ')
  ) {
    throw new Error('安全拦截：非法的提案文件名');
  }
  if (!trimmed.toLowerCase().endsWith('.md')) {
    throw new Error('仅支持访问 .md 提案文件');
  }
  const target = join(dirPath, trimmed);
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`提案文件不存在: ${trimmed}`);
  }
  const canonDir = realpathSync(dirPath);
  const canonTarget = realpathSync(target);
  if (!canonTarget.toLowerCase().startsWith((canonDir + sep).toLowerCase())) {
    throw new Error('安全拦截：提案路径越界');
  }
  return canonTarget;
}

function discoverAntigravityLsEnv() {
  const daemonDir = join(homedir(), '.gemini', 'antigravity', 'daemon');
  if (!existsSync(daemonDir)) return null;
  let files = [];
  try {
    files = readdirSync(daemonDir)
      .filter((name) => /^hub_.*\.json$/i.test(name))
      .map((name) => {
        const full = join(daemonDir, name);
        return { full, mtimeMs: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return null;
  }
  for (const item of files) {
    try {
      const info = JSON.parse(readFileSync(item.full, 'utf-8'));
      const pid = Number(info?.pid || 0);
      const httpPort = Number(info?.httpPort || 0);
      const csrfToken = String(info?.csrfToken || '').trim();
      if (!pid || !httpPort || !csrfToken) continue;
      process.kill(pid, 0);
      return {
        lsAddress: `http://127.0.0.1:${httpPort}`,
        csrfToken,
      };
    } catch {
      // Skip stale daemon entries whose PID is no longer alive
    }
  }
  return null;
}

function invokeAgentApi(args, { projectId } = {}) {
  const env = { ...process.env };
  if (projectId) env.ANTIGRAVITY_PROJECT_ID = projectId;
  if (!env.ANTIGRAVITY_LS_ADDRESS) {
    const discovered = discoverAntigravityLsEnv();
    if (discovered) {
      env.ANTIGRAVITY_LS_ADDRESS = discovered.lsAddress;
      if (!env.ANTIGRAVITY_CSRF_TOKEN && discovered.csrfToken) {
        env.ANTIGRAVITY_CSRF_TOKEN = discovered.csrfToken;
      }
    }
  }
  if (!env.ANTIGRAVITY_LS_ADDRESS) {
    throw new Error('未检测到运行中的 Antigravity Hub 服务（~/.gemini/antigravity/daemon/hub_*.json），请先启动 Antigravity 桌面端后重试');
  }
  const fallbackWinExe = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'resources', 'bin', 'language_server.exe')
    : '';
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE || (existsSync(fallbackWinExe) ? fallbackWinExe : '');
  const file = exe || 'agentapi';
  const execArgs = exe ? ['agentapi', ...args] : args;
  const out = execFileSync(file, execArgs, {
    encoding: 'utf-8',
    env,
    windowsHide: true,
  });
  return out.trim() ? JSON.parse(out) : {};
}

function extractConversationId(parsed) {
  return (
    parsed?.conversationId ||
    parsed?.conversation_id ||
    parsed?.response?.conversationId ||
    parsed?.response?.conversation_id ||
    parsed?.id ||
    ''
  );
}

function resolvePreloadJs(uiDistDir) {
  const candidates = [];
  try {
    const sdkEntry = requireFromHere.resolve('sidecar_sdk');
    const sdkDir = dirname(sdkEntry);
    candidates.push(join(sdkDir, 'preload.js'), join(sdkDir, '..', 'preload.js'));
  } catch {
    // sidecar_sdk is injected via NODE_PATH when launched inside Antigravity
  }
  candidates.push(
    join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'preload.js'),
  );
  if (uiDistDir) {
    candidates.push(join(uiDistDir, 'preload.js'));
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return readFileSync(candidate, 'utf-8');
      }
    } catch {
      // try next candidate
    }
  }
  return '(function(){if(typeof window!=="undefined"&&!window.sidecar){window.__a8PreloadFallback=true;}})();\n';
}

function readJsonOrEmpty(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function maskConfigSecrets(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const copy = { ...obj };
  if (typeof copy.api_key === 'string') {
    const t = copy.api_key.trim();
    if (t && !(t.startsWith('${') && t.endsWith('}'))) {
      copy.api_key = '***MASKED***';
    }
  }
  return copy;
}

function collectFilesRecursive(dirPath, category, out) {
  if (!existsSync(dirPath)) return;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(full, category, out);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).replace(/^\./, '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;
      const st = statSync(full);
      const rel = full.slice(pluginRoot.length + 1).replace(/\\/g, '/');
      out.push({
        rel_path: rel,
        name: entry.name,
        category,
        extension: ext,
        size_bytes: st.size,
        modified_ts: Math.floor(st.mtimeMs / 1000),
      });
    }
  }
}

function resolveSafePathInRoot(rootDir, relPath) {
  const normalized = String(relPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes(':') || normalized.includes('\0')) {
    throw new Error('非法文件路径');
  }
  const parts = normalized.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..') {
      throw new Error('禁止使用相对父级目录或空片段');
    }
    const lower = p.toLowerCase();
    if (lower === '.git' || lower === 'node_modules' || lower === 'dist') {
      throw new Error('禁止访问内部保留目录');
    }
    if (p.includes('~') || p.endsWith('.') || p.endsWith(' ')) {
      throw new Error('安全拦截：禁止使用短文件名别名或尾随点空格路径');
    }
  }

  const canonRoot = realpathSync(rootDir);
  const joined = resolve(canonRoot, ...parts);
  if (existsSync(joined)) {
    const canonTarget = realpathSync(joined);
    if (!canonTarget.toLowerCase().startsWith((canonRoot + sep).toLowerCase())) {
      throw new Error('安全拦截：目标路径越界目录范围');
    }
    const canonRel = canonTarget.slice(canonRoot.length + 1).replace(/\\/g, '/');
    return { cleanRel: canonRel, target: canonTarget };
  }

  // 未创建路径：追溯最近已存在祖先目录校验边界
  let probe = joined;
  const tail = [];
  while (!existsSync(probe)) {
    tail.unshift(probe.split(sep).pop());
    const parent = dirname(probe);
    if (parent === probe) throw new Error('无效父目录路径');
    probe = parent;
  }
  const canonAncestor = realpathSync(probe);
  const rootPrefix = (canonRoot + sep).toLowerCase();
  if (
    canonAncestor.toLowerCase() !== canonRoot.toLowerCase() &&
    !canonAncestor.toLowerCase().startsWith(rootPrefix)
  ) {
    throw new Error('安全拦截：创建路径越界目录范围');
  }
  const baseRel =
    canonAncestor.length > canonRoot.length
      ? canonAncestor.slice(canonRoot.length + 1).replace(/\\/g, '/')
      : '';
  const cleanRel = baseRel ? `${baseRel}/${tail.join('/')}` : tail.join('/');
  return { cleanRel, target: joined };
}

function resolveTargetScope(repoCode, writable) {
  const raw = String(repoCode || '').trim();
  if (!raw || raw.toLowerCase() === 'a8-agent-mind' || raw.toLowerCase() === 'global') {
    return { targetRoot: pluginRoot, isRepo: false };
  }
  const proj = parseReposMd().find((p) => p.code.toLowerCase() === raw.toLowerCase());
  if (!proj) {
    throw new Error(`未在仓库地图中定位到项目代号: ${raw}`);
  }
  if (writable && String(proj.role || '').toLowerCase() === 'test-bed') {
    throw new Error(`安全拦截：测试靶场 ${proj.code} 严格只读，禁止修改其规则或门禁`);
  }
  const phys = String(proj.physical_path || '').trim();
  if (!phys || !existsSync(phys) || !statSync(phys).isDirectory()) {
    throw new Error(`仓库 ${proj.code} 物理目录不存在: ${phys}`);
  }
  return { targetRoot: phys, isRepo: true };
}

function isAllowedRepoGovernanceRel(cleanRel, writable) {
  const lower = cleanRel.toLowerCase();
  if (lower === 'agents.md' || lower === 'gemini.md') return true;
  if (lower.startsWith('.agents/rules/') && lower.endsWith('.md')) return true;
  if (lower.startsWith('scripts/lints/')) {
    if (lower.endsWith('.decision.json')) return true;
    if (!writable && lower.endsWith('.py')) return true;
  }
  return false;
}

function isAllowedWritable(rel) {
  const lower = rel.toLowerCase();
  return (
    lower.startsWith('rules/') ||
    lower.startsWith('decisions/') ||
    lower.startsWith('repos/') ||
    lower === 'repos.md' ||
    lower === 'config.json'
  );
}

function extractRuleTitleAndClauses(content, fallbackName) {
  let title = '';
  let count = 0;
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#+\s*/, '').trim();
    }
    if (line.startsWith('- **') || /^\d+\.\s+\*\*/.test(trimmed)) {
      count += 1;
    }
  }
  return {
    title: title || fallbackName.replace(/\.md$/i, ''),
    clause_count: count,
  };
}

function estimateMarkdownTokens(raw) {
  let ascii = 0;
  let nonAscii = 0;
  let chars = 0;
  for (const ch of String(raw || '')) {
    chars += 1;
    if (ch.codePointAt(0) <= 127) ascii += 1;
    else nonAscii += 1;
  }
  const estimated_tokens = Math.ceil(ascii / 4 + nonAscii / 1.2);
  return { char_count: chars, estimated_tokens };
}

function pushRuleEntryFromPath(baseRoot, full, scope, repo, editable, out) {
  if (!existsSync(full) || !statSync(full).isFile()) return;
  const st = statSync(full);
  const rel = full.slice(baseRoot.length + 1).replace(/\\/g, '/');
  const name = basename(full);
  const raw = readFileSync(full, 'utf-8');
  const { title, clause_count } = extractRuleTitleAndClauses(raw, name);
  const { char_count, estimated_tokens } = estimateMarkdownTokens(raw);
  out.push({
    rel_path: rel,
    abs_path: full,
    name,
    scope,
    repo,
    title,
    clause_count,
    char_count,
    estimated_tokens,
    editable,
    size_bytes: st.size,
    modified_ts: Math.floor(st.mtimeMs / 1000),
  });
}

function collectRuleEntriesInDir(baseRoot, rulesDir, scope, repo, editable, out) {
  if (!existsSync(rulesDir) || !statSync(rulesDir).isDirectory()) return;
  const files = readdirSync(rulesDir).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  for (const name of files) {
    pushRuleEntryFromPath(baseRoot, join(rulesDir, name), scope, repo, editable, out);
  }
}

function lookupCheckerStat(stats, kind, scope, repo, id) {
  const empty = { eval_count: 0, hit_count: 0, last_eval_ts: 0, last_hit_ts: 0 };
  if (!stats) return empty;
  if (kind === 'decision') {
    if (scope === 'global') return stats.decisionGlobal.get(id) || empty;
    return stats.decisionByRepo.get(`${String(repo || '').toLowerCase()}::${id}`) || empty;
  }
  const up = String(id || '').toUpperCase();
  if (scope === 'global') return stats.lintGlobal.get(up) || empty;
  return stats.lintByRepo.get(`${String(repo || '').toLowerCase()}::${up}`) || empty;
}

function collectDecisionEntriesInDir(baseRoot, decisionDir, scope, repo, editable, stats, out) {
  if (!existsSync(decisionDir) || !statSync(decisionDir).isDirectory()) return;
  const files = readdirSync(decisionDir)
    .filter((n) => n.toLowerCase().endsWith('.decision.json'))
    .sort();
  for (const name of files) {
    const full = join(decisionDir, name);
    if (!statSync(full).isFile()) continue;
    const st = statSync(full);
    const rel = full.slice(baseRoot.length + 1).replace(/\\/g, '/');
    const fallbackId = name.replace(/\.decision\.json$/i, '');
    try {
      const parsed = JSON.parse(readFileSync(full, 'utf-8'));
      const q = parsed.question || {};
      const criteria = q.criteria || {};
      const instructions = String(q.instructions || '').trim();
      const passed = String(criteria.passed || '').trim();
      const violated = String(criteria.violated || '').trim();
      const id = String(parsed.id || fallbackId).trim() || fallbackId;
      const hitStat = lookupCheckerStat(stats, 'decision', scope, repo, id);
      out.push({
        id,
        name: String(parsed.name || id).trim() || id,
        scope,
        repo,
        category: String(parsed.category || 'implementation_hygiene').trim(),
        enabled: parsed.enabled !== false,
        retired_at: String(parsed.retired_at || '').trim(),
        retired_reason: String(parsed.retired_reason || '').trim(),
        eval_count: hitStat.eval_count,
        hit_count: hitStat.hit_count,
        last_eval_ts: hitStat.last_eval_ts,
        last_hit_ts: hitStat.last_hit_ts,
        triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map((x) => String(x).trim()).filter(Boolean) : [],
        file_patterns: Array.isArray(parsed.file_patterns)
          ? parsed.file_patterns.map((x) => String(x).trim().replace(/\\/g, '/')).filter(Boolean)
          : [],
        instructions,
        passed_criteria: passed,
        violated_criteria: violated,
        why: String(parsed.why || '').trim(),
        rel_path: rel,
        abs_path: full,
        editable,
        parse_error:
          !instructions || !passed || !violated ? '缺少 question.instructions 或 criteria.passed/violated' : null,
        size_bytes: st.size,
        modified_ts: Math.floor(st.mtimeMs / 1000),
      });
    } catch (err) {
      const hitStat = lookupCheckerStat(stats, 'decision', scope, repo, fallbackId);
      out.push({
        id: fallbackId,
        name: fallbackId,
        scope,
        repo,
        category: 'implementation_hygiene',
        enabled: false,
        retired_at: '',
        retired_reason: '',
        eval_count: hitStat.eval_count,
        hit_count: hitStat.hit_count,
        last_eval_ts: hitStat.last_eval_ts,
        last_hit_ts: hitStat.last_hit_ts,
        triggers: [],
        file_patterns: [],
        instructions: '',
        passed_criteria: '',
        violated_criteria: '',
        why: '',
        rel_path: rel,
        abs_path: full,
        editable,
        parse_error: `JSON 解析失败: ${err?.message || err}`,
        size_bytes: st.size,
        modified_ts: Math.floor(st.mtimeMs / 1000),
      });
    }
  }
}

function collectLintItemsInDir(baseRoot, lintsDir, scope, repo, stats, out) {
  if (!existsSync(lintsDir) || !statSync(lintsDir).isDirectory()) return;
  const files = readdirSync(lintsDir)
    .filter((n) => n.toLowerCase().endsWith('.py') && n !== '__init__.py')
    .sort();
  for (const fileName of files) {
    const full = join(lintsDir, fileName);
    if (!statSync(full).isFile()) continue;
    const rel = full.slice(baseRoot.length + 1).replace(/\\/g, '/');
    const lines = readFileSync(full, 'utf-8').split(/\r?\n/);
    let found = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith('def check_')) continue;
      const tail = trimmed.slice('def check_'.length).split('(')[0].trim();
      if (!tail) continue;
      let desc = '';
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine.startsWith('"""')) {
        desc = nextLine.replace(/^"""/, '').replace(/"""$/, '').trim();
      }
      const id = tail.toUpperCase();
      const hitStat = lookupCheckerStat(stats, 'lint', scope, repo, id);
      out.push({
        id,
        name: `check_${tail}`,
        scope,
        repo,
        file_name: fileName,
        rel_path: rel,
        abs_path: full,
        description: desc || `静态检查函数 check_${tail}`,
        line_number: i + 1,
        eval_count: hitStat.eval_count,
        hit_count: hitStat.hit_count,
        last_eval_ts: hitStat.last_eval_ts,
        last_hit_ts: hitStat.last_hit_ts,
      });
      found += 1;
    }
    if (found === 0) {
      const stem = fileName.replace(/\.py$/i, '');
      const id = stem.toUpperCase();
      const hitStat = lookupCheckerStat(stats, 'lint', scope, repo, id);
      out.push({
        id,
        name: fileName,
        scope,
        repo,
        file_name: fileName,
        rel_path: rel,
        abs_path: full,
        description: '仓库静态检查脚本',
        line_number: 1,
        eval_count: hitStat.eval_count,
        hit_count: hitStat.hit_count,
        last_eval_ts: hitStat.last_eval_ts,
        last_hit_ts: hitStat.last_hit_ts,
      });
    }
  }
}

function scanGovernanceAssets(repos, stats) {
  const governance_rules = [];
  const decisions = [];
  const lints = [];

  collectRuleEntriesInDir(pluginRoot, join(pluginRoot, 'rules'), 'global', 'a8-agent-mind', true, governance_rules);
  collectDecisionEntriesInDir(pluginRoot, join(pluginRoot, 'decisions'), 'global', 'a8-agent-mind', true, stats, decisions);
  collectLintItemsInDir(pluginRoot, join(pluginRoot, 'lints'), 'global', 'a8-agent-mind', stats, lints);

  for (const proj of repos) {
    const phys = String(proj.physical_path || '').trim();
    if (!phys || !existsSync(phys) || !statSync(phys).isDirectory()) continue;
    const editable = String(proj.role || '').toLowerCase() !== 'test-bed';
    collectRuleEntriesInDir(phys, join(phys, '.agents', 'rules'), 'project', proj.code, editable, governance_rules);
    for (const mapName of ['AGENTS.md', 'GEMINI.md']) {
      pushRuleEntryFromPath(phys, join(phys, mapName), 'project', proj.code, editable, governance_rules);
    }
    collectDecisionEntriesInDir(phys, join(phys, 'scripts', 'lints'), 'project', proj.code, editable, stats, decisions);
    collectLintItemsInDir(phys, join(phys, 'scripts', 'lints'), 'project', proj.code, stats, lints);
  }

  governance_rules.sort((a, b) => {
    const aM = a.scope === 'global' && a.rel_path === 'rules/mind-rules.md' ? 1 : 0;
    const bM = b.scope === 'global' && b.rel_path === 'rules/mind-rules.md' ? 1 : 0;
    return bM - aM || a.scope.localeCompare(b.scope) || a.repo.localeCompare(b.repo) || a.rel_path.localeCompare(b.rel_path);
  });
  decisions.sort((a, b) => a.scope.localeCompare(b.scope) || a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id));

  const global_rule_tokens = governance_rules
    .filter((r) => r.scope === 'global')
    .reduce((acc, r) => acc + (r.estimated_tokens || 0), 0);
  const project_rule_tokens = governance_rules
    .filter((r) => r.scope === 'project')
    .reduce((acc, r) => acc + (r.estimated_tokens || 0), 0);

  const governance_summary = {
    rule_files_count: governance_rules.length,
    rule_clauses_count: governance_rules.reduce((acc, r) => acc + (r.clause_count || 0), 0),
    rule_total_tokens: global_rule_tokens + project_rule_tokens,
    global_rule_tokens,
    project_rule_tokens,
    global_rule_files_count: governance_rules.filter((r) => r.scope === 'global').length,
    project_rule_files_count: governance_rules.filter((r) => r.scope === 'project').length,
    decisions_count: decisions.length,
    enabled_decisions_count: decisions.filter((d) => d.enabled && !d.parse_error).length,
    global_decisions_count: decisions.filter((d) => d.scope === 'global').length,
    project_decisions_count: decisions.filter((d) => d.scope === 'project').length,
    lints_count: lints.length,
  };

  return { governance_rules, decisions, lints, governance_summary };
}

function buildOverviewDto() {
  const repos = parseReposMd();
  const reviews = parseReviewsDir();
  const configJson = maskConfigSecrets(readJsonOrEmpty(join(pluginRoot, 'config.json')));
  const threshold = Number(configJson?.confidence_threshold ?? 0.85) || 0.85;
  const { telemetry, stats } = parseHarnessTelemetryWithStats(threshold);
  const { governance_rules, decisions, lints, governance_summary } = scanGovernanceAssets(repos, stats);
  const files = [];
  for (const [dirName, cat] of [
    ['rules', 'rules'],
    ['decisions', 'decisions'],
    ['repos', 'projects'],
    ['reviews', 'reviews'],
    ['skills', 'skills'],
    ['agents', 'agents'],
  ]) {
    collectFilesRecursive(join(pluginRoot, dirName), cat, files);
  }
  for (const [topFile, cat] of [
    ['repos.md', 'projects'],
    ['design.md', 'config'],
    ['plugin.json', 'config'],
    ['config.json', 'config'],
    ['readme.md', 'config'],
  ]) {
    const fp = join(pluginRoot, topFile);
    if (existsSync(fp)) {
      const st = statSync(fp);
      files.push({
        rel_path: topFile,
        name: topFile,
        category: cat,
        extension: extname(topFile).replace(/^\./, '').toLowerCase(),
        size_bytes: st.size,
        modified_ts: Math.floor(st.mtimeMs / 1000),
      });
    }
  }
  files.sort((a, b) => a.category.localeCompare(b.category) || a.rel_path.localeCompare(b.rel_path));

  const proposalsDir = grokProposalsDir();
  const proposals = parseGrokProposalsDir(proposalsDir);

  return {
    plugin_root: pluginRoot,
    mounted_target: null,
    mount_alive: true,
    sidecar_running: true,
    sidecar_url: `http://127.0.0.1:${port}`,
    plugin_meta: readJsonOrEmpty(join(pluginRoot, 'plugin.json')),
    config_json: configJson,
    projects: repos,
    reviews,
    proposals,
    proposals_dir: proposalsDir || '',
    files,
    governance_rules,
    decisions,
    lints,
    governance_summary,
    telemetry,
  };
}

const MAX_DIFF_FILE_BYTES = 300 * 1024;
const MAX_UNTRACKED_BYTES = 256 * 1024;
const MAX_UNTRACKED_LINES = 2500;

function runGitSync(repoRoot, args, { allowFail = false } = {}) {
  const res = spawnSync('git', ['-C', repoRoot, '-c', 'core.quotePath=false', ...args], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error) {
    throw new Error(`执行 git 命令失败（请确认已安装 git 并加入 PATH）: ${res.error.message}`);
  }
  const stdout = Buffer.isBuffer(res.stdout) ? res.stdout.toString('utf8') : String(res.stdout || '');
  const stderr = Buffer.isBuffer(res.stderr) ? res.stderr.toString('utf8') : String(res.stderr || '');
  if (res.status !== 0 && !allowFail) {
    throw new Error(stderr.trim() || `git ${args.join(' ')} 退出码 ${res.status}`);
  }
  return { ok: res.status === 0, stdout, stderr };
}

function truncateUtf8OnLine(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  const sliced = buf.subarray(0, maxBytes).toString('utf8');
  const lastNl = sliced.lastIndexOf('\n');
  const cut = lastNl >= 0 ? sliced.slice(0, lastNl + 1) : sliced;
  return { text: cut, truncated: true };
}

function stripAbPrefix(raw) {
  const trimmed = String(raw || '').trim();
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
      ? trimmed.slice(1, -1)
      : trimmed;
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) {
    return unquoted.slice(2);
  }
  return unquoted;
}

function parseDiffGitHeaderPaths(headerLine) {
  const rest = headerLine.startsWith('diff --git ') ? headerLine.slice(11).trim() : '';
  const bIdx = rest.indexOf(' b/');
  if (bIdx >= 0) {
    return [stripAbPrefix(rest.slice(0, bIdx)), stripAbPrefix(rest.slice(bIdx + 1))];
  }
  const parts = rest.split(/\s+/);
  if (parts.length >= 2) {
    return [stripAbPrefix(parts[0]), stripAbPrefix(parts[1])];
  }
  return ['', ''];
}

function parseGitDiffBlocks(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];
  const blocks = [];
  let start = -1;
  let offset = 0;
  for (const line of normalized.split(/(?<=\n)/)) {
    if (line.startsWith('diff --git ')) {
      if (start >= 0) blocks.push(normalized.slice(start, offset));
      start = offset;
    }
    offset += line.length;
  }
  if (start >= 0) blocks.push(normalized.slice(start));

  const files = [];
  for (const block of blocks) {
    const trimmedBlock = block.replace(/\n+$/, '');
    const lines = trimmedBlock.split('\n');
    const firstLine = lines[0];
    if (!firstLine) continue;
    const [hdrOld, hdrNew] = parseDiffGitHeaderPaths(firstLine);

    let status = 'M';
    let oldPath = '';
    let newPath = hdrNew;
    let renameFrom = '';
    let renameTo = '';
    let isBinary = false;
    let inHunk = false;
    let additions = 0;
    let deletions = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!inHunk) {
        if (line.startsWith('new file mode ')) status = 'A';
        else if (line.startsWith('deleted file mode ')) status = 'D';
        else if (line.startsWith('rename from ')) {
          status = 'R';
          renameFrom = line.slice(12).trim();
        } else if (line.startsWith('rename to ')) {
          status = 'R';
          renameTo = line.slice(10).trim();
        } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
          isBinary = true;
        } else if (line.startsWith('--- ')) {
          const p = line.slice(4).trim();
          if (p !== '/dev/null') oldPath = stripAbPrefix(p);
        } else if (line.startsWith('+++ ')) {
          const p = line.slice(4).trim();
          if (p !== '/dev/null') newPath = stripAbPrefix(p);
        } else if (line.startsWith('@@ ')) {
          inHunk = true;
        }
      } else if (line.startsWith('@@ ')) {
        inHunk = true;
      } else if (line.startsWith('+') && !line.startsWith('+++ ')) {
        additions += 1;
      } else if (line.startsWith('-') && !line.startsWith('--- ')) {
        deletions += 1;
      }
    }

    const displayPath =
      renameTo || (status === 'D' ? oldPath || hdrOld : newPath || hdrOld);
    const displayOld = status === 'R' ? renameFrom || hdrOld : '';
    const capped = truncateUtf8OnLine(trimmedBlock, MAX_DIFF_FILE_BYTES);
    files.push({
      path: displayPath,
      old_path: displayOld,
      status,
      additions,
      deletions,
      is_binary: isBinary,
      truncated: capped.truncated,
      diff_text: isBinary ? '' : capped.text,
    });
  }
  return files;
}

function buildUntrackedFileDiff(repoRoot, relPath) {
  const cleanRel = String(relPath || '').trim().replace(/\\/g, '/');
  const full = join(repoRoot, cleanRel);
  if (!existsSync(full)) {
    return {
      path: cleanRel,
      old_path: '',
      status: 'U',
      additions: 0,
      deletions: 0,
      is_binary: true,
      truncated: false,
      diff_text: '',
    };
  }
  const buf = readFileSync(full);
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  if (probe.includes(0)) {
    return {
      path: cleanRel,
      old_path: '',
      status: 'U',
      additions: 0,
      deletions: 0,
      is_binary: true,
      truncated: false,
      diff_text: '',
    };
  }
  const fullText = buf.toString('utf8').replace(/\r\n/g, '\n');
  const capped = truncateUtf8OnLine(fullText, MAX_UNTRACKED_BYTES);
  const lines = capped.text.split('\n');
  if (capped.text.endsWith('\n') && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const lineTruncated = lines.length > MAX_UNTRACKED_LINES;
  if (lineTruncated) lines.length = MAX_UNTRACKED_LINES;

  const header = `diff --git a/${cleanRel} b/${cleanRel}\nnew file mode 100644\n--- /dev/null\n+++ b/${cleanRel}`;
  const body =
    lines.length > 0
      ? `\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`
      : '';
  return {
    path: cleanRel,
    old_path: '',
    status: 'U',
    additions: lines.length,
    deletions: 0,
    is_binary: false,
    truncated: capped.truncated || lineTruncated,
    diff_text: `${header}${body}`,
  };
}

function getRepoGitDiff(repoCode, scope) {
  const cleanCode = String(repoCode || '').trim();
  if (!cleanCode) throw new Error('缺少目标仓库代号 repo_code');
  const repos = parseReposMd();
  const proj = repos.find((p) => String(p.code || '').toLowerCase() === cleanCode.toLowerCase());
  if (!proj || !proj.physical_path) throw new Error(`未在仓库地图找到项目: ${cleanCode}`);
  const repoRoot = proj.physical_path.trim();
  if (!existsSync(repoRoot)) throw new Error(`项目目录不存在: ${repoRoot}`);

  const inside = runGitSync(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside.stdout.trim() !== 'true') {
    throw new Error(`目录不是有效的 Git 仓库: ${repoRoot}`);
  }

  const rawScope = String(scope || '').trim().toLowerCase();
  const normScope = rawScope === 'staged' || rawScope === 'unstaged' ? rawScope : 'all';
  const hasHead = runGitSync(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowFail: true }).ok;

  const branch = hasHead
    ? runGitSync(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).stdout.trim() || 'HEAD'
    : 'HEAD (尚无提交)';
  const headSummary = hasHead
    ? runGitSync(repoRoot, ['log', '-1', '--pretty=%h %s'], { allowFail: true }).stdout.trim()
    : '';

  let files = [];
  if (normScope === 'staged') {
    const res = runGitSync(repoRoot, ['diff', '--no-color', '--unified=3', '--find-renames', '--cached']);
    files = parseGitDiffBlocks(res.stdout);
  } else if (normScope === 'unstaged') {
    const res = runGitSync(repoRoot, ['diff', '--no-color', '--unified=3', '--find-renames']);
    files = parseGitDiffBlocks(res.stdout);
  } else if (hasHead) {
    const res = runGitSync(repoRoot, ['diff', '--no-color', '--unified=3', '--find-renames', 'HEAD']);
    files = parseGitDiffBlocks(res.stdout);
  } else {
    const staged = runGitSync(repoRoot, ['diff', '--no-color', '--unified=3', '--find-renames', '--cached']);
    const unstaged = runGitSync(repoRoot, ['diff', '--no-color', '--unified=3', '--find-renames']);
    files = [...parseGitDiffBlocks(staged.stdout), ...parseGitDiffBlocks(unstaged.stdout)];
  }

  if (normScope !== 'staged') {
    const untracked = runGitSync(repoRoot, ['ls-files', '--others', '--exclude-standard']);
    const seen = new Set(files.map((f) => f.path.toLowerCase()));
    for (const rel of untracked.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const key = rel.replace(/\\/g, '/').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        files.push(buildUntrackedFileDiff(repoRoot, rel));
      }
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  return {
    repo_code: cleanCode,
    repo_path: repoRoot.replace(/\\/g, '/'),
    branch,
    head_summary: headSummary,
    scope: normScope,
    has_head: hasHead,
    total_additions: totalAdditions,
    total_deletions: totalDeletions,
    files,
  };
}

function sendStaticBytes(res, statusCode, contentType, bodyBuf, method, extraHeaders = {}) {
  const buf = Buffer.isBuffer(bodyBuf) ? bodyBuf : Buffer.from(String(bodyBuf), 'utf-8');
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sidecar-Token',
    ...extraHeaders,
    'Content-Type': contentType,
    'Content-Length': buf.length,
  });
  res.end(method === 'HEAD' ? undefined : buf);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const method = String(req.method || 'GET').toUpperCase();
  const urlPath = (req.url || '/').split('?')[0];

  if (method === 'OPTIONS') {
    const isApi = urlPath.startsWith('/api/') || urlPath.startsWith('/_sidecar/');
    if (isApi && origin && !isAllowedOrigin(origin)) {
      sendJson(res, 403, { ok: false, error: '安全拦截：禁止非本机 Origin 调用' }, { 'Cache-Control': 'no-cache' });
      return;
    }
    const optHeaders = {
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': isApi ? origin || '*' : '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sidecar-Token',
    };
    if (isApi && origin) {
      optHeaders.Vary = 'Origin';
    }
    res.writeHead(204, optHeaders);
    res.end();
    return;
  }

  // 静态资源 GET/HEAD 在 Origin 拦截之前优先放行，并挂载宿主 /preload.js
  if ((method === 'GET' || method === 'HEAD') && !urlPath.startsWith('/api/') && !urlPath.startsWith('/_sidecar/')) {
    const uiDistDir = resolveUiDistDir();
    if (urlPath === '/preload.js') {
      sendStaticBytes(res, 200, 'application/javascript; charset=utf-8', resolvePreloadJs(uiDistDir), method);
      return;
    }
    if (uiDistDir) {
      const cleanWebPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const assetPath = resolve(uiDistDir, cleanWebPath);
      const inDist =
        assetPath === join(uiDistDir, 'index.html') ||
        assetPath.toLowerCase().startsWith((uiDistDir + sep).toLowerCase());
      if (inDist && existsSync(assetPath) && statSync(assetPath).isFile()) {
        const ext = extname(assetPath).toLowerCase();
        sendStaticBytes(res, 200, MIME_MAP[ext] || 'application/octet-stream', readFileSync(assetPath), method);
        return;
      }
      if (!cleanWebPath.includes('.')) {
        const indexFile = join(uiDistDir, 'index.html');
        sendStaticBytes(res, 200, 'text/html; charset=utf-8', readFileSync(indexFile), method);
        return;
      }
      sendStaticBytes(res, 404, 'text/plain; charset=utf-8', 'Not Found', method);
      return;
    }
    sendStaticBytes(
      res,
      503,
      'text/html; charset=utf-8',
      '<!doctype html><meta charset="utf-8"><title>Dashboard 未构建</title><body style="font-family:sans-serif;padding:24px"><h3>A8 Agent Mind Dashboard 静态资源未就绪</h3><p>请在 modules/devtools/web 执行 npm run build 后重试。</p></body>',
      method,
    );
    return;
  }

  const corsOk = !origin || isAllowedOrigin(origin);
  if (!corsOk) {
    sendJson(res, 403, { ok: false, error: '安全拦截：禁止非本机 Origin 调用' }, { 'Cache-Control': 'no-cache' });
    return;
  }

  const headers = {
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sidecar-Token',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  if (method === 'POST') {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('application/json')) {
      sendJson(res, 415, { ok: false, error: '仅接受 application/json 请求体' }, headers);
      return;
    }
  }

  try {
    if (method === 'GET' && urlPath === '/api/agent-mind/overview') {
      sendJson(res, 200, { ok: true, data: buildOverviewDto() }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/read') {
      const body = await readJsonBody(req);
      const { targetRoot, isRepo } = resolveTargetScope(body.repo_code, false);
      const { cleanRel, target } = resolveSafePathInRoot(targetRoot, body.rel_path);
      if (isRepo && !isAllowedRepoGovernanceRel(cleanRel, false)) {
        throw new Error(`安全拦截：仓库作用域仅允许读取 .agents/rules/*.md 或 scripts/lints/ 门禁文件 (${cleanRel})`);
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        sendJson(res, 400, { ok: false, error: `文件不存在: ${body.rel_path}` }, headers);
        return;
      }
      const raw = readFileSync(target, 'utf-8');
      if (!isRepo && cleanRel.toLowerCase() === 'config.json') {
        const parsed = JSON.parse(raw);
        sendJson(res, 200, { ok: true, data: `${JSON.stringify(maskConfigSecrets(parsed), null, 2)}\n` }, headers);
        return;
      }
      sendJson(res, 200, { ok: true, data: raw }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/save') {
      const body = await readJsonBody(req);
      const { targetRoot, isRepo } = resolveTargetScope(body.repo_code, true);
      const { cleanRel, target } = resolveSafePathInRoot(targetRoot, body.rel_path);
      if (isRepo) {
        if (!isAllowedRepoGovernanceRel(cleanRel, true)) {
          sendJson(res, 400, { ok: false, error: `安全拦截：不允许修改仓库受限路径 ${cleanRel}` }, headers);
          return;
        }
      } else if (!isAllowedWritable(cleanRel)) {
        sendJson(res, 400, { ok: false, error: `安全拦截：禁止通过面板修改受限路径 ${cleanRel}` }, headers);
        return;
      }
      let finalContent = String(body.content ?? '');
      if (!isRepo && cleanRel.toLowerCase() === 'config.json') {
        const incoming = JSON.parse(finalContent);
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          throw new Error('config.json 必须是合法 JSON 对象');
        }
        const k = String(incoming.api_key || '').trim();
        if (k === '***MASKED***' || k === '***') {
          const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf-8')) : {};
          incoming.api_key = existing.api_key || '${GEMINI_API_KEY}';
        }
        finalContent = `${JSON.stringify(incoming, null, 2)}\n`;
      } else if (cleanRel.toLowerCase().endsWith('.decision.json')) {
        const parsedDec = JSON.parse(finalContent);
        if (!parsedDec || typeof parsedDec !== 'object' || Array.isArray(parsedDec)) {
          throw new Error('Decision 规范必须是合法 JSON 对象');
        }
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, finalContent, 'utf-8');
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/create') {
      const body = await readJsonBody(req);
      const { targetRoot, isRepo } = resolveTargetScope(body.repo_code, true);
      let raw = String(body.rel_path || '').trim().replace(/\\/g, '/');
      if (isRepo) {
        if (!raw.includes('/')) {
          if (raw.toLowerCase().endsWith('.json')) {
            const stem = raw.replace(/\.json$/i, '');
            raw = `scripts/lints/${stem.endsWith('.decision') ? stem : `${stem}.decision`}.json`;
          } else {
            raw = `.agents/rules/${raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`}`;
          }
        }
        const { cleanRel, target } = resolveSafePathInRoot(targetRoot, raw);
        if (!isAllowedRepoGovernanceRel(cleanRel, true)) {
          throw new Error('仓库作用域仅允许在 .agents/rules/*.md 或 scripts/lints/*.decision.json 创建');
        }
        if (existsSync(target)) throw new Error(`文件已存在: ${cleanRel}`);
        const contentStr = String(body.content ?? '');
        if (cleanRel.toLowerCase().endsWith('.decision.json')) {
          const parsedDec = JSON.parse(contentStr);
          if (!parsedDec || typeof parsedDec !== 'object' || Array.isArray(parsedDec)) {
            throw new Error('Decision 规范必须是合法 JSON 对象');
          }
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contentStr, 'utf-8');
        sendJson(res, 200, { ok: true, data: cleanRel }, headers);
        return;
      }

      if (!raw.includes('/')) {
        if (raw.toLowerCase().endsWith('.json')) {
          const stem = raw.replace(/\.json$/i, '');
          raw = `decisions/${stem.endsWith('.decision') ? stem : `${stem}.decision`}.json`;
        } else {
          raw = `rules/${raw}`;
        }
      }
      if (!/\.(md|json)$/i.test(raw)) raw = `${raw}.md`;
      const { cleanRel, target } = resolveSafePathInRoot(targetRoot, raw);
      const lower = cleanRel.toLowerCase();
      if (
        !lower.startsWith('rules/') &&
        !lower.startsWith('repos/') &&
        !(lower.startsWith('decisions/') && lower.endsWith('.decision.json'))
      ) {
        throw new Error('仅允许在 rules/、decisions/*.decision.json 或 repos/ 下新建文件');
      }
      if (existsSync(target)) {
        throw new Error(`文件已存在: ${cleanRel}`);
      }
      const contentStr = String(body.content ?? '');
      if (lower.endsWith('.decision.json')) {
        const parsedDec = JSON.parse(contentStr);
        if (!parsedDec || typeof parsedDec !== 'object' || Array.isArray(parsedDec)) {
          throw new Error('Decision 规范必须是合法 JSON 对象');
        }
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contentStr, 'utf-8');
      sendJson(res, 200, { ok: true, data: cleanRel }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/delete') {
      const body = await readJsonBody(req);
      const { targetRoot, isRepo } = resolveTargetScope(body.repo_code, true);
      const { cleanRel, target } = resolveSafePathInRoot(targetRoot, body.rel_path);
      const lower = cleanRel.toLowerCase();
      if (isRepo) {
        if (lower === 'agents.md' || lower === 'gemini.md') {
          throw new Error('仓库根地图 (AGENTS.md / GEMINI.md) 受保护，禁止删除');
        }
        if (!isAllowedRepoGovernanceRel(cleanRel, true)) {
          throw new Error('仓库作用域仅允许删除 .agents/rules/*.md 或 scripts/lints/*.decision.json');
        }
        if (!existsSync(target) || !statSync(target).isFile()) {
          throw new Error(`文件不存在: ${cleanRel}`);
        }
        unlinkSync(target);
        sendJson(res, 200, { ok: true, data: null }, headers);
        return;
      }
      if (PROTECTED_FILES.has(lower)) {
        throw new Error('核心基础文件受保护，禁止删除');
      }
      if (
        !lower.startsWith('rules/') &&
        !lower.startsWith('decisions/') &&
        !lower.startsWith('repos/') &&
        !lower.startsWith('reviews/')
      ) {
        throw new Error('仅允许删除 rules/、decisions/、repos/ 或 reviews/ 下的文件');
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`文件不存在: ${cleanRel}`);
      }
      unlinkSync(target);
      if (lower.startsWith('reviews/')) {
        try {
          const parentDir = dirname(target);
          const reviewsRoot = resolve(realpathSync(pluginRoot), 'reviews');
          if (parentDir.toLowerCase() !== reviewsRoot.toLowerCase() && readdirSync(parentDir).length === 0) {
            rmdirSync(parentDir);
          }
        } catch {
          // ignore empty-dir cleanup error
        }
      }
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/open-dir') {
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(cmd, [pluginRoot], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.unref();
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/proposal/read') {
      const body = await readJsonBody(req);
      const target = resolveSafeProposalFile(grokProposalsDir(), body.file_name);
      sendJson(res, 200, { ok: true, data: readFileSync(target, 'utf-8') }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/proposal/delete') {
      const body = await readJsonBody(req);
      const target = resolveSafeProposalFile(grokProposalsDir(), body.file_name);
      unlinkSync(target);
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/proposal/open-dir') {
      const dir = grokProposalsDir();
      if (!dir) throw new Error('未定位到 a8-devtools 仓库根目录');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(cmd, [dir], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.unref();
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/proposal/advance') {
      const body = await readJsonBody(req);
      const dir = grokProposalsDir();
      const target = resolveSafeProposalFile(dir, body.file_name);
      const repoRoot = resolveDevtoolsRepoRoot() || 'E:\\a8-devtools';
      const stem = String(body.file_name || '').replace(/\.md$/i, '');
      const convTitle = String(body.title || '').trim() || `推进 Grok 提案 (${stem})`;
      const convPrompt =
        String(body.prompt || '').trim() ||
        `请阅读提案文件 \`${target}\` 以及 \`${join(repoRoot, 'AGENTS.md')}\`，并与我确认后开始推进实施其中的工作流提升提案（优先推进 P0/P1 项，先给出本次拟落地的改造计划）。`;
      const parsed = invokeAgentApi(['new-conversation', '--title', convTitle, convPrompt], {
        projectId: process.env.ANTIGRAVITY_PROJECT_ID,
      });
      try {
        const curRaw = readFileSync(target, 'utf-8');
        const { fm } = parseFrontmatter(curRaw);
        const curStatus = String(fm.status || '').trim().toLowerCase();
        if (!curStatus || curStatus === 'pending') {
          updateProposalStatusFile(target, 'in_progress');
        }
      } catch {
        // Ignore status promotion error after conversation launch
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          data: {
            conversation_id: extractConversationId(parsed),
            focused_antigravity: true,
            method: 'agentapi',
          },
        },
        headers,
      );
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/proposal/status') {
      const body = await readJsonBody(req);
      const dir = grokProposalsDir();
      const target = resolveSafeProposalFile(dir, body.file_name);
      const nextStatus = String(body.status || '').trim().toLowerCase();
      if (!['pending', 'in_progress', 'adopted', 'dismissed'].includes(nextStatus)) {
        throw new Error(`非法提案状态: ${body.status}`);
      }
      updateProposalStatusFile(target, nextStatus);
      const updatedList = parseGrokProposalsDir(dir);
      const fileNameLower = basename(target).toLowerCase();
      const record = updatedList.find((p) => p.file_name.toLowerCase() === fileNameLower);
      if (!record) throw new Error('更新后未读取到提案记录');
      sendJson(res, 200, { ok: true, data: record }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/lints/run') {
      const body = await readJsonBody(req);
      const repoCode = String(body.repo_code || '').trim();
      if (!repoCode) throw new Error('缺少目标仓库代号 repo_code');
      const repos = parseReposMd();
      const proj = repos.find((p) => String(p.code || '').toLowerCase() === repoCode.toLowerCase());
      if (!proj || !proj.physical_path) throw new Error(`未在仓库地图找到项目: ${repoCode}`);
      const runner = join(pluginRoot, 'scripts', 'run_repo_lints.py');
      if (!existsSync(runner)) throw new Error(`缺失插件 Lint 运行器: ${runner}`);
      const exe = process.platform === 'win32' ? 'py' : 'python3';
      const args = process.platform === 'win32' ? ['-3', runner, proj.physical_path] : [runner, proj.physical_path];
      let out = spawnSync(exe, args, { encoding: 'utf-8', windowsHide: true });
      if (out.error) {
        out = spawnSync('python', [runner, proj.physical_path], { encoding: 'utf-8', windowsHide: true });
      }
      if (out.error) throw out.error;
      const stdout = String(out.stdout || '').trim();
      if (!stdout) throw new Error(String(out.stderr || 'Lint 运行器未输出有效结果').trim());
      const parsed = JSON.parse(stdout);
      sendJson(res, 200, { ok: true, data: parsed }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/git/diff') {
      const body = await readJsonBody(req);
      const result = getRepoGitDiff(body.repo_code, body.scope);
      sendJson(res, 200, { ok: true, data: result }, headers);
      return;
    }

    if (method === 'POST' && (urlPath === '/_sidecar/new-conversation' || urlPath === '/_sidecar/get-conversation-metadata')) {
      const expectedToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
      if (expectedToken && req.headers['x-sidecar-token'] !== expectedToken) {
        sendJson(res, 401, { error: 'unauthorized' }, headers);
        return;
      }
      const body = await readJsonBody(req);
      if (urlPath === '/_sidecar/get-conversation-metadata') {
        const result = invokeAgentApi(['get-conversation-metadata', String(body.conversationId || '')]);
        sendJson(res, 200, result, headers);
        return;
      }
      const args = ['new-conversation'];
      if (body.title) args.push('--title', String(body.title));
      args.push(String(body.message || ''));
      const result = invokeAgentApi(args, { projectId: body.projectId });
      sendJson(res, 200, result, headers);
      return;
    }

    if (urlPath.startsWith('/api/') || urlPath.startsWith('/_sidecar/')) {
      sendJson(res, 404, { ok: false, error: 'API 路由不存在' }, headers);
      return;
    }
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || String(err) }, headers);
    return;
  }

  sendStaticBytes(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', method);
});

server.on('error', (err) => {
  console.error(`[a8-agent-mind] Sidecar failed on 127.0.0.1:${port}: ${err?.message || err}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[a8-agent-mind] Dashboard ready on http://127.0.0.1:${port}`);
});
