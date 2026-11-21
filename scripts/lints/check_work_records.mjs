#!/usr/bin/env node
/**
 * 工作记录结构与双层文档卫生检查 (WORK_RECORD_SCHEMA)
 *
 * 依据 plugins/a8-agent-mind/templates/work-record.md 强制校验：
 *   1. docs/ 下仅允许 evergreen / records / deferred 目录与共享术语表 glossary.md（<= 20,000 B），严禁其他游离或已废弃文档（含 INDEX.md）；
 *   2. docs/records/*.md 命名符合 YYYYMMDD-(SPEC|ADR|BUG)-*.md，且首行标题规范；
 *   3. 固定 4 项元数据头（日期 / 状态 / 域 / 取代）完整且状态属于 5 枚举之一；
 *   4. 状态为 已废弃 / 部分失效 时，必须在 ## 1. 之前包含醒目失效横幅；
 *   5. 正文包含 4 段固定骨架（问题与目标 / 核心设计与结论 / 当时验证范围 / 对常青文档的影响）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ID = 'WORK_RECORD_SCHEMA';

const RECORD_FILE_RE = /^\d{8}-(SPEC|ADR|BUG)-.+\.md$/;
const TITLE_RE = /^#\s+(SPEC|ADR|BUG)：.+$/;
const DATE_RE = /^- \*\*日期\*\*：\d{4}-\d{2}-\d{2}$/;
const ALLOWED_STATUS_PREFIXES = [
  '进行中',
  '已落地（当时有效）',
  '部分失效（',
  '已废弃（',
  '已暂缓',
];
const REQUIRED_SECTIONS = [
  '## 1. 问题与目标',
  '## 2. 核心设计与结论',
  '## 3. 当时验证范围',
  '## 4. 对常青文档的影响',
];

const ALLOWED_ROOT_DOCS = new Set(['glossary.md']);
const GLOSSARY_MAX_BYTES = 20_000;

function checkDocsDirectoryLayout(docsRoot, failures) {
  for (const ent of fs.readdirSync(docsRoot, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!['evergreen', 'records', 'deferred'].includes(ent.name)) {
        failures.push(`docs/${ent.name}/ 不属于规范双层目录 (evergreen / records / deferred)`);
      }
      continue;
    }
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      if (ALLOWED_ROOT_DOCS.has(ent.name.toLowerCase())) {
        const size = fs.statSync(path.join(docsRoot, ent.name)).size;
        if (size > GLOSSARY_MAX_BYTES) {
          failures.push(`docs/${ent.name} 体积 ${size} B 超过 ${GLOSSARY_MAX_BYTES} B 上限，请精简释义防上下文截断`);
        }
        continue;
      }
      failures.push(`docs/${ent.name} 为游离或已废弃文档，请移除或归入 evergreen/、records/、deferred/（docs/ 根目录仅允许共享术语表 glossary.md）`);
    }
  }
}

function validateRecordFile(fileName, fullPath, failures) {
  const rel = `docs/records/${fileName}`;
  if (!RECORD_FILE_RE.test(fileName)) {
    failures.push(`${rel}: 文件名须符合 YYYYMMDD-(SPEC|ADR|BUG)-<主题>.md`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const firstNonEmpty = lines.find((ln) => ln.trim().length > 0)?.trim() || '';
  if (!TITLE_RE.test(firstNonEmpty)) {
    failures.push(`${rel}: 首行须符合 "# SPEC：..." / "# ADR：..." / "# BUG：..."`);
  }

  const headLines = lines.slice(0, 15).map((ln) => ln.trim());
  if (!headLines.some((ln) => DATE_RE.test(ln))) {
    failures.push(`${rel}: 头部缺少标准字段 "- **日期**：YYYY-MM-DD"`);
  }

  const statusLine = headLines.find((ln) => ln.startsWith('- **状态**：'));
  let statusVal = '';
  if (!statusLine) {
    failures.push(`${rel}: 头部缺少标准字段 "- **状态**：..."`);
  } else {
    statusVal = statusLine.slice('- **状态**：'.length).trim();
    if (!ALLOWED_STATUS_PREFIXES.some((prefix) => statusVal.startsWith(prefix))) {
      failures.push(`${rel}: 非法状态 "${statusVal}"，必须以 ${ALLOWED_STATUS_PREFIXES.join(' / ')} 之一开头`);
    }
  }

  for (const field of ['- **域**：', '- **取代**：']) {
    const found = headLines.find((ln) => ln.startsWith(field));
    if (!found || !found.slice(field.length).trim()) {
      failures.push(`${rel}: 头部缺少标准字段 "${field}..."`);
    }
  }

  const sec1Idx = lines.findIndex((ln) => ln.trim() === REQUIRED_SECTIONS[0]);
  const headTextBeforeSec1 = (sec1Idx >= 0 ? lines.slice(0, sec1Idx) : lines.slice(0, 25)).join('\n');
  if (statusVal.startsWith('已废弃（')) {
    if (!headTextBeforeSec1.includes('> **[已失效')) {
      failures.push(`${rel}: 状态为已废弃，必须在 ## 1. 之前包含 "> **[已失效..." 横幅声明`);
    }
  } else if (statusVal.startsWith('部分失效（')) {
    if (!headTextBeforeSec1.includes('> **[部分失效')) {
      failures.push(`${rel}: 状态为部分失效，必须在 ## 1. 之前包含 "> **[部分失效..." 横幅声明`);
    }
  }

  let prevIdx = -1;
  for (const sec of REQUIRED_SECTIONS) {
    const idx = lines.findIndex((ln) => ln.trim() === sec);
    if (idx < 0) {
      failures.push(`${rel}: 缺少标准章节 "${sec}"`);
    } else if (idx <= prevIdx) {
      failures.push(`${rel}: 章节顺序错乱 "${sec}"`);
    } else {
      prevIdx = idx;
    }
  }
}

function main() {
  const docsRoot = path.join(REPO_ROOT, 'docs');
  const evergreenDir = path.join(docsRoot, 'evergreen');
  const recordsDir = path.join(docsRoot, 'records');
  const failures = [];

  if (!fs.existsSync(docsRoot)) {
    failures.push('缺少 docs/ 目录');
  } else {
    checkDocsDirectoryLayout(docsRoot, failures);
  }

  let checkedCount = 0;

  if (fs.existsSync(evergreenDir)) {
    for (const name of fs.readdirSync(evergreenDir).sort()) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      checkedCount += 1;
    }
  }

  if (fs.existsSync(recordsDir)) {
    for (const name of fs.readdirSync(recordsDir).sort()) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      checkedCount += 1;
      validateRecordFile(name, path.join(recordsDir, name), failures);
    }
  }

  if (failures.length > 0) {
    console.error(`[FAIL] [${CHECK_ID}] 发现 ${failures.length} 处工作记录与文档结构违规：`);
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  console.log(`[PASS] ${CHECK_ID} (${checkedCount} docs verified)`);
}

main();
