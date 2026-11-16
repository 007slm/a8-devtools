#!/usr/bin/env node
/**
 * 仓库规则体积与脚本选型防线检查 (WORKSPACE_HYGIENE)
 *
 * 检查项：
 *   1. AGENTS_MD_SIZE_GUARD: 核验根目录 AGENTS.md / GEMINI.md 及规则文件字节体积不超过 20,000 B
 *      （预留 4 KB 缓冲，严格防范超出 Antigravity 官方单文件 24,000 B 硬截断线）。
 *   2. NO_FAT_POWERSHELL_SCRIPTS: 核验新增或修改的 .ps1 脚本不得包含 > 12 行可执行业务逻辑
 *      （核心逻辑须用 Node.js 放在 scripts/ 下，.ps1 仅允许作参数透传薄入口）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const RULE_FILE_SAFE_BYTES_CAP = 20000;
const ANTIGRAVITY_HARD_CAP = 24000;
const MAX_PS1_THIN_LINES = 12;

function collectRuleFiles() {
  const candidates = [];
  for (const name of ['AGENTS.md', 'GEMINI.md']) {
    const full = path.join(REPO_ROOT, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      candidates.push(name);
    }
  }
  const dirCandidates = [
    path.join(REPO_ROOT, '.agents', 'rules'),
    path.join(REPO_ROOT, 'plugins', 'a8-agent-mind', 'rules'),
  ];
  for (const dir of dirCandidates) {
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        candidates.push(path.relative(REPO_ROOT, path.join(dir, ent.name)).replace(/\\/g, '/'));
      }
    }
  }
  return candidates;
}

function getNewPs1Files() {
  const created = new Set();
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
  for (const cmd of [
    ['ls-files', '--others', '--exclude-standard'],
    ['diff', '--name-only', '--diff-filter=A', 'HEAD'],
    ['diff', '--name-only', '--diff-filter=A', '--cached'],
  ]) {
    for (const ln of runGit(cmd).split(/\r?\n/)) {
      const clean = ln.trim().replace(/\\/g, '/');
      if (clean.toLowerCase().endsWith('.ps1')) created.add(clean);
    }
  }
  return [...created];
}

function countExecutablePsLines(content) {
  let count = 0;
  let inBlockComment = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes('#>')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('<#')) {
      if (!line.includes('#>')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    count += 1;
  }
  return count;
}

function main() {
  const failures = [];
  const ruleFiles = collectRuleFiles();
  for (const rel of ruleFiles) {
    const sizeBytes = fs.statSync(path.join(REPO_ROOT, rel)).size;
    if (sizeBytes > RULE_FILE_SAFE_BYTES_CAP) {
      const pct = ((sizeBytes / ANTIGRAVITY_HARD_CAP) * 100).toFixed(1);
      failures.push(
        `[AGENTS_MD_SIZE_GUARD] ${rel} 物理体积 ${sizeBytes} bytes (占 Antigravity 24KB 红线 ${pct}%)，已超安全上限 ${RULE_FILE_SAFE_BYTES_CAP} bytes；请将明细/历史迁入 docs/INDEX.md 或拆分`
      );
    }
  }

  const newPs1 = getNewPs1Files();
  for (const rel of newPs1) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const execLines = countExecutablePsLines(text);
    const delegatesToNode = /\bnode\b/i.test(text);
    if (execLines > MAX_PS1_THIN_LINES && !delegatesToNode) {
      failures.push(
        `[NO_FAT_POWERSHELL_SCRIPTS] 新建脚本 ${rel} 包含 ${execLines} 行非注释逻辑且未委托给 node；核心逻辑请改用 Node.js (.mjs) 放在 scripts/`
      );
    }
  }

  if (failures.length > 0) {
    console.error(`[FAIL] WORKSPACE_HYGIENE (${failures.length} errors):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `[PASS] WORKSPACE_HYGIENE (${ruleFiles.length} rule/map files <= ${RULE_FILE_SAFE_BYTES_CAP} B, ${newPs1.length} new .ps1 checked, 0 errors)`
  );
}

main();
