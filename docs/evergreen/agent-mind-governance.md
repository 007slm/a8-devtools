# A8 Agent Mind 插件与双层文档治理架构

> 全局心智治理插件（`/a8-prompt` 事前深化、`a8-workflow` 工作流、Decisions API 语义裁判、`PreInvocation + Stop` 严格 Git 增量、隔离 `docs-sync`、根级 `docs/verify.md` 与本仓机械门禁）的架构真相；全景导览见 [AI-研发工作流可视化指南.html](AI-研发工作流可视化指南.html)，术语见 [项目术语表](../glossary.md)，溯源见 [Decisions API 裁判设计](../records/20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md)、[双层文档闭环 ADR](../records/20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md)、[严格 Git 快照 ADR](../records/20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md)、[吸收 pstack 工作流与验证地图 ADR](../records/20261122-ADR-插件与治理-吸收pstack工作流体系与独立验证地图契约设计.md) 及 [`plugins/a8-agent-mind/design.md`](../../plugins/a8-agent-mind/design.md)。

---

## 1. 核心红线与有意权衡（裁判防误报必读）

- **全量无截断设计上下文注入（跳过 `.html` 可视化页）**：`judge_router.py`（`get_relevant_docs_for_files` / `load_documented_decisions_context`）对命中的 `AGENTS.md` 索引 `.md` 常青文档做**全量原文注入（默认无 `1600`/`360` 截断、不跳表格，自动跳过 `.html`/`.htm` 可视化指南防撑爆 Token）**，由文档自身的“短小精悍 + 准入控制”保证信噪比；
- **非 Git 目录与驱动器根严格静默**：`stop_reflect.py` 遇无 `.git` 目录或驱动器根目录（如 `C:\`）直接放行 `{}`，不搞非 Git 启发式扫盘（由 UI 层的 `has_git` 显式提示）；
- **高架构风险才派发 `arch-judge`**：常规 UI/文案/单点 Bug/规则与文档改动免检，严禁同任务高频增量复核；
- **Agent frontmatter 三项必填声明**：`plugins/*/agents/*.md` 必须显式写明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，防止运行时静默降级为只读 9 工具集；
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
  - 提取 Git Diff 元特征，过滤构建产物/锁文件/二进制与静态资产（`IGNORED_DIR_PREFIXES` 等）；
  - `_parse_agents_doc_registry` 兼容解析根目录 `AGENTS.md` 中的 **4 / 5 / 6+ 列**常青索引表，经 `get_relevant_docs_for_files`（`limit=4`）与 `load_documented_decisions_context` 将命中常青文档**全量原文**注入 `Documented Design Context`，避免 `gemini-decision-1` 与 `arch-judge` 对已备案权衡重复误报；
  - `decisions_client.py` 按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 28000`、`BATCH_QUESTION_CHARS = 6000`、`BATCH_MAX_QUESTIONS = 12`、`MAX_CONCURRENT_API_CALLS = 4`）。
- **触发纪律与 Subagent 契约**：
  - 高架构风险才在本地门禁通过后由 AI 自主调度一次 `arch-judge`（常规局部修改、UI、局部修 Bug、文档/规则调整免检，禁止同任务高频增量复核）；
  - `plugins/*/agents/*.md`（`arch-judge`、`dsh-reviewer`、`docs-sync`）frontmatter **必须**显式包含 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`（由 `scripts/lints/check_plugin_agents.py` 强制守卫），否则会被运行时静默降级为 9 工具只读集。

---

## 4. 快慢双轨文档治理与验证地图闭环（日间 `Stop` 轻守护 + 夜间 20:00 全量梳理）

- **四类文档职责与暂缓区（禁混写）**：
  - `docs/glossary.md`（共享术语表）& `docs/verify.md`（验证地图，`VERIFY`）—— **`docs/` 根目录唯二合法单文件（均 `<= 20,000 B`）**：`glossary.md` 由 `AGENTS.md`、常青文档与工作记录共用（不在表中的非通用概念二选一：补入表内并用普通话讲清，或正文直写普通话，禁自造黑话）；`verify.md` 只写改动模块验证路由、真实表面执行卡、本地盲区与基准防伪规范（禁混入长篇架构说教）；
  - `docs/evergreen/<domain>.md`（常青文档 — **高频主读、短小精悍**）：严守 5 条准入（跨文件边界、状态机/不变量、共享 Schema/契约、关键链路/阈值、Fail-Closed 与有意权衡/重评条件）与 4 条禁入（禁源码复述/流水账/代码穷举/未落地设想），硬红线前置，常规域 `2~6 KB`、核心域 `6~12 KB`（严禁 `> 20,000 B`）；
  - `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`（工作记录 — **轻量复检溯源**）：仅触及架构权衡/契约变更/深层根因时按 [`templates/work-record.md`](../../plugins/a8-agent-mind/templates/work-record.md) 写入（常规小改走单测与注释）；每节 2～4 条要点，禁代码流水账，`ADR` 必写制约+否决备选+重评条件，`## 3` 标明已验证与未覆盖边界：`<TYPE>` 仅 `SPEC`/`ADR`/`BUG`，首行 `# <TYPE>：<主题>`；4 项头部元数据（`日期`/`状态`/`域`/`取代`）+ 5 枚举状态 + 4 段固定骨架；
  - `docs/deferred/*.md`（暂缓区）：隔离存放未落地或暂停设想，禁混入常青文档。
- **渐进式披露与双向标废契约（无损回链，不删改历史正文）**：
  - `docs/records/` 完整保留历史证据；常青文档在头部或对应章节挂载 `../records/YYYYMMDD-....md` 相对链接（多坑域标明触发阅读条件），禁以一行式过时清单表替代原记录；
  - 新记录（核对 `- **取代**：`）或源码演进推翻/部分取代旧记录时，严禁篡改旧记录历史正文，仅将旧记录 `- **状态**：` 更新为 `已废弃（被 ... 取代）` 或 `部分失效（被 ... 更新）`，并在 `取代` 与 `---` 之间插入 `> **[已失效 / 已被取代（YYYY-MM-DD）]**` 或 `> **[部分失效（YYYY-MM-DD）]**` 横幅；**状态为 `进行中` 的工作记录严禁自动化改写或加横幅**。

```text
【日间快轨：当前会话随手轻更新，0 额外子代理】
Turn 首次模型调用前: hooks.json [PreInvocation] -> stop_reflect.py --pre-invocation
    │  采集一次 baseline_<digest>.json (head_sha + porcelain -z); 非 Git 静默 {}
    ▼
改码后写 docs/records/*.md，并按当前上下文顺手轻更新 docs/evergreen/ / docs/verify.md / AGENTS.md
    ▼  回合结束 (NO_TOOL_CALL): hooks.json [Stop] -> stop_reflect.py
    ├─► 未收口回合 (/plan, RequestFeedback, ask_question, RUNNING 任务/子代理) -> 静默 {}
    ├─► 非 Git 目录或无本 Turn Git 净变更 -> 静默 {}
    ├─► 已写 docs/records/ 或已更新 evergreen/verify/glossary -> 跳过文档 API 检查（有品味信号可问 ASK_USER_UI）
    └─► 仅改非文档文件 -> 调 Decisions API (docs_maintenance_needed):
         ├── 常规局部改动 (no >= threshold) -> 放行 {}
         ├── 触及系统契约 (未判免检) -> DOCS_MAINTENANCE 指导当前上下文原地写记录+轻更新常青（严禁起 docs-sync）
         └── 命中高维品味双门禁 -> 弹出 ASK_USER_UI 审批卡

【夜间慢轨：每晚 20:00 定时任务 / 手工 docs-sync 全量深度梳理】
nightly-evergreen-docs-sync (CRON_TZ=Asia/Shanghai 0 20 * * *)
    ├─► node scan_docs_sync.mjs 动态扫 repos.md（跳过 test-bed 与无新增提交/未提交变更/体检全绿仓）
    └─► 仅对 needs_review=true 的仓库按 docs-sync 规范核验真实源码 -> 补齐常青/地图/术语表/AGENTS、修断链、标废已取代历史记录（禁改源码/测试/进行中记录、禁 git commit）-> 跑通门禁后 --mark-done
```

- **核心不变量与感知边界（由 `scripts/lints/check_stop_hook_invariants.py` 验证 20 项不变量）**：
  1. 彻底废除 `AUTO_LINT`、`AUTO_DECISION`、`EVERGREEN_SYNC_QUESTION` 与 Stop Hook 强制起 `docs-sync` 分支，所有规则变更须经 `ASK_USER_UI` 或 `/a8-improve` 人工编号确认；
  2. `_classify_doc_path_role` 将 `docs/glossary.md` 与 `docs/verify.md` 均显式归为 `"evergreen"`（`docs/evergreen/` 下仅 `.md` 归 `"evergreen"`，`.html` 归 `"other_doc"`）；**日间写过 `docs/records/*.md` 或 `evergreen` 类文档即视作履行日常文档职责直接放行（有纠偏品味信号仍可独立触发 `ASK_USER_UI`）**；仅当未改任何文档且改码触及非文档文件时才调 `docs_maintenance_needed`，Decisions API 不可用时 Fail-Closed 提示当前上下文顺手闭环（严禁起 `docs-sync`）；
  3. **夜间慢轨 (`scan_docs_sync.mjs` + `agents/docs-sync.md`)**：定期任务配置存于 `templates/nightly-evergreen-docs-sync.sidecar.json`（Antigravity `sidecar.json` 严格只授予文档目录写权限与只读 `git status/diff/log` + 门禁命令），水位落于 `%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\nightly_docs_sync_state.json`。夜间梳理与手工 `docs-sync` 均遵守 **真实源码/测试 > 工作记录 > 旧文档**，第 2 步核查 `.qnt` 等形式化模型漂移，严禁修改源码或 `进行中` 记录、严禁 `git commit/push`；
  4. **严格 Git 回合增量快照与无 Git 静默边界**：移除基于 `transcript.jsonl` 工具调用收集 `edited_files` 的旧路。`PreInvocation` 记录基线（最多 50 个 `baseline_*.json` 分片），`Stop` 由 `_collect_git_turn_changes` 对比工作区与 `HEAD` 变更，捕获主会话、编码子代理、`run_command` 及 Turn 内 `git commit` 净变更并排除回合前老脏文件；非 Git 目录与驱动器根静默返回 `{}`，DevTools / Sidecar 通过 `has_git` 提示「无 Git」。

---

## 5. `a8-workflow` 工作流、DSH 终审、经验复盘与本仓机械门禁

- **7 大核心技能与单入口工作流（严控 3 自动内功 + 4 手动大招）**：技能层固定为 **3 个自动内功**（`a8-workflow`、`a8-judge`、`a8-ui-design`）+ **4 个手动大招**（事前 `/a8-prompt` → 事中 `/a8-dsh-review` & `/a8-ui-verify` → 事后 `/a8-improve`）。`/a8-prompt`（`skills/a8-prompt/`）严禁改码，贴合仓 `AGENTS.md`/`docs/verify.md` 答专家 4 问后改写“做深不做大”Prompt 即停；其余子动作均内化进 `a8-workflow`（`SKILL.md` + 5 份场景指南 + 85 项来源映射 `references/pstack-source-map.md`，改编自 `pstack v0.15.46` / `0b46ec399d55f2829e88822998f53b84944837d3` MIT），一两行小改免强开：
  - `SKILL.md`：含只出方案不改码的「问路模式」、**自然语言直达路由**（直达进度恢复、原理/历史图解、爆炸半径、多方案擂台、清注释/实证攻击）、接单对齐（粗糙想法引向 `/a8-prompt`）与切话题重置、5 指南路由、`[实测/推断/待确认]` 标签、动工先查 `docs/verify.md`、`swarm`/子代理写区隔离与干净派发、**5 步 A8 交卷收口**（`<= 40` 行简报，长日志放 `logs/`）；
  - `guides/analyze.md`（严格只读：渐进图解、Git/本仓会话溯源、5 级确信度、活进程剖析与离线转表、5 分类定责）；`bug-fix.md`（查已有修复、真实面双次复现、连败 2 次证伪前提、低成本路径务实 TDD 与防假绿/防绑实现双检）；`perf.md`（基线与剖析分离、7 阶梯、多轮指标调优与 **性能基准防伪 7 问核查**缺项判 `INCONCLUSIVE`）；`feature.md`（跨边界 2 选 1 / 多方案融合、强类型与 `.qnt` 或随机序列抓虫、纯重构减负唯一判据、`scratch/` 原型、像素对齐、**5 类注释白名单［跨文件大改或清注释时派未参与写码的独立只读子代理扫描］**与只读对抗检查）；`long-task.md`（4 要素规划、按磁盘副作用监工、`schedule` 无人值守、`logs/<task>-decisions.tsv` 防注入 + `Attention` 独立审阅、长任务进度汇报、暂停续跑与 `wip:N`/`scratch:N` 安全清理）。
- **DSH 深度终审（`/a8-dsh-review` · `dsh-reviewer` + `review.ps1`）**：默认 `ReasoningEffort = medium`，预打包 `git status` / `diff --stat` 与 `AGENTS.md`（兼容 3/4/5/6+ 列语义表映射）/ 常青文档摘录；`ProcessStartInfo` 分离 `stdout`/`stderr`，默认注入 `--permission-mode read-only --approval-policy never`；执行 $F \times S < 10$ YAGNI 熔断（硬上限 2~3 轮），归档至 `reviews/<repoSlug>/`（已 `.gitignore`）。
- **经验精炼（`/a8-improve`）与界面验证（`/a8-ui-verify`）**：`/a8-improve` 在主会话一体化完成五维纠偏提取（含 6 个月保质期滤网与跨会话 `>= 2` 次立类）、5 级防线阶梯与规则-强制器配对体检（缺强制器升格、已被封死的冗余规则主动删）、`improve_card.html` 提案、可选 `Backlog` 分流及人工编号落盘后的 **破坏抓虫验证实证门**（禁改运行缓存或借复盘开 PR）；`/a8-ui-verify` 统一脚本落 `scripts/tests/ui-verify/`、产物落 `logs/ui-verify/`。
- **Harness 可观测与上下文预算**：`decisions_client.py` 原子写入 `harness_metrics.jsonl`（分池保留 200 条 Hook 记录 + 1000 条检查器记录，驱动「可观测」14 日趋势、Token 负载与长期零违规检查器清理提醒）；`TOKENS.md`（`< 1KB`）固化 5 条上下文节流规则（先搜后读、局部送审、输入降噪、隔离子代理默认新建、按可验证单元推进）。
- **本仓 `scripts/lints/` 机械门禁矩阵**：
  - `check_swallowed_exceptions.mjs`：拦截空 `catch`、仅打日志吞异常与无意义原样 `throw e`；
  - `check_workspace_hygiene.mjs`：守卫 `AGENTS.md` / `GEMINI.md` / 规则文件 `<= 20,000 B`（防 Antigravity `24,000 B` 截断），并禁止新建 `> 12` 行未委托 Node 的 `.ps1` 业务脚本；
  - `check_plugin_agents.py`：守卫 `plugins/*/agents/*.md` 显式 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`；
  - `check_stop_hook_invariants.py`：守卫 `stop_reflect.py` **20 项核心不变量**（含严格 Git 回合增量快照、无 Git 静默、编码子代理与 Turn 内 `git commit` 捕获，及 `docs/verify.md`、`docs/glossary.md` 归类 `"evergreen"` 防死循环）；
  - `check_work_records.mjs`（`WORK_RECORD_SCHEMA`）：依据 `templates/work-record.md` 强制校验 `docs/` 下仅存在 `evergreen` / `records` / `deferred` 目录与唯二共享根文档 `glossary.md`、`verify.md`（均 `<= 20,000 B`）且无其他游离或已废弃 `.md` 文件（含 `INDEX.md`）、工作记录文件命名与 `# (SPEC|ADR|BUG)：` 标题、前 15 行 4 项元数据头（`日期` / `状态` / `域` / `取代`）与 5 枚举状态、`已废弃`/`部分失效` 记录在 `## 1. 问题与目标` 前包含 `> **[已失效` / `> **[部分失效` 失效横幅及 4 段固定骨架顺序。

---

## 6. 非目标与重新评估条件

- **非目标（当前有意不做）**：
  - 不安装 `pstack` 原插件或暴露 58+ 碎片技能，不引入硬编码模型名、云 PR 堆叠或公网 Webhook 暴露；
  - 不在 `docs/evergreen/*.md` 中混写验证实机命令（统一入根级 `docs/verify.md`，不拆 `docs/verify/` 子目录），也不用一行式过时清单表替代 `docs/records/`；
  - 不在日间每写完一次工作记录后拉起 `docs-sync` 子代理重复读码耗 Token（改由日间当前上下文顺手轻更 + 每晚 20:00 定时扫描与 `docs-sync` 慢轨兜底全量梳理，且夜间只写盘不自动提交、不动 `进行中` 记录）；
  - 不把常规局部 Bug 批量写成独立 `*.decision.json`，也不在 `stop_reflect.py` 维护 `transcript.jsonl` 变更收集旧路或非 Git 扫盘兜底。
- **重新评估条件**：
  1. 当 Antigravity 官方 Hook payload 直接下发结构化 `changedFiles` / `turnDiff` 字段，或需要支持非 Git 版本库项目时，重新评估感知层接入方式；
  2. 当单仓 `docs/verify.md` 或单个常青域因系统扩展逼近 `18,000 B` 难再压缩时，再按子系统横向拆分（保留 `docs/verify.md` 作总路由索引）。
