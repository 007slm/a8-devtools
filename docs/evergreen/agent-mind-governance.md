# A8 Agent Mind 插件与双层文档治理架构

> 全局心智治理插件（`/a8-prompt`、`a8-workflow`、`/a8-brain`、`/a8-commit`、轻量确定性 `Stop` Lint Hook、Decisions API + `arch-judge`、每晚 20:00 `scan_docs_sync.mjs` / `docs-sync`、`docs/verify.md` 与仓库门禁）的架构真相；导览见 [AI-研发工作流可视化指南.html](AI-研发工作流可视化指南.html)，术语见 [项目术语表](../glossary.md)，溯源见 [Decisions API 裁判设计](../records/20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md)、[双层文档闭环 ADR](../records/20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md)、[吸收 pstack 工作流与验证地图 ADR](../records/20261122-ADR-插件与治理-吸收pstack工作流体系与独立验证地图契约设计.md)、[卸载 Stop Hook 并收归 `/a8-commit` 门禁 ADR](../records/20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md)、[提示词与 Lint 双线解耦及轻量确定性 Stop Hook ADR](../records/20261125-ADR-插件与治理-提示词与Lint双线解耦及轻量确定性StopHook设计.md) 及 [`plugins/a8-agent-mind/design.md`](../../plugins/a8-agent-mind/design.md)。

---

## 1. 核心红线与有意权衡（裁判防误报必读）

- **治理三线分离总原则（Rule / Lint / Decision 严格分层）**：
  1. **Rule（`mind-rules.md` / `.agents/rules/`）写提示词**：只写给模型看的规范要求与行为标准，**严禁**把具体 Lint 脚本路径或检查实现细节写进常驻提示词（避免模型干活前翻阅 Lint 源码“背考点”）；
  2. **Lint（`<repo>/scripts/lints/`）在会话 `Stop` 后做机械检查**：由插件极轻本地确定性 `Stop` Hook（`hooks.json` → `hooks/stop_lint.py`，0 Token、不调 LLM、纯问答/无改动秒放行、`continuationActive` 防死循环）在每轮修改停步后自动执行，违规直接回传报错与改法，`/a8-commit` Step 2 兜底复核；
  3. **Decision（`*.decision.json` + `arch-judge`）在 `commit` 之前做判定**：平时严禁 AI 自动调用 `a8-judge` / `arch-judge`，仅在默认 `/a8-commit`（非 `fast`）Step 3 或用户显式 `/a8-judge` 时做跨文件架构语义裁决；`fast` 仅跳过 Step 3 语义审查，敏文件拦截与仓内门禁仍强检且严禁 AI 擅自启用。
