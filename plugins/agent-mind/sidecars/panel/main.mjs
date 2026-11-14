import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
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
import { dirname, extname, join, resolve, sep } from 'node:path';
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

function resolveUiDistDir() {
  const candidates = [resolve(pluginRoot, '..', '..', 'modules', 'devtools', 'ui')];
  for (const repo of parseReposMd()) {
    if (repo.code.toLowerCase() === 'a8-devtools' && repo.physicalPath) {
      candidates.push(join(repo.physicalPath, 'modules', 'devtools', 'ui'));
    }
  }
  candidates.push('E:\\a8-devtools\\modules\\devtools\\ui');
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
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

function resolveSafeRelPath(relPath) {
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

  const canonRoot = realpathSync(pluginRoot);
  const joined = resolve(canonRoot, ...parts);
  if (existsSync(joined)) {
    const canonTarget = realpathSync(joined);
    if (!canonTarget.toLowerCase().startsWith((canonRoot + sep).toLowerCase())) {
      throw new Error('安全拦截：目标路径越界插件目录');
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
    throw new Error('安全拦截：创建路径越界插件目录');
  }
  const baseRel =
    canonAncestor.length > canonRoot.length
      ? canonAncestor.slice(canonRoot.length + 1).replace(/\\/g, '/')
      : '';
  const cleanRel = baseRel ? `${baseRel}/${tail.join('/')}` : tail.join('/');
  return { cleanRel, target: joined };
}

function isAllowedWritable(rel) {
  const lower = rel.toLowerCase();
  return (
    lower.startsWith('rules/') ||
    lower.startsWith('repos/') ||
    lower === 'repos.md' ||
    lower === 'config.json'
  );
}

function buildOverviewDto() {
  const repos = parseReposMd();
  const reviews = parseReviewsDir();
  const files = [];
  for (const [dirName, cat] of [
    ['rules', 'rules'],
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

  return {
    plugin_root: pluginRoot,
    mounted_target: null,
    mount_alive: true,
    sidecar_running: true,
    sidecar_url: `http://127.0.0.1:${port}`,
    plugin_meta: readJsonOrEmpty(join(pluginRoot, 'plugin.json')),
    config_json: maskConfigSecrets(readJsonOrEmpty(join(pluginRoot, 'config.json'))),
    projects: repos,
    reviews,
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
    const isApi = urlPath.startsWith('/api/');
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
  if ((method === 'GET' || method === 'HEAD') && !urlPath.startsWith('/api/')) {
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
      '<!doctype html><meta charset="utf-8"><title>Dashboard 未构建</title><body style="font-family:sans-serif;padding:24px"><h3>Agent Mind Dashboard 静态资源未就绪</h3><p>请在 modules/devtools/web 执行 npm run build 后重试。</p></body>',
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
      const { cleanRel, target } = resolveSafeRelPath(body.rel_path);
      if (!existsSync(target) || !statSync(target).isFile()) {
        sendJson(res, 400, { ok: false, error: `文件不存在: ${body.rel_path}` }, headers);
        return;
      }
      const raw = readFileSync(target, 'utf-8');
      if (cleanRel.toLowerCase() === 'config.json') {
        const parsed = JSON.parse(raw);
        sendJson(res, 200, { ok: true, data: `${JSON.stringify(maskConfigSecrets(parsed), null, 2)}\n` }, headers);
        return;
      }
      sendJson(res, 200, { ok: true, data: raw }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/save') {
      const body = await readJsonBody(req);
      const { cleanRel, target } = resolveSafeRelPath(body.rel_path);
      if (!isAllowedWritable(cleanRel)) {
        sendJson(res, 400, { ok: false, error: `安全拦截：禁止通过面板修改受限路径 ${cleanRel}` }, headers);
        return;
      }
      let finalContent = String(body.content ?? '');
      if (cleanRel.toLowerCase() === 'config.json') {
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
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, finalContent, 'utf-8');
      sendJson(res, 200, { ok: true, data: null }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/create') {
      const body = await readJsonBody(req);
      let raw = String(body.rel_path || '').trim().replace(/\\/g, '/');
      if (!raw.includes('/')) raw = `rules/${raw}`;
      if (!/\.(md|json)$/i.test(raw)) raw = `${raw}.md`;
      const { cleanRel, target } = resolveSafeRelPath(raw);
      const lower = cleanRel.toLowerCase();
      if (!lower.startsWith('rules/') && !lower.startsWith('repos/')) {
        throw new Error('仅允许在 rules/ 或 repos/ 下新建文件');
      }
      if (existsSync(target)) {
        throw new Error(`文件已存在: ${cleanRel}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, String(body.content ?? ''), 'utf-8');
      sendJson(res, 200, { ok: true, data: cleanRel }, headers);
      return;
    }

    if (method === 'POST' && urlPath === '/api/agent-mind/delete') {
      const body = await readJsonBody(req);
      const { cleanRel, target } = resolveSafeRelPath(body.rel_path);
      const lower = cleanRel.toLowerCase();
      if (PROTECTED_FILES.has(lower)) {
        throw new Error('核心基础文件受保护，禁止删除');
      }
      if (!lower.startsWith('rules/') && !lower.startsWith('repos/') && !lower.startsWith('reviews/')) {
        throw new Error('仅允许删除 rules/、repos/ 或 reviews/ 下的文件');
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

    if (urlPath.startsWith('/api/')) {
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
  console.error(`[agent-mind] Sidecar failed on 127.0.0.1:${port}: ${err?.message || err}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[agent-mind] Dashboard ready on http://127.0.0.1:${port}`);
});
