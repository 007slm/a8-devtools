# SPEC - 基于 Google Decisions API 的语义红线裁判与规则沉淀设计

| 状态 | 起草人 | 评审人 | 日期 | 关联模块 |
| :--- | :--- | :--- | :--- | :--- |
| **APPROVED** | Antigravity AI | 007slm | 2026-11-10 | `plugins/a8-agent-mind` |

---

## 1. 战略定位与立项背景 (Motivation)

在开发者百宝箱平台（`a8-devtools`）中，为了赋能所有现代仓库（如 `a8-turbo` 及其他后端/桌面/文档仓库）实现自动化、高质量的架构治理与经验演进闭环，彻底解决传统静态分析（ArchUnit）依赖类名正则猜度导致的高误判、高漏判泥潭，正式确立打造通用 Antigravity 插件 **`a8-agent-mind`**。

---

## 2. 核心架构与决策记录 (Key Decisions)

### 2.1 纯 Agent-Native 插件驱动形态（砍掉冗余 CLI）
- 坚决贯彻 YAGNI 原则，不搞多余的外部 npm/pip 打包发布工具链；
- 100% 走 Antigravity 原生 Plugin 体系，由 `mind-rules.md`（全局常驻自动治理）统领，驱动 `a8-judge`（AI 自主择机只读红线裁决）与双层地图/文档随会话闭环，并与 `a8-improve`（主会话规则沉淀与清理）及 `dsh-reviewer`（有界跨文件深度终审，`a8-dsh-review`）正交协同。

