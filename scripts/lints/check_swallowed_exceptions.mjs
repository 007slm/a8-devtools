#!/usr/bin/env node
/**
 * 静态异常保留防线检查 (NO_SWALLOWED_EXCEPTIONS)
 *
 * 规则依据（mind-rules.md 四/3）：
 *   1. LOG_ONLY_SWALLOW_CATCH: catch 块内仅执行日志/控制台输出（log/logger/console/System.out/err/printStackTrace），
 *      无 throw / return / 状态处理 / 重试 / 恢复动作；
 *   2. USELESS_RETHROW_CATCH: 单一 catch 块仅原样 `throw e`（非多 catch 顺序窄化），属于冗余无效 try/catch；
 *   3. EMPTY_CATCH: 无任何可执行语句且未明确命名 `ignored`/`_` 或注明跳过原因的空 catch 块。
 *
 * 用法：
 *   node scripts/lints/check_swallowed_exceptions.mjs          # 全仓源码扫描
 *   node scripts/lints/check_swallowed_exceptions.mjs --diff   # 仅拦截工作区/暂存区新增或改动行（零历史噪声）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SOURCE_EXT_RE = /\.(java|ts|tsx|js|jsx|mjs)$/i;
const EXCLUDE_SEGMENTS = new Set([
  '.git',
  'target',
  'node_modules',
  'dist',
  'build',
  'logs',
  '.cowdiff',
]);

function isExcludedRel(relPosix) {
  const parts = relPosix.split('/');
  if (parts.some((p) => EXCLUDE_SEGMENTS.has(p))) return true;
  if (relPosix.startsWith('modules/devtools/ui/')) return true;
  if (relPosix.includes('/src/test/') || relPosix.startsWith('scripts/tests/')) return true;
  return false;
}

function walkSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
    if (isExcludedRel(rel)) continue;
    if (ent.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (SOURCE_EXT_RE.test(ent.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 将字符串字面量、模板字符串与注释替换为空白，同时保留换行符以保持行号 1:1 精确。
 */
function stripStringsAndComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];

    if (ch === '/' && nx === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && nx === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += q;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i + 1] === '\n' ? '\n' : '  ';
          i += 2;
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += q;
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function splitTopLevelStatements(bodyClean) {
  const stmts = [];
  let cur = '';
  let paren = 0;
  let bracket = 0;
  let brace = 0;

  for (let i = 0; i < bodyClean.length; i++) {
    const ch = bodyClean[i];
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);

    const atTop = paren === 0 && bracket === 0 && brace === 0;
    if (atTop && (ch === ';' || ch === '\n')) {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const tail = cur.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

const LOG_STMT_RE =
  /^(?:(?:this\.)?(?:log|logger|LOG|LOGGER)|console)\s*\.\s*(?:trace|debug|info|warn|warning|error|fatal|log)\s*\([\s\S]*\)$/;
const SYS_PRINT_RE = /^System\s*\.\s*(?:err|out)\s*\.\s*print(?:ln|f)?\s*\([\s\S]*\)$/;
const STACK_TRACE_RE = /^[A-Za-z_$][\w$]*\s*\.\s*printStackTrace\s*\(\s*\)$/;
const TRIVIAL_RETHROW_RE = /^throw(?:\s+[A-Za-z_$][\w$]*)?$/;

function isPureLogStatement(stmt) {
  return LOG_STMT_RE.test(stmt) || SYS_PRINT_RE.test(stmt) || STACK_TRACE_RE.test(stmt);
}

function extractCatchParamName(rawParam) {
  if (!rawParam) return '';
  const inner = rawParam.slice(1, -1).trim();
  if (!inner) return '';
  const tokens = inner.split(/\s+/);
  return tokens[tokens.length - 1] || '';
}

function analyzeFile(relPosix) {
  const full = path.join(REPO_ROOT, relPosix);
  if (!fs.existsSync(full)) return [];
  const raw = fs.readFileSync(full, 'utf8');
  const clean = stripStringsAndComments(raw);
  const findings = [];

  const catchRe = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  let match;
  while ((match = catchRe.exec(clean)) !== null) {
    // 跳过对象属性/方法定义或伪匹配（catch 前一个字符不能是 `.` 或字母数字）
    const prevCh = match.index > 0 ? clean[match.index - 1] : '';
    if (prevCh === '.' || /[A-Za-z0-9_$]/.test(prevCh)) continue;

    let depth = 1;
    let i = catchRe.lastIndex;
    while (i < clean.length && depth > 0) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;

    const bodyStart = catchRe.lastIndex;
    const bodyEnd = i - 1;
    const cleanBody = clean.slice(bodyStart, bodyEnd);
    const rawBody = raw.slice(bodyStart, bodyEnd);
    const afterCatch = clean.slice(i).trimStart();
    const followedByCatch = /^catch\b/.test(afterCatch);
    const startLine = clean.slice(0, match.index).split('\n').length;
    const endLine = clean.slice(0, i).split('\n').length;
    const paramName = extractCatchParamName(match[1] || '');
    const stmts = splitTopLevelStatements(cleanBody);

    if (stmts.length === 0) {
      const intentionallyIgnored =
        paramName === 'ignored' ||
        paramName === '_ignored' ||
        paramName === '_' ||
        rawBody.includes('//') ||
        rawBody.includes('/*');
      if (!intentionallyIgnored) {
        findings.push({
          rule: 'EMPTY_CATCH',
          file: relPosix,
          line: startLine,
          endLine,
          detail: `空 catch 块未处理且未显式标注 ignored/原因`,
        });
      }
      continue;
    }

    if (stmts.every(isPureLogStatement)) {
      findings.push({
        rule: 'LOG_ONLY_SWALLOW_CATCH',
        file: relPosix,
        line: startLine,
        endLine,
        detail: `catch 块仅记录日志后吞掉异常 (${stmts[0].slice(0, 48)})`,
      });
      continue;
    }

    if (stmts.length === 1 && TRIVIAL_RETHROW_RE.test(stmts[0]) && !followedByCatch) {
      findings.push({
        rule: 'USELESS_RETHROW_CATCH',
        file: relPosix,
        line: startLine,
        endLine,
        detail: `冗余 try/catch：仅原样执行 \`${stmts[0]}\`，未处理异常应直接透传`,
      });
    }
  }
  return findings;
}

function getChangedFilesAndLines() {
  const fileSet = new Map(); // rel -> Set<lineNumber> | null (null means whole file is new/untracked)
  const runGit = (args) => {
    try {
      return execFileSync('git', ['-C', REPO_ROOT, '-c', 'core.quotepath=false', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return '';
    }
  };

  for (const rel of runGit(['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const norm = rel.replace(/\\/g, '/');
    if (SOURCE_EXT_RE.test(norm) && !isExcludedRel(norm)) {
      fileSet.set(norm, null);
    }
  }

  for (const diffArgs of [
    ['diff', '--unified=0', 'HEAD'],
    ['diff', '--unified=0', '--cached'],
  ]) {
    const diffOut = runGit(diffArgs);
    let curFile = '';
    for (const line of diffOut.split(/\r?\n/)) {
      if (line.startsWith('+++ b/')) {
        curFile = line.slice(6).trim().replace(/\\/g, '/');
        if (SOURCE_EXT_RE.test(curFile) && !isExcludedRel(curFile)) {
          if (!fileSet.has(curFile)) fileSet.set(curFile, new Set());
        } else {
          curFile = '';
        }
      } else if (curFile && line.startsWith('@@ ')) {
        const hunk = line.match(/\+(\d+)(?:,(\d+))?/);
        if (hunk) {
          const start = parseInt(hunk[1], 10);
          const count = hunk[2] !== undefined ? parseInt(hunk[2], 10) : 1;
          const lineSet = fileSet.get(curFile);
          if (lineSet) {
            for (let k = 0; k < count; k++) lineSet.add(start + k);
          }
        }
      }
    }
  }
  return fileSet;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const diffMode = args.has('--diff');
  const violations = [];
  let scannedCount = 0;

  if (diffMode) {
    const changed = getChangedFilesAndLines();
    for (const [rel, changedLines] of changed.entries()) {
      scannedCount++;
      for (const item of analyzeFile(rel)) {
        if (!changedLines) {
          violations.push(item);
          continue;
        }
        let overlaps = false;
        for (let ln = item.line; ln <= item.endLine; ln++) {
          if (changedLines.has(ln)) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) violations.push(item);
      }
    }
  } else {
    const files = [
      ...walkSourceFiles(path.join(REPO_ROOT, 'modules')),
      ...walkSourceFiles(path.join(REPO_ROOT, 'plugins')),
      ...walkSourceFiles(path.join(REPO_ROOT, 'scripts')),
    ];
    for (const rel of files) {
      scannedCount++;
      violations.push(...analyzeFile(rel));
    }
  }

  if (violations.length > 0) {
    console.error(
      `[FAIL] NO_SWALLOWED_EXCEPTIONS: 发现 ${violations.length} 处吞异常/无效 try-catch 违规 (${diffMode ? 'diff' : 'all'} 模式):`
    );
    for (const v of violations) {
      console.error(`  - [${v.rule}] ${v.file}:${v.line}: ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(
    `[PASS] NO_SWALLOWED_EXCEPTIONS (${diffMode ? 'diff' : 'all'} · ${scannedCount} files, 0 errors)`
  );
}

main();