- **仅审后端架构面 + 紧凑红线摘要注入**：`judge_router.py`（`_is_relevant_source_file` / `_fold_deleted_file_block` / `load_documented_decisions_context`）跳过前端 UI（`.tsx`/`.jsx`/`.vue`/`.css`/`web/src/*.ts`）、`.html` 可视化页与纯 `.md` 文档，整文件删除折叠为 1 行墓碑；送审 Decisions API 时仅注入命中常青文档的「红线/权衡/边界/非目标」摘要（`max_chars=2400`、`per_doc_chars=700`、候选 `limit=5` 最多取 3 篇，排除 `verify.md`/`glossary.md`），通读全文与调用链交由第 3 段 `arch-judge`。
- **非 Git 目录与驱动器根显式警示**：无 `.git` 或驱动器根（如 `C:\`）由 DevTools / Sidecar UI 的 `has_git` 显式警示并跳过 Diff 审核与 `/a8-commit`，不做启发式扫盘。
- **Agent 与 Rule frontmatter 强制契约**：`plugins/*/agents/*.md` 必须显式声明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`（防止被静默降级为只读 9 工具集）；`plugins/*/rules/*.md` 与 `.agents/rules/*.md` 中非 `AGENTS.md`/`GEMINI.md` 的规则文件必须显式声明合法 YAML frontmatter `trigger:`（如 `trigger: always_on`），否则 Antigravity 会静默跳过注入（见 [全局 Mind 规则失效复盘](../records/20261124-BUG-插件与治理-全局Mind规则丢失always_on失效与工作记录门禁补强.md)）。
- **3 大高耗 Token 动作禁自动触发**：浏览器 UI 自动化（`/a8-ui-verify`）、多方案交叉对比/独立对抗子代理、重型端到端反复跑测与多轮 A/B 压测循环，仅用户显式点名时启用；日常以轻量编译与局部单测为主（静态 Lint 由 `Stop` Hook 自动兜底）。
- **可逆先干与连败 2 次熔断**：路线对齐且可逆时直接完成并附 `[实测]` / `[推断]` / `[待确认]` 汇报；同一前提连续 2 次修同一门禁失败必须停笔写前提并做实验证伪，严禁第 3 次盲补（`mind-rules.md` 第四节）。

---

## 2. 5 级防线阶梯与对称双域存储

防线沉淀遵循 **架构消除 > 编译器类型约束 > 带改法提示的静态 Lint（`scripts/lints/*.mjs|*.py`） > 语义 Decision（`*.decision.json`）/ 行为单测 > 自然语言 Rule（`mind-rules.md` / `.agents/rules/redline.md`）**；插件包 `plugin.json` 当前版本为 `1.5.0`：

| 层级（三线职责） | 全局通用存放位置 | 单仓专属存放位置 | 触发时机与执行方式 |
| :--- | :--- | :--- | :--- |
| **Rule（提示词规范）** | `plugins/a8-agent-mind/rules/mind-rules.md`（`< 20 KB`）、`TOKENS.md`（`< 1 KB`） | `<repo>/.agents/rules/redline.md` | 随会话注入模型上下文（仅写规范要求，禁泄 Lint 脚本路径，均 `<= 20,000 B`） |
| **Lint（机械检查）** | `plugins/a8-agent-mind/hooks/stop_lint.py` + `scripts/run_repo_lints.py` | `<repo>/scripts/lints/*.mjs\|*.py` | **会话 `Stop` 后**自动静默执行（0 Token，违规回灌改法）+ `/a8-commit` Step 2 兜底 |
| **Decision（语义判定）** | `plugins/a8-agent-mind/decisions/*.decision.json`（4 个正交维度） | `<repo>/scripts/lints/*.decision.json` | **`commit` 之前**（`/a8-commit` Step 3）经 `decisions_client.py` + 按需 `arch-judge` 判定 |

---

## 3. 4 个核心裁决维度与 `judge_router.py` 文档路由

- **4 个正交核心维度**：`lifecycle_and_evolution`（全生命周期不变量与零擅自向后兼容）、`topology_and_boundaries`（单向分层与隔离）、`concurrency_and_performance`（热路径性能与资源守恒）、`implementation_hygiene`（单一路径、直白命名禁生僻状态词、平实文档与术语表自律、错误第一现场保留）。
- **变更指针与无损分片**：
  - `judge_router.py` 解析根目录 `AGENTS.md` 中的 **4 / 5 / 6+ 列**常青索引表，生成 `activated_categories`、`relevant_docs` 与摘要上下文；
  - `decisions_client.py` 按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 44000`、`BATCH_QUESTION_CHARS = 24000`、`BATCH_MAX_QUESTIONS = 16`、`MAX_CONCURRENT_API_CALLS = 4`），4 个核心维度合入单次请求避免重复发送 Diff 与上下文；脚本参数路由统一见 `plugins/a8-agent-mind/readme.md`。
- **子代理契约**：`arch-judge`、`dsh-reviewer`、`docs-sync` 的 frontmatter 均由 `scripts/lints/check_plugin_agents.py` 强制守卫。

---

## 4. 提交前强制闸门与快慢双轨文档治理（`/a8-commit` + 夜间 20:00 梳理）

- **四类文档与暂缓区（职责纯洁、禁混写）**：
  - `docs/glossary.md` & `docs/verify.md`（`VERIFY`）—— **`docs/` 根目录唯二合法单文件（均 `<= 20,000 B`）**：`glossary.md` 定义全仓专有概念普通话含义（未入表概念二选一入表或正文直白解释）；`verify.md` 只写验证路由、真实表面执行卡、本地盲区与基准防伪（禁长篇架构说教）；
  - `docs/evergreen/<domain>.md`（常青文档，高频主读）：只收跨文件边界、状态机/不变量、共享契约、生死阈值与 Fail-Closed/有意权衡，硬红线前置，减法原地覆盖，禁源码复述/流水账/未落地设想；常规 `2~6 KB`、核心域 `6~12 KB`（严控 `< 18,500 B` 防预警、`<= 20,000 B` 防截断）；
  - `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`（工作记录）：仅触及架构权衡/契约变更/深层根因时按 [`templates/work-record.md`](../../plugins/a8-agent-mind/templates/work-record.md) 写入（`<TYPE>` 仅 `SPEC`/`ADR`/`BUG`，首行 `# <TYPE>：<主题>`，前 15 行 4 项元数据头 + 5 枚举状态 + 4 段固定骨架；`ADR` 必写制约+否决备选+重评条件，`## 3` 区分已测与未覆盖边界）；
  - `docs/deferred/*.md`（暂缓区）：隔离存放未落地或暂停设想。
- **渐进式回链与双向标废**：常青文档在头部或对应条文旁挂带触发条件的 `../records/YYYYMMDD-....md` 相对链接；旧记录被推翻或部分取代时禁删改历史正文，仅更新 `- **状态**：`（`已废弃（被 ... 取代）` / `部分失效（被 ... 更新）`）并在 `取代` 与 `---` 间插入 `> **[已失效 / 已被取代（YYYY-MM-DD）]**` 或 `> **[部分失效（YYYY-MM-DD）]**` 横幅；**状态为 `进行中` 的工作记录严禁自动化改写或加横幅**。

```text
【日间多轮开发】极轻本地确定性 Stop Hook（hooks/stop_lint.py，0 Token、不调 LLM）
编码 / 排障 / 验绿 / 顺手轻更 docs/ -> 回合结束自动跑 scripts/lints/（纯问答/无改动/全绿静默放行；违规回传报错与改法，continuationActive 防死循环）

【落库关口】/a8-commit [fast] [nopush|onlycommit]
  ├─► Step 1 盘点与硬拦截：git status -uall 拦敏感文件 (*.key/.env/secret/logs) 与无关在途改动
  ├─► Step 2 确定性门禁：目标仓编译、基础单测与 scripts/lints/
  ├─► Step 3 三段红线审查（仅显式 fast 跳过）：judge_router.py -> decisions_client.py -> 按需 arch-judge（VIOLATED 阻断）
  ├─► Step 4 文档收口：更新 docs/evergreen/ 不等于免写 docs/records/；命中架构/契约/状态机/深层根因或 >=5 生产文件时必须当前上下文补写记录并轻更常青（禁起 docs-sync）
  └─► Step 5~6 原子拆分 + 中文两档模板（无 AI 署名）+ commit/push + scan_docs_sync --mark-done

【夜间慢轨】nightly-evergreen-docs-sync (CRON_TZ=Asia/Shanghai 0 20 * * *)
  ├─► templates/nightly-evergreen-docs-sync.sidecar.json 授权文档写权 + 只读 git + 门禁命令
  ├─► node scan_docs_sync.mjs 动态扫 repos.md（跳过 test-bed 与无新增提交/未提交变更/体检全绿仓，水位落 plugin_data/nightly_docs_sync_state.json）
  └─► 仅对 needs_review=true 仓按 docs-sync 规范核验源码（含 .qnt 模型漂移）-> 更新常青/地图/术语表/AGENTS、修断链、标废旧记录（禁改源码与进行中记录、禁 git commit）-> 门禁全绿后 --mark-done
```

---

## 5. 10 大技能、DSH 终审、经验复盘与本仓机械门禁

- **10 大核心技能（2 自动内功 + 8 手动大招）**：自动内功 `a8-workflow`（`SKILL.md` + 5 份精简场景指南 `analyze`/`bug-fix`/`perf`/`feature`/`long-task` + `references/pstack-source-map.md`，改编自 `pstack v0.15.48` MIT；1～2 行小改免开）、`a8-ui-design`；手动大招包括事前 `/a8-prompt`（严禁改码，答专家 4 问重写即停）与 `/a8-brain`（个人 LLM Wiki 知识大脑与概念定名重构，纯手动零日常开销）、事中 `/a8-judge`（平时不自动触发）、`/a8-dsh-review` 与 `/a8-ui-verify`（脚本落 `scripts/tests/ui-verify/`、产物落 `logs/ui-verify/`）、事后 `/a8-trace`（7 列 TSV 账本落 `logs/trace-*.tsv` + 防公式注入）、`/a8-commit` 与 `/a8-improve`。
- **DSH 深度终审（`/a8-dsh-review` · `dsh-reviewer` + `review.ps1`）**：默认 `ReasoningEffort = medium`，需求锚定先行（传原始需求与 Non-Goals，依赖 DSH 原生 `@deepseek-ai/dsh-agent-instructions` 加载 `AGENTS.md` 不重复搬运）；仅真实 Bug ($F \times S \ge 10$) 或破损需求可阻断，无缺陷直给 `PASSED`；`Round 1` 启干净新会话、`Round >= 2` 复用会话并冻结战线（硬上限 3 轮、分歧早停交人）；`ProcessStartInfo` 分离 `stdout`/`stderr`，归档至 `reviews/<repoSlug>/`（已 `.gitignore`）。
- **经验精炼（`/a8-improve`）**：主会话零子代理执行五维纠偏提取（含 6 个月保质期；**仅当本会话已总结出候选项时**抽查最近 3～5 个历史会话佐证，无候选直报零新增）、5 级防线阶梯与规则-强制器配对体检，并按需加载 `references/card-and-eval.md` 生成 `improve_card.html` 提案、6 节确认清单与破坏抓虫正反实证门（`SKILL.md` 与 `design.md` 均通过脚本路径路由解耦，严控 `< 20,000 B`）。
- **Harness 可观测与上下文预算**：`decisions_client.py` 原子写入 `harness_metrics.jsonl`（分池保留 200 条 Hook + 1000 条检查器记录，驱动「可观测」14 日趋势与长期零违规清理提醒）；`TOKENS.md`（`< 1 KB`）固化 5 条上下文节流规则。
- **本仓 `scripts/lints/` 机械门禁矩阵（4 项核心门禁）**：
  - `check_swallowed_exceptions.mjs`：拦截空 `catch`、仅打日志吞异常与无意义原样 `throw e`；
  - `check_workspace_hygiene.mjs`：守卫 `AGENTS.md` / `GEMINI.md`、规则、`plugins/*/skills/*/SKILL.md`、`agents/*.md` 与 `design.md` 均 `<= 20,000 B`（防 `24,000 B` 截断），校验 `plugins/*/rules/*.md` 与 `.agents/rules/*.md` 的激活契约（`RULE_ACTIVATION_CONTRACT`，非 `AGENTS.md`/`GEMINI.md` 必含合法 `trigger:` frontmatter），并禁建 `> 12` 行未委托 Node 的 `.ps1`；
  - `check_plugin_agents.py`：守卫 `plugins/*/agents/*.md` 显式 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`；
  - `check_work_records.mjs`（`WORK_RECORD_SCHEMA`）：依据 `templates/work-record.md` 校验 `docs/` 仅含 `evergreen`/`records`/`deferred` 目录与唯二共享根文档 `glossary.md`/`verify.md`（均 `<= 20,000 B`，禁游离文档与 `INDEX.md`）、记录命名、标题、元数据头、失效横幅与 4 段骨架顺序。

---

## 6. 非目标与重新评估条件

- **非目标（当前有意不做）**：不安装 `pstack` 原插件或暴露 58+ 碎片技能，不引入硬编码模型名、云 PR 堆叠或公网 Webhook；不在 `docs/evergreen/*.md` 中混写实机验证命令（统一入 `docs/verify.md`，不拆 `docs/verify/`），也不用一行式过时清单表替代 `docs/records/`；不在 `Stop` Hook 中调用任何 LLM / Decisions API 语义裁判，且严禁 AI 擅自启用 `/a8-commit fast`；不把常规局部 Bug 批量写成独立 `*.decision.json`。
- **重新评估条件**：
  1. 当单仓 `docs/verify.md` 或单个常青域逼近 `18,000 B` 难再压缩时，再按子系统横向拆分（保留 `docs/verify.md` 作总路由索引）；
  2. 若未来需要支持非 Git 仓库自动文档守护，再评估轻量人工触发巡检命令。