### 2.2 三层治理防线、自适应路由与无损多路并发裁决
确立 **确定性 Lint（`scripts/lints/*.py`） > 结构化语义决策（`*.decision.json`） > 自然语言规则（`mind-rules.md` / `.agents/rules/*.md`）** 三级治理漏斗：
- **对称双域 Decision 存储**：全局通用决策存放在 [`plugins/a8-agent-mind/decisions/*.decision.json`](file:///e:/a8-devtools/plugins/a8-agent-mind/decisions/)（默认固化 4 大正交核心决策），各仓库专属决策与 Lint 同目录并置在 `<repo>/scripts/lints/*.decision.json`（如 [`e:\a8-turbo\scripts\lints\white_label_isolation.decision.json`](file:///e:/a8-turbo/scripts/lints/white_label_isolation.decision.json)）。
- **步骤一（变更指针与设计文档路由，`judge_router.py`）**：将 Git Diff 作为“改动指针”，提取 `changed_files`、语法元特征、激活的全局 + 目标仓库 `*.decision.json` 与 Markdown 规则条目，并通过 `get_relevant_docs_for_files` / `load_documented_decisions_context` 解析目标仓库 `AGENTS.md` 文档索引表，输出推荐必读清单 `relevant_docs` 与有界设计摘要（1600 字符内）。支持 `--paths <p1,p2>` 聚焦子目录，默认过滤 `ui/dist/target/node_modules/assets/fonts`、二进制及锁文件，防止无关资产噪音引发 Token 膨胀。
- **HTML 邮件/网页高噪正文清洗助手（`scripts/strip_html_text.py`）**：零第三方依赖的流式 HTML/JSON 提取工具，在模型读入资讯或定时邮件（如 `daily-grok-ai-workflow-proposal`）前剥离 `<style>`、`<script>`、`<svg>` 与 VML 注释，压缩输出高密度纯文本。
- **步骤二（`arch-judge` 自主全貌 + `docs/` 终审 & Decisions API 初筛雷达）**：确立 **“Diff 只是变更指针，`arch-judge` 基于项目现状 + `docs/` 作最终裁决”** 的双层裁决模型——[`arch-judge`](file:///e:/a8-devtools/plugins/a8-agent-mind/agents/arch-judge.md)（与 [`dsh-reviewer`](file:///e:/a8-devtools/plugins/a8-agent-mind/agents/dsh-reviewer.md) 统一在 frontmatter 显式声明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，避免 Antigravity 运行时回退至默认只读 9 工具集）配置完整工具集（含 `run_command`、`manage_task`、`read_file`、`search_web`、`edit_file`、`write_file`），可自主运行 `judge_router.py`、`decisions_client.py`、`git`/`rg` 与验证命令，主动研读 `AGENTS.md`、`relevant_docs` 指向的 `docs/*.md`、完整源码文件与上下游调用链，排除已备案权衡误报；而 [`decisions_client.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/skills/a8-judge/scripts/decisions_client.py) 作为高速初筛雷达，按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 28000`、`BATCH_QUESTION_CHARS = 6000` / `BATCH_MAX_QUESTIONS = 12`、`MAX_CONCURRENT_API_CALLS = 4`）并在每个 chunk 前置 `Documented Design Context`，由 `gemini-decision-1` 返回先验风险信号。

### 2.3 4 大正交维度与纯通用元特征路由 (Zero Project Hardcoding)
将架构红线按正交关注点聚合成 4 个独立决策文件（`plugins/a8-agent-mind/decisions/*.decision.json`），同时支持按项目扩展任意 `*.decision.json`：
1. `lifecycle_and_evolution`：生命周期闭环（含移出/停用必同步失效与历史证据封死防回退等状态不变量）、零擅自向后兼容；
2. `topology_and_boundaries`：边界纯净隔离、底层模块零重型框架侵入、模块单向分层；
3. `concurrency_and_performance`：数据面热路径无排他锁、杜绝幽灵轮询、并发资源/信号量获取与归还精确守恒；
4. `implementation_hygiene`：核心能力单一解析路径、错误物理第一现场保留。

通过纯通用的语法元特征（`import`、公开方法签名、`synchronized`/`Semaphore`/`Atomic*`/锁原语、`invalidate`/`reconcile`、`catch`/异常）与路径模式实现自适应毫秒级路由。

### 2.4 Generative UI 紧凑型现代报表
- 自动将 Google Gemini Decisions API 结构化决断与 `/a8-improve` 规则补丁编译为高质感 HTML 卡片，通过 `<agent-embed>` 内嵌到对话流中；
- 紧凑布局（高密度 2x2 网格、折叠审计抽屉、状态徽章与双栏摘要），自适应 Antigravity 语义设计变量。

### 2.5 随会话自主治理 + `Stop` Hook 自动反射 + `/a8-improve` 经验与规则库一体化精炼
明确区分不同治理动作的触发机制与职责边界：
- **随会话自主完成（由 `mind-rules.md` 自动驱动，无需人工调用）**：
  1. **显式状态机、不变量先行、Node.js 脚本优先与异常保留防线**：跨仓库强制多阶段生命周期采用显式状态枚举与跃迁守卫，并发/状态流转改动前先行声明核心不变量（守恒式、单调守卫、移除即失效）并在 `arch-judge` / `dsh-reviewer` 中按并发/异常/停用/移出路径反证；统一约定 `.agents/rules/`（自然语言红线）、`scripts/lints/`（可执行项目 Lint，配套确定性 Node.js 脚本 `check_swallowed_exceptions.mjs` 拦截空 `catch`/仅日志吞异常/冗余 `throw e`，及 `check_workspace_hygiene.mjs` 守卫规则文件 `< 20,000 B` 与禁止新建 `> 12` 行 `.ps1` 业务脚本）、`scripts/tests/ui-verify/`（UI 验证脚本）、`logs/ui-verify/`（运行时产物）；
  2. **双层文档索引防截断与仓库地图同步**：全量文档及日常 `BUG`/`CHANGELOG`/`REPORT` 归档登记至 `docs/INDEX.md`，目标仓根目录 **`AGENTS.md`** 仅保留核心长期 `SPEC`/`ADR`/`GUIDE` 简述（每条 `<= 30` 字、单文件严控 `< 20,000 B` 防触及 Antigravity 官方 `24 KB` 按行硬截断）；跨仓拓扑同步 `a8-agent-mind/repos.md`；
  3. **语义架构红线自主择机终审 (`a8-judge`)**：凡任务涉及触及 4 大正交红线的代码、接口契约或依赖边界修改，Agent 应在本地编译测试通过后、正式交卷前**自主判断合适时机主动调用一次 `a8-judge`** 执行零输出 Token 概率裁决自检（纯文档、注释与轻量样式微调自主免检）。
- **回合结束自动反射与文档门禁（`hooks.json` + `hooks/stop_reflect.py`）**：
  - 采用 **L0 零成本预筛 + 安全前置清洗 + Google Decisions API 五维联合裁决**（在 `NO_TOOL_CALL` 回合终止且存在变更/纠偏信号时自动触发）：
    - **外部文本隔离与明文密钥脱敏（`stop_reflect.py`）**：在关键词预筛与构造 `input_summary` 之前，先执行 `_redact_secrets`（识别并替换 `AIzaSy...`、`sk-...`、`ghp_...`、`Bearer ...`、私钥 PEM 与敏感 KV 赋值为 `[REDACTED]`）与 `_sanitize_external_pastes`（识别邮件头、网页/Issue 粘贴及越权注入指令行并隔离为 `[UNTRUSTED_EXTERNAL_DIRECTIVE_OMITTED]`），防止粘贴文本误触发规范提炼或将敏感凭证带入决策提示与规则候选；
    - 按三层防线优先级路由：
      - 适合机械检测的违规（`AUTO_LINT`）：唤醒主 Agent 直接将检查写入 `<repo>/scripts/lints/` 并现场自检通过（失败或误报自动降级）；
      - 无法机械检测但可语义裁决且归属明确（`can_be_semantic_decision == "yes"` ≥ 0.80 且 `scope_conf >= 0.70` → `AUTO_DECISION`）：唤醒主 Agent 自动沉淀为结构化 `<repo>/scripts/lints/*.decision.json` 或 `plugins/a8-agent-mind/decisions/*.decision.json` 并运行 `--validate-only` 校验通过；
      - 涉及设计品味或边界不明确的经验（`ASK_USER_UI`）：渲染 Generative UI 卡片，明确区分**通用全局规范 (`mind-rules.md`)**、**结构化 Decision (`*.decision.json`)**、**本项目红线 (`.agents/rules/redline.md`)** 与 **项目检查 (`scripts/lints/`)**，交由用户确认落盘；
      - **`docs/` 文档维护严格门禁（`DOCS_MAINTENANCE`）**：当本轮修改了非文档源码/配置（排除 `AGENTS.md`、`logs/`、`scratch/`、`.gemini/antigravity/brain/`、`.gemini/config/sidecars/` 等运行态目录）却未维护 `docs/` 时，合并附加 `docs_maintenance_needed` 裁决问题；**仅当 Decisions API 明确返回 `choice == "no"` 且置信度 `>= confidence_threshold`（默认 `0.85`）时才豁免放行**，其余任意情况（返回 `yes`、置信度不足、缺省或 API 不可用）均以 `{"decision": "continue"}` 自动提示主 Agent 核查并补全 `docs/` 与 `AGENTS.md`（`_extract_recent_turn_summary` 同时将 `Stop hook blocked termination:` 续行消息识别为新回合边界，且在续行回合中清空陈旧 `lastUserInput` 与运行态产物编辑计数，杜绝 `ASK_USER_UI` 等待用户确认或 `DOCS_MAINTENANCE` 解释后的死循环）。
- **三层治理资产一体化与作用域严格隔离 UI（`AgentMindView`「规则规范」×「仓库地图」与三端同源看板）**：
  - Rust (`agent_mind.rs` / `sidecar.rs`) 与 Node Sidecar (`main.mjs`) 统一扫描插件全局与 `repos.md` 登记的全部仓库（`test-bed` 标为只读禁止写入），**前端「规则规范」与「仓库地图」职责彻底隔离**：「仓库地图」专注展示宿主机仓库拓扑与 `repos/<code>.md` 仓库档案（不混入规则与门禁指标）；所有三层治理统一收敛在「规则规范」单卡视图内，通过**右上角富内容可搜索作用域下拉选择器**（默认选中 `全局通用`，下拉支持搜索并展示各仓角色/路径/资产计数/预警点）无痛切换全局或任意项目，复用**Markdown 规则与地图（含 `AGENTS.md` / `.agents/rules/*.md`、离线 `mermaid` 预览、字节/Token 红线与常驻内联 `EChartBox` 分布图（项目作用域下合并列出本仓规则与公共全局规则以真实反映会话注入构成）、Decision 决策（启用态/退役/命中追踪/JSON 编辑）与 Lint 检查（源码只读与一键运行 `run_repo_lints`）**。
- **用户主动触发复盘与清理（`/a8-improve` / `a8-improve`）**：
  - 零 Subagent 在当前主会话运行，严格遵循 `Propose Then Stop` 编号审批（`写入全部` / `写入 1, 3`）；
  - 统一承担两项职责：① 从五维纠偏信号（含跨历史 `/a8-improve <sessions>`）提炼第一性原理规则或 `scripts/lints/` 检查；② **同步清理既有规则库中的无效/过时规则、相互冲突与重复逻辑**（不再单独拆分清理指令）。
- **用户主动发起界面验收（`/a8-ui-verify` / `a8-ui-verify`）**：
  - 统一调度目标仓库 `scripts/tests/ui-verify/` 自动化测试或浏览验证流程，产物落盘至 `logs/ui-verify/`（不污染版本库），仅在需长期留存里程碑基线时写入 `docs/`。

### 2.6 DSH 深度终审 Loop 技能自完整迁移与三端同源 Dashboard 审查列表
- **插件自完整 (`agents/dsh-reviewer.md` + `skills/a8-dsh-review/`)**：将原散落在单仓库 `a8-turbo/.agents/agents/dsh-reviewer` 的子代理与脚本连根清理并迁入全局插件 `a8-agent-mind`，形成跨仓库即插即用的自完整审核能力（`/a8-dsh-review`）。
- **物理通道与推理性能调优**：
  - **默认 `medium` 推理深度 + `docs/` 上下文预打包**：`review.ps1` 通过 `dsh --patch` 默认将 `agent-default-model.config.reasoningEffort` 设为 `medium`（保留 `-Deep` 按需切换 `high`），并自动预打包 `git status` / `git diff --stat`、命中的 `AGENTS.md` / `docs/` 已备案设计决策摘录（`Get-DshDocumentedContext`，避免 DSH 脱离 `docs/` 重复误判已定案权衡）与 `scripts/lints/` 已检查声明，大幅压低每轮耗时与误报率；
  - **stdout / stderr 分离 & 沙箱只读禁 Shell**：`review.ps1` 通过 `ProcessStartInfo` 严格分离 `dsh.cmd headless` 的 `stdout`（终审正文）与 `stderr`（`dsh: reasoning:` 推理噪音），显式注入 `--permission-mode read-only --approval-policy never`，根治 Windows ACL `0xC0000142` 重试卡顿；
  - **动态会话映射 & YAGNI ($F \times S < 10$) 熔断**：基于 `-WorkspaceDir` 动态映射 `.dsh/sessions/--<Slug>--` 复用既有 Session，最多 2~3 轮收敛。
- **双通道交付与三端同源 UI 复用**：
  - 每次审核结论除正常返还主会话推进修复闭环外，自动在插件按仓库隔离归档 `reviews/<repo>/<YYYYMMDD-HHmmss>-<repo>-r<round>.md`（`plugins/a8-agent-mind/reviews/` 已纳入 `.gitignore` 不作为源码入库）并清理工作区临时 Prompt；
  - Rust 服务端 (`agent_mind.rs`) 与插件 Node Sidecar (`sidecars/panel/main.mjs`) 对齐实现 `reviews/<repo>/*.md` 递归扫描、`DshReviewRecordDto` 解析（无 Frontmatter 时支持由子目录反推 `repo`）、全文读取与删除（含空子目录回收）接口，其中 `main.mjs` 优先托管同源编译产物 `modules/devtools/ui`，实现 **Tauri 桌面端、`18765` Rust 独立看板与 `18766` 插件看板三端 100% 复用 `AgentMindView`「DSH 终审记录」按项目筛选与主从查阅视图**。

### 2.7 Harness 可观测遥测与自改进反馈闭环
- **滚动 JSONL 遥测账本（`harness_metrics.jsonl`）与检查器命中追踪**：[`decisions_client.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/skills/a8-judge/scripts/decisions_client.py) 导出 `resolve_plugin_data_dir()` 与 `append_harness_metric(event, max_entries=200)`，将 `a8-judge`、[`stop_reflect.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/hooks/stop_reflect.py)（含非文档回合 `API_ERROR` 显式遥测记录）与项目机械 Lint 运行器 [`run_repo_lints.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/scripts/run_repo_lints.py)（`source: "repo_lint"`）的每轮裁决源、触发模式（`PASS` / `PASSED` / `VIOLATED` / `AUTO_LINT` / `AUTO_DECISION` / `ASK_USER_UI` / `DOCS_MAINTENANCE` / `API_ERROR`）、置信度以及 `evaluated_ids` / `violated_ids` 检查器明细滚动记录至 `%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\harness_metrics.jsonl`（并发容错、仅保留最近 200 条不膨胀）。
- **三端同源遥测聚合与可视化（`AgentMindView`「可观测」视图）**：Rust (`parse_harness_telemetry_with_stats` in [`agent_mind.rs`](file:///e:/a8-devtools/modules/devtools/src/agent_mind.rs)) 与 Node Sidecar (`parseHarnessTelemetryWithStats` in [`main.mjs`](file:///e:/a8-devtools/plugins/a8-agent-mind/sidecars/panel/main.mjs)) 统一聚合最近 14 个自然日（`UTC+8`）趋势、逐检查器 `CheckerStatsIndex`（`eval_count` / `hit_count` / `last_eval_ts` / `last_hit_ts`）与最近 60 条事件流，经 [`AgentMindView.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/components/AgentMindView.tsx) 通过 `EChartBox` 渲染健康 KPI、14 日堆叠趋势、Grok 提案漏斗、可筛选事件明细表与「检查器效能追踪 (Decision & Lint 命中排行)」一键退役治理面板。

---

## 3. 跨仓库复用与安装路径 (Installation)

- **插件源码**：[`plugins/a8-agent-mind/`](file:///e:/a8-devtools/plugins/a8-agent-mind/)
- **全局安装**：通过 `bindflt` 直通映射挂载至 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind`
- **设计详细规约**：参见 [`plugins/a8-agent-mind/design.md`](file:///e:/a8-devtools/plugins/a8-agent-mind/design.md)
