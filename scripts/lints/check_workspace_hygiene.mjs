#!/usr/bin/env node
/**
 * 仓库规则体积与脚本选型防线检查 (WORKSPACE_HYGIENE)
 *
 * 检查项：
 *   1. AGENTS_MD_SIZE_GUARD: 核验根目录 AGENTS.md / GEMINI.md、规则文件、插件技能入口
 *      (plugins/<plugin>/skills/<skill>/SKILL.md)、子代理规范 (plugins/<plugin>/agents/<agent>.md)
 *      与插件设计文档 (plugins/<plugin>/design.md) 字节体积不超过 20,000 B
 *      （预留 4 KB 缓冲，严格防范超出 Antigravity 官方单文件 24,000 B 硬截断线）。
 *   2. RULE_ACTIVATION_CONTRACT: 核验 plugins/<plugin>/rules/*.md 与 .agents/rules/*.md 的激活契约——
 *      非 AGENTS.md / GEMINI.md 的规则文件必须包含 YAML frontmatter 且显式声明合法 trigger
 *      （always_on / model_decision / glob / manual），防止误删 trigger: always_on 导致全局规则静默不加载。
 *   3. NO_FAT_POWERSHELL_SCRIPTS: 核验新增或修改的 .ps1 脚本不得包含 > 12 行可执行业务逻辑
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
const ALLOWED_RULE_TRIGGERS = new Set(['always_on', 'model_decision', 'glob', 'manual']);
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isManagedRuleFile(rel) {
  return /^(?:\.agents\/rules\/[^/]+\.md|plugins\/[^/]+\/rules\/[^/]+\.md)$/i.test(rel);
}

export function validateRuleActivation(rel, content) {
  if (!isManagedRuleFile(rel)) return [];
  const baseName = path.posix.basename(rel).toUpperCase();
  const match = FRONTMATTER_RE.exec(content);

  if (baseName === 'AGENTS.MD' || baseName === 'GEMINI.MD') {
    if (match) {
      return [
        `[RULE_ACTIVATION_CONTRACT] ${rel} 为默认常驻的 ${path.posix.basename(rel)}，Antigravity 不支持为其添加 YAML frontmatter，请移除顶部 '---' 块`,
      ];
    }
    return [];
  }

  if (!match) {
    return [
      `[RULE_ACTIVATION_CONTRACT] ${rel} 缺少 YAML frontmatter \`trigger:\` 声明（Antigravity 仅自动注入 rules/AGENTS.md 或带 \`trigger: always_on\` 的规则文件，漏写会导致规则静默不加载）；请在文件首行补充 \`---\\ntrigger: always_on\\n---\``,
    ];
  }

  const fm = match[1];
  const triggerMatch = /^\s*trigger\s*:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m.exec(fm);
  if (!triggerMatch) {
    return [
      `[RULE_ACTIVATION_CONTRACT] ${rel} 的 frontmatter 缺少有效的 \`trigger:\` 字段；合法值为 always_on / model_decision / glob / manual`,
    ];
  }

  const trigger = triggerMatch[1];
  if (!ALLOWED_RULE_TRIGGERS.has(trigger)) {
    return [
      `[RULE_ACTIVATION_CONTRACT] ${rel} 声明了非法 \`trigger: ${trigger}\`；合法值为 always_on / model_decision / glob / manual`,
    ];
  }

  const errors = [];
  if (trigger === 'model_decision' && !/^\s*description\s*:\s*\S+/m.test(fm)) {
    errors.push(`[RULE_ACTIVATION_CONTRACT] ${rel} 使用 trigger: model_decision 时必须提供非空 description 字段`);
  }
  if (trigger === 'glob' && !/^\s*globs\s*:\s*\S+/m.test(fm)) {
    errors.push(`[RULE_ACTIVATION_CONTRACT] ${rel} 使用 trigger: glob 时必须提供非空 globs 字段`);
  }
  return errors;
}

function collectRuleFiles() {
  const candidates = new Set();
  const addFile = (fullPath) => {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      candidates.add(path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/'));
    }
  };
  const addMarkdownDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        addFile(path.join(dirPath, ent.name));
      }
    }
  };

  for (const name of ['AGENTS.md', 'GEMINI.md']) {
    addFile(path.join(REPO_ROOT, name));
  }
  addMarkdownDir(path.join(REPO_ROOT, '.agents', 'rules'));

  const pluginsDir = path.join(REPO_ROOT, 'plugins');
  if (fs.existsSync(pluginsDir)) {
    for (const pluginEnt of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!pluginEnt.isDirectory()) continue;
      const pluginRoot = path.join(pluginsDir, pluginEnt.name);
      addFile(path.join(pluginRoot, 'design.md'));
      addMarkdownDir(path.join(pluginRoot, 'rules'));
      addMarkdownDir(path.join(pluginRoot, 'agents'));
      const skillsDir = path.join(pluginRoot, 'skills');
      if (fs.existsSync(skillsDir)) {
        for (const skillEnt of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!skillEnt.isDirectory()) continue;
          addFile(path.join(skillsDir, skillEnt.name, 'SKILL.md'));
        }
      }
    }
  }
  return [...candidates].sort();
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
  let activationChecked = 0;
  for (const rel of ruleFiles) {
    const fullPath = path.join(REPO_ROOT, rel);
    const sizeBytes = fs.statSync(fullPath).size;
    if (sizeBytes > RULE_FILE_SAFE_BYTES_CAP) {
      const pct = ((sizeBytes / ANTIGRAVITY_HARD_CAP) * 100).toFixed(1);
      failures.push(
        `[AGENTS_MD_SIZE_GUARD] ${rel} 物理体积 ${sizeBytes} bytes (占 Antigravity 24KB 红线 ${pct}%)，已超安全上限 ${RULE_FILE_SAFE_BYTES_CAP} bytes；请将明细/历史迁入 docs/evergreen/ 或拆入 references/`
      );
    }
    if (isManagedRuleFile(rel)) {
      activationChecked += 1;
      const text = fs.readFileSync(fullPath, 'utf8');
      failures.push(...validateRuleActivation(rel, text));
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
    `[PASS] WORKSPACE_HYGIENE (${ruleFiles.length} rule/map files <= ${RULE_FILE_SAFE_BYTES_CAP} B, ${activationChecked} rule activation contracts verified, ${newPs1.length} new .ps1 checked, 0 errors)`
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main();
}
