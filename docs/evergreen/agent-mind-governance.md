# A8 Agent Mind 插件与双层文档治理架构

> 全局心智治理插件（`/a8-prompt` 事前深化、`a8-workflow` 工作流、`/a8-commit` 提交前强制红线与文档总闸门、Decisions API + `arch-judge` 语义裁判、每晚 20:00 `scan_docs_sync.mjs` / `docs-sync` 常青梳理、根级 `docs/verify.md` 与本仓机械门禁）的架构真相；全景导览见 [AI-研发工作流可视化指南.html](AI-研发工作流可视化指南.html)，术语见 [项目术语表](../glossary.md)，溯源见 [Decisions API 裁判设计](../records/20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md)、[双层文档闭环 ADR](../records/20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md)、[吸收 pstack 工作流与验证地图 ADR](../records/20261122-ADR-插件与治理-吸收pstack工作流体系与独立验证地图契约设计.md)、[卸载 Stop Hook 并收归 `/a8-commit` 门禁 ADR](../records/20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md) 及 [`plugins/a8-agent-mind/design.md`](../../plugins/a8-agent-mind/design.md)。

---

## 1. 核心红线与有意权衡（裁判防误报必读）

- **仅审后端架构面 + 精简红线摘要注入（Decisions API 初筛 vs `arch-judge` 全文深审）**：`judge_router.py`（`_is_relevant_source_file` / `_fold_deleted_file_block` / `load_documented_decisions_context`）将前端 UI（`.tsx`/`.jsx`/`.vue`/`.css`/前端 `web/src/*.ts`）、`.html` 可视化页与纯 `.md` 文档排除在后端 Decisions API 审查外，整文件删除折叠为 1 行墓碑摘要，并为 Decisions API 初筛仅注入命中常青文档的「红线/权衡/边界/非目标」紧凑摘要（`max_chars=2400`、`per_doc_chars=700`、`limit=3`，自动排除 `verify.md`/`glossary.md`）；需要通读常青全文与源码调用链的职责留在第 3 段 `arch-judge`；
- **非 Git 目录与驱动器根显式警示**：无 `.git` 目录或驱动器根目录（如 `C:\`）由 DevTools / Sidecar UI 层的 `has_git` 显式警示，跳过 Git Diff 代码审核与 `/a8-commit` 提交门禁，不做非 Git 启发式扫盘；
- **提交前强制闸门 + 开发期零打扰**：日常编码不设回合级 `Stop` Hook，单点局部修改免高频增量复核；默认 `/a8-commit` 提交前**强制**跑完三段红线审查，告警/异常或命中高危架构面必派发 `arch-judge`（仅用户显式传 `fast` 可跳过第 3 步语义审查，敏文件拦截与仓内门禁仍强检，严禁 AI 擅自启用）；
- **Agent frontmatter 三项必填声明**：`plugins/*/agents/*.md` 必须显式写明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，防止运行时静默降级为只读 9 工具集；
- **3 大高耗 Token 动作严禁自动触发**：浏览器 UI 自动化（`/a8-ui-verify`）、多方案交叉实现对比/独立对抗子代理、重型端到端反复跑测与多轮 A/B 压测循环，仅在用户显式点名时启用；日常开发以轻量编译、局部单测与 `scripts/lints/` 为主；
- **可逆先干与连续失败 2 次熔断**：路线已对齐且操作可逆时直接完成并附 `[实测]` / `[推断]` / `[待确认]` 汇报；同一前提连续 2 次修同一门禁失败必须停笔写前提并做实验证伪，严禁第 3 次盲补（`mind-rules.md` 第四节）。

---

## 2. 5 级防线阶梯与对称双域存储

防线沉淀遵循 **架构消除 > 编译器类型约束 > 带改法提示的静态 Lint（`scripts/lints/*.mjs|*.py`） > 语义 Decision（`*.decision.json`）/ 行为单测 > 自然语言 Rule（`mind-rules.md` / `.agents/rules/redline.md`）**；插件包 `plugin.json` 当前版本为 `1.4.0`：

| 层级 | 全局通用存放位置 | 单仓专属存放位置 | 执行方式 |
| :--- | :--- | :--- | :--- |
| 确定性 Lint | 随仓分发示例 / 插件脚本 | `<repo>/scripts/lints/*.mjs\|*.py` | 提交前全自动确定性校验（零误报优先） |
| 语义 Decision | `plugins/a8-agent-mind/decisions/*.decision.json`（4 个互不重叠核心维度） | `<repo>/scripts/lints/*.decision.json` | `decisions_client.py` 无损分片送审 `gemini-decision-1` |
| 自然语言 Rule | `plugins/a8-agent-mind/rules/mind-rules.md`（`<= 18,500 B`）、`TOKENS.md`（`< 1 KB`） | `<repo>/.agents/rules/redline.md` | 随 Antigravity 会话注入上下文（均严控 `<= 20,000 B`） |

---

## 3. 4 个核心裁决维度与 `judge_router.py` 文档路由

- **4 个互不重叠的核心维度**：`lifecycle_and_evolution`（全生命周期不变量与零擅自向后兼容）、`topology_and_boundaries`（单向分层与隔离）、`concurrency_and_performance`（热路径性能与资源守恒）、`implementation_hygiene`（单一路径、直白简单命名禁生僻状态词、平实文档与术语表自律、错误第一现场保留）。
- **变更指针与文档路由（`judge_router.py`）**：
  - 提取 Git Diff 元特征，过滤构建产物/锁文件/二进制/静态资产与非后端文件（前端 UI 代码、`.html`/`.css`、纯 `.md` 文档），整文件删除折叠为 1 行墓碑；
  - `_parse_agents_doc_registry` 兼容解析根目录 `AGENTS.md` 中的 **4 / 5 / 6+ 列**常青索引表，经 `get_relevant_docs_for_files` 与 `load_documented_decisions_context`（`max_chars=2400`，排除 `verify.md`/`glossary.md`）向 Decisions API 注入精简红线/权衡摘要，`arch-judge` 升级终审时按 `relevant_docs` 自主读取常青全文；
  - `decisions_client.py` 按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 44000`、`BATCH_QUESTION_CHARS = 24000`、`BATCH_MAX_QUESTIONS = 16`、`MAX_CONCURRENT_API_CALLS = 4`），4 个核心维度合入单次请求避免多 batch 重复发送 Diff 与文档上下文。
- **触发纪律与 Subagent 契约**：
  - 日常编码、排障与任务交卷前**严禁 AI 自动触发 `a8-judge` / `arch-judge`**；仅在两条显式入口运行：① 用户执行默认 `/a8-commit`（非 `fast`）的 Step 3；② 用户手动输入 `/a8-judge`；
  - `plugins/*/agents/*.md`（`arch-judge`、`dsh-reviewer`、`docs-sync`）frontmatter **必须**显式包含 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`（由 `scripts/lints/check_plugin_agents.py` 强制守卫），否则会被运行时静默降级为 9 工具只读集。

---

## 4. 提交前强制质量闸门与快慢双轨文档治理（`/a8-commit` + 夜间 20:00 全量梳理）

- **四类文档职责与暂缓区（禁混写）**：
  - `docs/glossary.md`（共享术语表）& `docs/verify.md`（验证地图，`VERIFY`）—— **`docs/` 根目录唯二合法单文件（均 `<= 20,000 B`）**：`glossary.md` 由 `AGENTS.md`、常青文档与工作记录共用（不在表中的非通用概念二选一：补入表内并用普通话讲清，或正文直写普通话，禁自造黑话）；`verify.md` 只写改动模块验证路由、真实表面执行卡、本地盲区与基准防伪规范（禁混入长篇架构说教）；
  - `docs/evergreen/<domain>.md`（常青文档 — **高频主读、短小精悍**）：严守 5 条准入（跨文件边界、状态机/不变量、共享 Schema/契约、关键链路/阈值、Fail-Closed 与有意权衡/重评条件）与 4 条禁入（禁源码复述/流水账/代码穷举/未落地设想），硬红线前置，常规域 `2~6 KB`、核心域 `6~12 KB`（严禁 `> 20,000 B`）；
  - `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`（工作记录 — **轻量复检溯源**）：仅触及架构权衡/契约变更/深层根因时按 [`templates/work-record.md`](../../plugins/a8-agent-mind/templates/work-record.md) 写入（常规小改走单测与注释）；每节 2～4 条要点，禁代码流水账，`ADR` 必写制约+否决备选+重评条件，`## 3` 标明已验证与未覆盖边界：`<TYPE>` 仅 `SPEC`/`ADR`/`BUG`，首行 `# <TYPE>：<主题>`；4 项头部元数据（`日期`/`状态`/`域`/`取代`）+ 5 枚举状态 + 4 段固定骨架；
  - `docs/deferred/*.md`（暂缓区）：隔离存放未落地或暂停设想，禁混入常青文档。
- **渐进式披露与双向标废契约（无损回链，不删改历史正文）**：
  - `docs/records/` 完整保留历史证据；常青文档在头部或对应章节挂载 `../records/YYYYMMDD-....md` 相对链接（多坑域标明触发阅读条件），禁以一行式过时清单表替代原记录；
  - 新记录（核对 `- **取代**：`）或源码演进推翻/部分取代旧记录时，严禁篡改旧记录历史正文，仅将旧记录 `- **状态**：` 更新为 `已废弃（被 ... 取代）` 或 `部分失效（被 ... 更新）`，并在 `取代` 与 `---` 之间插入 `> **[已失效 / 已被取代（YYYY-MM-DD）]**` 或 `> **[部分失效（YYYY-MM-DD）]**` 横幅；**状态为 `进行中` 的工作记录严禁自动化改写或加横幅**。

```text
【日间多轮开发：彻底卸载 Stop Hook，零回合级拦截与隐藏 API 开销】
编码 / 排障 / 验绿 / 顺手轻更 docs/ -> 全程静默零打扰（经验沉淀完全由用户按需调用 /a8-improve）

【落库关口：/a8-commit 6 步提交前质量闸门（默认全量强检；显式 fast 仅跳过 Step 3 语义审查）】
用户发起 /a8-commit [fast] [nopush|onlycommit]
    ├─► Step 1 盘点与硬拦截：git status -uall 拦敏感文件 (*.key/.env/secret/logs) 与无关在途改动
    ├─► Step 2 确定性门禁：跑通目标仓编译、基础单测与 scripts/lints/
    ├─► Step 3 强制三段红线审查（仅用户显式传 fast 跳过）：judge_router.py (0 Token 路由) -> 激活即跑 decisions_client.py (Decisions API)
    │                         -> 告警/异常或高危架构面必跑 arch-judge 语义终审（VIOLATED 强制阻断提交）
    ├─► Step 4 文档收口：触及架构/契约/状态机/验证面且未维护 docs/ 时当前上下文补写记录并轻更常青（禁起 docs-sync）
    └─► Step 5~6 原子拆分 + 中文两档模板（绝对无 AI 署名）+ commit/push + scan_docs_sync --mark-done

【夜间慢轨：每晚 20:00 定时任务 / 手工 docs-sync 全量深度梳理】
nightly-evergreen-docs-sync (CRON_TZ=Asia/Shanghai 0 20 * * *)
    ├─► node scan_docs_sync.mjs 动态扫 repos.md（跳过 test-bed 与无新增提交/未提交变更/体检全绿仓）
    └─► 仅对 needs_review=true 的仓库按 docs-sync 规范核验真实源码 -> 补齐常青/地图/术语表/AGENTS、修断链、标废旧记录（禁改源码/测试/进行中记录、禁 git commit）-> 跑通门禁后 --mark-done
```

- **核心治理边界与回链**（详见 [卸载 Stop Hook 并收归 `/a8-commit` 门禁 ADR](../records/20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md)）：
  1. **彻底移除 `PreInvocation + Stop` Hook**：物理删除 `hooks.json`、`hooks/stop_reflect.py` 与 `scripts/lints/check_stop_hook_invariants.py`，不留僵尸分支；DevTools / Sidecar 界面层仍保留 `has_git` 检查提示「无 Git」并兼容读取历史 `harness_metrics.jsonl` 遥测记录；
  2. **提交前检查强制闭环（支持显式 `fast`）**：`/a8-commit` 严格仅由用户主动触发（日常绝不自动 commit/push）；默认**强制执行**全部前置门禁与三段式红线审查，仅当用户显式传 `fast` / `--fast` 时跳过 Step 3 语义红线审查（Step 1 敏文件拦截与 Step 2 仓内门禁仍强检，严禁 AI 擅自启用）；
  3. **夜间慢轨 (`scan_docs_sync.mjs` + `agents/docs-sync.md`)**：定时配置存于 `templates/nightly-evergreen-docs-sync.sidecar.json`（仅授予文档目录写权限与只读 `git status/diff/log` + 门禁命令），水位落于 `%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\nightly_docs_sync_state.json`。夜间梳理与手工 `docs-sync` 均遵守 **真实源码/测试 > 工作记录 > 旧文档**，第 2 步核查 `.qnt` 等形式化模型漂移，严禁修改源码或 `进行中` 记录、严禁 `git commit/push`。

---

## 5. `a8-workflow` 工作流、DSH 终审、经验复盘与本仓机械门禁

- **10 大核心技能与精简研发主线（严控 2 自动内功 + 8 手动大招）**：技能层固定为 **2 个自动内功**（`a8-workflow`、`a8-ui-design`）+ **8 个手动大招**（事前 `/a8-prompt` & `/a8-brain`［个人 LLM Wiki 头脑风暴/概念定名重构/整理/体检，纯手动触发零日常开销］ → 事中 `/a8-judge`、`/a8-dsh-review` & `/a8-ui-verify` → 事后 `/a8-trace`、`/a8-commit` & `/a8-improve`；其中 `/a8-judge` 平时不自动触发，同时作为默认 `/a8-commit` Step 3 引擎）。`/a8-prompt`（`skills/a8-prompt/`）严禁改码，答专家 4 问并改写“做深不做大”Prompt 即停；`/a8-trace`（`skills/a8-trace/`）面向日常开发交付审阅，将设计分叉、被否备选、试错回退、真实证据与未覆盖风险输出为 7 列 TSV 账本（`logs/trace-*.tsv`，防公式注入）与对话内嵌审阅表 + `Attention` 风险关注点；`/a8-commit`（`skills/a8-commit/`）严格由用户主动触发（日常绝不自动 commit/push），默认提交前强制跑完敏文件拦截、确定性门禁、三段红线审查与重大变更文档收口（支持 `fast` 仅跳过语义审查、`nopush`/`onlycommit` 仅本地提交，无 AI 署名、默认 push）；`a8-workflow` 瘦身只留日常研发主线核心（`SKILL.md` + 5 份精简场景指南 + 来源映射 `references/pstack-source-map.md`，改编自 `pstack v0.15.48` MIT），1～2 行小改免开：
  - `SKILL.md`：接单 3 条对齐、5 场景路由表、4 条通用纪律（`[实测/推断/待确认]`、先查 `docs/verify.md`、3 大高耗 Token 动作严禁自动触发、小步验绿与上下文节流）及 4 步 A8 收口（`<= 40` 行简报，长日志放 `logs/`）；
  - 5 份精简指南：`guides/analyze.md`（严格只读：调用链渐进图解、Git 历史核对、爆炸半径盲区与 5 级确信度、活进程剖析）；`bug-fix.md`（查已有修复、最轻量真实复现 1 次坐实、二分根治与连败 2 次证伪、仅后端务实 TDD）；`perf.md`（基线与剖析分离、7 阶梯、多轮调优冻结桩与防伪 7 问 `INCONCLUSIVE`）；`feature.md`（跨边界 2 选 1、强类型/状态机、仅后端务实 TDD 与同波删旧、纯重构减负唯一判据、5 类注释白名单）；`long-task.md`（4 要素计划、进度监工与门禁、无人值守循环与安全暂停续跑）。
- **DSH 深度终审（`/a8-dsh-review` · `dsh-reviewer` + `review.ps1`）**：默认 `ReasoningEffort = medium`，需求锚定先行（强制传入用户原始需求与 Non-Goals，信任 DSH 原生 `@deepseek-ai/dsh-agent-instructions` 自动加载 `AGENTS.md` 不再重复搬运），仅真实 Bug ($F \times S \ge 10$) 或破损需求可阻断（风格/命名降为非阻塞，无缺陷直给 `PASSED`）；`Round 1` 默认启干净新会话、`Round >= 2` 复用同任务会话并注入战线冻结（默认 1~2 轮、硬上限 3 轮、分歧早停交人，退出后以真实运行面验活）；`ProcessStartInfo` 分离 `stdout`/`stderr`，归档至 `reviews/<repoSlug>/`（已 `.gitignore`）。
- **经验精炼（`/a8-improve`）与界面验证（`/a8-ui-verify`）**：`/a8-improve` 只需用户输入命令，由 Agent 在主会话一体化完成五维纠偏提取（含 6 个月保质期滤网；**仅当本会话已总结出候选规则/流程/偏好/原则时**才自主抽查最近 3～5 个历史会话做佐证论证，本会话无候选项直接如实说明，严禁为了找而找）、5 级防线阶梯与规则-强制器配对体检（缺强制器升格、已被封死的冗余规则主动删）、`improve_card.html` 提案、可选 `Backlog` 分流及人工编号落盘后的 **破坏抓虫验证实证门**（禁改运行缓存或借复盘开 PR）；`/a8-ui-verify` 统一脚本落 `scripts/tests/ui-verify/`、产物落 `logs/ui-verify/`。
- **Harness 可观测与上下文预算**：`decisions_client.py` 原子写入 `harness_metrics.jsonl`（分池保留 200 条 Hook 记录 + 1000 条检查器记录，驱动「可观测」14 日趋势、Token 负载与长期零违规检查器清理提醒）；`TOKENS.md`（`< 1KB`）固化 5 条上下文节流规则（先搜后读、局部送审、输入降噪、隔离子代理默认新建、按可验证单元推进）。
- **本仓 `scripts/lints/` 机械门禁矩阵（4 项核心门禁）**：
  - `check_swallowed_exceptions.mjs`：拦截空 `catch`、仅打日志吞异常与无意义原样 `throw e`；
  - `check_workspace_hygiene.mjs`：守卫 `AGENTS.md` / `GEMINI.md` / 规则文件 `<= 20,000 B`（防 Antigravity `24,000 B` 截断），并禁止新建 `> 12` 行未委托 Node 的 `.ps1` 业务脚本；
  - `check_plugin_agents.py`：守卫 `plugins/*/agents/*.md` 显式 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`；
  - `check_work_records.mjs`（`WORK_RECORD_SCHEMA`）：依据 `templates/work-record.md` 强制校验 `docs/` 下仅存在 `evergreen` / `records` / `deferred` 目录与唯二共享根文档 `glossary.md`、`verify.md`（均 `<= 20,000 B`）且无其他游离或已废弃 `.md` 文件（含 `INDEX.md`）、工作记录文件命名与 `# (SPEC|ADR|BUG)：` 标题、前 15 行 4 项元数据头（`日期` / `状态` / `域` / `取代`）与 5 枚举状态、`已废弃`/`部分失效` 记录在 `## 1. 问题与目标` 前包含 `> **[已失效` / `> **[部分失效` 失效横幅及 4 段固定骨架顺序。

---

## 6. 非目标与重新评估条件

- **非目标（当前有意不做）**：
  - 不安装 `pstack` 原插件或暴露 58+ 碎片技能，不引入硬编码模型名、云 PR 堆叠或公网 Webhook 暴露；
  - 不在 `docs/evergreen/*.md` 中混写验证实机命令（统一入根级 `docs/verify.md`，不拆 `docs/verify/` 子目录），也不用一行式过时清单表替代 `docs/records/`；
  - 不保留回合级 `Stop` Hook（不在每轮日常对话结束后拦截调 API 或拉起 `docs-sync` 子代理），且严禁 AI 在未获用户显式指令时擅自启用 `/a8-commit fast` 跳过语义红线审查；
  - 不把常规局部 Bug 批量写成独立 `*.decision.json`。
- **重新评估条件**：
  1. 当单仓 `docs/verify.md` 或单个常青域因系统扩展逼近 `18,000 B` 难再压缩时，再按子系统横向拆分（保留 `docs/verify.md` 作总路由索引）；
  2. 若未来需要支持完全不走 Git 提交的非版本库项目自动文档守护，再评估轻量级人工触发文档巡检命令。
