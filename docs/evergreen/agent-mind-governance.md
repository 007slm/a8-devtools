# A8 Agent Mind 插件与双层文档治理架构

> 全局心智治理插件（Google Decisions API 语义裁判、`PreInvocation + Stop` 严格 Git 增量、隔离 `docs-curator` 与本仓机械门禁）的当前架构真相；专有术语见 [项目术语表](../glossary.md)，详细设计溯源见 [Decisions API 裁判设计](../records/20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md)、[双层文档闭环 ADR](../records/20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md)、[严格 Git 快照 ADR](../records/20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md) 及 [`plugins/a8-agent-mind/design.md`](../../plugins/a8-agent-mind/design.md)。

---

## 1. 核心红线与有意权衡（裁判防误报必读）

- **全量无截断设计上下文注入**：`judge_router.py`（`load_documented_decisions_context`）对命中的 `AGENTS.md` 索引常青文档做**全量原文注入（默认无 `1600`/`360` 截断、不跳表格）**，由文档自身的“短小精悍 + 准入控制”保证信噪比；
- **非 Git 目录与驱动器根严格静默**：`stop_reflect.py` 遇无 `.git` 目录或驱动器根目录（如 `C:\`）直接放行 `{}`，不搞非 Git 启发式扫盘（由 UI 层的 `has_git` 显式提示）；
- **高架构风险才派发 `arch-judge`**：常规 UI/文案/单点 Bug/规则与文档改动免检，严禁同任务高频增量复核；
- **Agent frontmatter 三项必填声明**：`plugins/*/agents/*.md` 必须显式写明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，防止运行时静默降级为只读 9 工具集。

---

## 2. 三层治理漏斗与对称双域存储

防线沉淀严格遵循 **确定性 Lint（`scripts/lints/*.mjs|*.py`） > 结构化语义 Decision（`*.decision.json`） > 自然语言规则（`mind-rules.md` / `.agents/rules/*.md`）**：

| 层级 | 全局通用存放位置 | 单仓专属存放位置 | 执行方式 |
| :--- | :--- | :--- | :--- |
| 确定性 Lint | 随仓分发示例 / 插件脚本 | `<repo>/scripts/lints/*.mjs\|*.py` | 提交前全自动确定性校验（零误报优先） |
| 语义 Decision | `plugins/a8-agent-mind/decisions/*.decision.json`（4 个互不重叠核心维度） | `<repo>/scripts/lints/*.decision.json` | `decisions_client.py` 无损分片送审 `gemini-decision-1` |
| 自然语言 Rule | `plugins/a8-agent-mind/rules/mind-rules.md`、`TOKENS.md` | `<repo>/.agents/rules/redline.md` | 随 Antigravity 会话注入上下文（严格 `< 20,000 B`） |

---

## 3. 4 个核心裁决维度与 `judge_router.py` 文档路由

- **4 个互不重叠的核心维度**：`lifecycle_and_evolution`（全生命周期不变量与零擅自向后兼容）、`topology_and_boundaries`（单向分层与隔离）、`concurrency_and_performance`（热路径性能与资源守恒）、`implementation_hygiene`（单一路径、直白简单命名禁生僻状态词、平实文档与术语表自律、错误第一现场保留）。
- **变更指针与文档路由（`judge_router.py`）**：
  - 提取 Git Diff 元特征，过滤构建产物/锁文件/二进制与静态资产（`IGNORED_DIR_PREFIXES` 等）；
  - `_parse_agents_doc_registry` 兼容解析根目录 `AGENTS.md` 中的 **4 / 5 / 6+ 列**常青索引表，经 `get_relevant_docs_for_files`（`limit=4`）与 `load_documented_decisions_context` 将命中常青文档**全量原文**注入 `Documented Design Context`，避免 `gemini-decision-1` 与 `arch-judge` 对已备案权衡重复误报；
  - `decisions_client.py` 按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 28000`、`BATCH_QUESTION_CHARS = 6000`、`BATCH_MAX_QUESTIONS = 12`、`MAX_CONCURRENT_API_CALLS = 4`）。
- **触发纪律与 Subagent 契约**：
  - 高架构风险才在本地门禁通过后由 AI 自主调度一次 `arch-judge`（常规局部修改、UI、局部修 Bug、文档/规则调整免检，禁止同任务高频增量复核）；
  - `plugins/*/agents/*.md`（`arch-judge`、`dsh-reviewer`、`docs-curator`）frontmatter **必须**显式包含 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`（由 `scripts/lints/check_plugin_agents.py` 强制守卫），否则会被运行时静默降级为 9 工具只读集。

---

## 4. 双层文档体系、共享术语表与隔离整合闭环（`PreInvocation` + `Stop` -> `docs-curator`）

- **共享术语表与三区职责**：
  - `docs/glossary.md`（共享术语表 — 位于 `docs/` 根目录，由 `AGENTS.md`、常青文档与工作记录共用）：除通用技术词和反引号包裹的真实代码名外，文档可直接引用术语表词汇；不在表中的概念由写作者自主二选一——**补入 `docs/glossary.md` 并用一句话普通话讲清，或直接在正文用普通话写清楚**（不设僵化词数上限，严禁未定义黑话）；
  - `docs/evergreen/<domain>.md`（常青文档 — **高频主读、短小精悍**）：严守 5 条准入（跨文件边界、状态机/不变量、共享 Schema/契约、关键链路/阈值、Fail-Closed 与有意权衡/`Reconsider when`）与 4 条禁入（禁源码复述/流水账/代码穷举/未落地设想），硬红线前置，常规域 `2~6 KB`、核心引擎域 `6~12 KB`（严禁 `> 20,000 B`）；
  - `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`（工作记录 — **轻量复检溯源**）：仅触及架构权衡/契约变更/深层根因时按 [`templates/work-record.md`](../../plugins/a8-agent-mind/templates/work-record.md) 写入（常规小改走单测与行内注释）；吸收 Gist 精悍准则（2～4 条要点/节，禁代码修改流水账，`ADR` 必写制约+否决备选+`Reconsider when`，`## 3` 强制标明已验证与未覆盖边界）；
    - `<TYPE>` 仅允许 `SPEC`、`ADR`、`BUG`，首行标题为 `# <TYPE>：<主题>`；
    - 头部固定 4 项元数据：`- **日期**：YYYY-MM-DD`、`- **状态**：`（`进行中` / `已落地（当时有效）` / `部分失效` / `已废弃` / `已暂缓`）、`- **域**：`、`- **取代**：`（不含 `关联源码`）；
    - 正文固定 4 段骨架：`## 1. 问题与目标` → `## 2. 核心设计与结论` → `## 3. 当时验证范围` → `## 4. 对常青文档的影响`；
  - `docs/deferred/*.md`（暂缓区）：隔离存放未落地或暂停实施的设想，严禁混入常青文档。
- **渐进式披露与双向标废契约（无损回链，不删改历史正文）**：
  - `docs/records/` 作为完整无损的历史证据与排障轨迹保留；常青文档在头部或对应章节挂载 `../records/YYYYMMDD-....md` 相对链接（复杂多坑域显式标注触发阅读条件），按需下钻查阅，严禁用一行式过时清单表取代原记录而丢失触发边界；
  - 当新记录（核对 `- **取代**：`）或源码演进推翻/部分取代旧记录时，严禁篡改旧记录原本的验证正文，而由 `docs-curator` 就地将旧记录 `- **状态**：` 更新为 `已废弃（被 ... 取代）` 或 `部分失效（被 ... 更新）`，并在 `取代` 与分隔线 `---`（`## 1. 问题与目标` 之前）之间插入醒目横幅（`> **[已失效 / 已被取代（YYYY-MM-DD）]**` 或 `> **[部分失效（YYYY-MM-DD）]**`）。

```text
Turn 首次模型调用前: hooks.json [PreInvocation] -> stop_reflect.py --pre-invocation
    │  capture_turn_baseline: 解析 Git 根目录（跳过驱动器根目录），按 (conv_id, turn_key)
    │  采集一次 baseline_<digest>.json（head_sha + porcelain -z 状态/mtime_ns/size）；非 Git 目录静默 {}
    ▼
主会话 / 编码子代理 / run_command 改码与写工作记录 (docs/records/YYYYMMDD-*.md)
    │  (简单修 Bug 仅写单测与行内注释，不建噪声记录)
    ▼  回合结束 (NO_TOOL_CALL): hooks.json [Stop] -> stop_reflect.py
    ├─► 未收口回合 (/plan, RequestFeedback, ask_question, RUNNING 任务/子代理) -> 静默返回 {}（不推进 last_taste_step）
    ├─► _collect_git_turn_changes 计算本 Turn 真实 Git 净变更（排除回合前老脏文件，含 Turn 内 git commit）；
    │   非 Git 目录或无净变更 -> 静默返回 {}（无轨迹兜底）
    ├─► 本轮已更新 docs/evergreen/ 或已完成调用 docs-curator (且在最后改码/记录之后) -> 静默返回 {}（防死循环）
    └─► 调 Google Decisions API（注入 git diff --stat、脱敏用户意图、规则摘要及工作记录摘录）：
         ├── 常规局部改动 / 简单修复 (no >= threshold 且无 evergreen_sync_needed=yes) -> 放行 {}
         ├── 写过工作记录且 evergreen_sync_needed 未豁免 -> DOCS_MAINTENANCE 指令调用隔离子代理 docs-curator
         ├── 未写文档且触及系统契约/边界 -> DOCS_MAINTENANCE 引导记录并调用 docs-curator
         └── 落地非文档源码 + 命中高维品味双门禁 (taste >= 0.90 & distinct >= 0.85) -> 弹出 ASK_USER_UI 审批卡
```

- **核心不变量与感知边界（由 `scripts/lints/check_stop_hook_invariants.py` 验证 19 项不变量）**：
  1. 彻底废除 `AUTO_LINT` / `AUTO_DECISION` 静默写盘分支，所有规则变更必须经 `ASK_USER_UI` 或 `/a8-improve` 人工编号确认；
  2. `_classify_doc_path_role` 将路径精确划分为 `evergreen` / `record` / `deferred`（含 `archive/`）/ `other_doc` / `skip` / `non_doc`，写入 `docs/records/*.md` **不得**静默绕过常青文档同步判定；Decisions API 不可用且存在待核查改码/记录时 Fail-Closed 返回 `DOCS_MAINTENANCE`；
  3. 已在当前回合且于最后源码/记录修改之后完成 `docs-curator` 调用（`status != ERROR`）或直接修改了 `docs/evergreen/*.md` 时，立即放行防死循环；
  4. `docs-curator`（`agents/docs-curator.md`）在隔离上下文运行，严格遵循 **实际源码与测试 > `docs/records/` 工作记录 > 既有 `docs/evergreen/`**，按 `templates/work-record.md` 核验新记录并执行旧记录就地贴横幅双向标废，仅修改 `docs/` 与 `AGENTS.md`（不再创建或维护 `docs/INDEX.md`），严禁修改业务源码；
  5. **严格 Git 回合增量快照与无 Git 静默边界**：彻底移除基于 `transcript.jsonl` 工具调用收集 `edited_files` 的逻辑。`PreInvocation` 按 `(conversationId, turn_key)` 记录一次轻量工作区基线（最多保留 50 个 `baseline_*.json` 分片），`Stop` 阶段由 `_collect_git_turn_changes` 对比当前状态与基线（含 `HEAD` 变更 `git diff --name-only` / `diff-tree`），从而无死角捕获主会话、编码子代理（如 `DeepCoder`）、`run_command` 及本 Turn 内 `git commit` 产生的净变更并附带 `git diff --stat`，同时排除回合前已存在的老脏文件；对非 Git 目录及驱动器根目录（如 `C:\`）严格静默返回 `{}`，不做非 Git 兜底扫描，由 DevTools / Sidecar 界面层通过 `has_git` 展示「无 Git」提醒。

---

## 5. DSH 终审、规则精炼、可观测与本仓机械门禁

- **DSH 深度终审（`/a8-dsh-review` · `dsh-reviewer` + `review.ps1`）**：默认 `ReasoningEffort = medium`，预打包 `git status` / `diff --stat` 与 `AGENTS.md`（兼容 3/4/5/6+ 列语义表映射）/ 常青文档摘录；`ProcessStartInfo` 分离 `stdout`/`stderr`，默认注入 `--permission-mode read-only --approval-policy never`；执行 $F \times S < 10$ YAGNI 熔断（硬上限 2~3 轮），归档至 `reviews/<repoSlug>/`（已 `.gitignore`）。
- **经验精炼（`/a8-improve`）与界面验证（`/a8-ui-verify`）**：`/a8-improve` 在主会话一体化完成五维纠偏提取与无效/冲突/重复规则清理（`Propose Then Stop`）；`/a8-ui-verify` 统一脚本落 `scripts/tests/ui-verify/`、产物落 `logs/ui-verify/`。
- **Harness 可观测与上下文预算**：`decisions_client.py` 原子写入 `harness_metrics.jsonl`（分池保留 200 条 Hook 记录 + 1000 条检查器记录，驱动「可观测」14 日趋势、Token 负载与长期零违规检查器清理提醒）；`TOKENS.md`（`< 1KB`）固化上下文节流纪律。
- **本仓 `scripts/lints/` 机械门禁矩阵**：
  - `check_swallowed_exceptions.mjs`：拦截空 `catch`、仅打日志吞异常与无意义原样 `throw e`；
  - `check_workspace_hygiene.mjs`：守卫 `AGENTS.md` / `GEMINI.md` / 规则文件 `<= 20,000 B`（防 Antigravity `24,000 B` 截断），并禁止新建 `> 12` 行未委托 Node 的 `.ps1` 业务脚本；
  - `check_plugin_agents.py`：守卫 `plugins/*/agents/*.md` 显式 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`；
  - `check_stop_hook_invariants.py`：守卫 `stop_reflect.py` 19 项核心不变量（含严格 Git 回合增量快照、无 Git 静默、编码子代理与 Turn 内 `git commit` 捕获）；
  - `check_work_records.mjs`（`WORK_RECORD_SCHEMA`）：依据 `templates/work-record.md` 强制校验 `docs/` 下仅存在 `evergreen` / `records` / `deferred` 目录与共享术语表 `glossary.md`（`<= 20,000 B`）且无其他游离或已废弃 `.md` 文件（含 `INDEX.md`）、工作记录文件命名与 `# (SPEC|ADR|BUG)：` 标题、前 15 行 4 项元数据头（`日期` / `状态` / `域` / `取代`）与 5 枚举状态、`已废弃`/`部分失效` 记录在 `## 1. 问题与目标` 前包含 `> **[已失效` / `> **[部分失效` 失效横幅及 4 段固定骨架顺序。

---

## 6. 非目标与重新评估条件（Reconsider When）

- **非目标（当前有意不做）**：
  - 不在常青文档中用一行式过时清单表替代 `docs/records/` 完整工作记录，避免丢失前置条件与踩坑边界；
  - 不由主会话在编码/排障尾声顺手原地刷新跨文件 `docs/evergreen/`，统一交由隔离上下文 `docs-curator` 核验源码后整合；
  - 不把所有常规局部 Bug 批量写成独立 `*.decision.json`（确定性禁忌归 `scripts/lints/`，跨模块语义不变量聚合进少数带 `file_patterns` 作用域的 `*.decision.json`，其余常规局部修补归回归单测与源码行内 `Why` 注释）；
  - 不在 `stop_reflect.py` 维护基于 `transcript.jsonl` 工具调用的变更收集两套并存逻辑，也不为非 Git 目录做文件遍历兜底（非 Git 目录在 Hook 侧严格静默返回 `{}`，在 DevTools 界面层显式提示「无 Git」）。
- **重新评估条件（Reconsider When）**：
  1. 当 Antigravity 官方 Hook payload 直接下发结构化 `changedFiles` / `turnDiff` 字段，或需要支持 SVN/Mercurial 等非 Git 版本库项目时，重新评估感知层接入方式；
  2. 当单个业务域的常青真相因系统复杂度增长难以维持单篇紧凑无损时，按独立子主题横向拆分常青文档（而非通过摘要压缩丢掉精确边界）。
