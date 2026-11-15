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
- **步骤一（自适应路由、聚焦与 Context Engineering 降噪，`judge_router.py`）**：根据 Git Diff 文件路径与语法元特征，装配激活的全局 + 目标仓库 `*.decision.json`（按 `triggers` / `file_patterns` 精确过滤）与 Markdown 规则条目。支持 `--paths <p1,p2>` 将 Diff 提取聚焦至特定子目录或文件集，并在 `_is_relevant_source_file` 中默认过滤 `ui/dist/target/node_modules/assets/fonts`、SVG/字体/图片/二进制及纯依赖锁文件（保留 `Cargo.toml`/`package.json` 等契约清单），防止无关资产体积引发 Token 膨胀与限流降级。
- **HTML 邮件/网页高噪正文清洗助手（`scripts/strip_html_text.py`）**：零第三方依赖的流式 HTML/JSON 提取工具，在模型读入资讯或定时邮件（如 `daily-grok-ai-workflow-proposal`）前剥离 `<style>`、`<script>`、`<svg>` 与 VML 注释，压缩输出高密度纯文本。
- **步骤二（Google Gemini Decisions API 无损分片多请求裁决，`decisions_client.py`）**：彻底移除单次请求的字符截断与丢弃上限；超长 Diff 按 `diff --git` 与 `@@` hunk 无损切分为多个块（`CHUNK_DIFF_CHARS = 28000`，`diff_truncated = False`），规则问题列表按预算装箱拆分为多批（`BATCH_QUESTION_CHARS = 6000` / `BATCH_MAX_QUESTIONS = 12`，`dropped_rules = []`），经有界并发（`MAX_CONCURRENT_API_CALLS = 4`）发往 `gemini-decision-1` 并无损聚合为 `ArchitectureVerdict`（记录 `api_calls_count`、`diff_chunks_count`、`evaluated_decisions`）。

### 2.3 4 大正交维度与纯通用元特征路由 (Zero Project Hardcoding)
将架构红线按正交关注点聚合成 4 个独立决策文件（`plugins/a8-agent-mind/decisions/*.decision.json`），同时支持按项目扩展任意 `*.decision.json`：
1. `lifecycle_and_evolution`：生命周期闭环、零擅自向后兼容；
2. `topology_and_boundaries`：客户端 SDK 纯净隔离、模块单向分层；
3. `concurrency_and_performance`：数据面热路径无排他锁、杜绝幽灵轮询；
4. `implementation_hygiene`：核心能力单一解析路径、错误物理第一现场保留。

通过纯通用的语法元特征（`import`、公开方法签名、`synchronized`/锁原语、`catch`/异常）与路径模式实现自适应毫秒级路由。

### 2.4 Generative UI 紧凑型现代报表
- 自动将 Google Gemini Decisions API 结构化决断与 `/a8-improve` 规则补丁编译为高质感 HTML 卡片，通过 `<agent-embed>` 内嵌到对话流中；
- 紧凑布局（高密度 2x2 网格、折叠审计抽屉、状态徽章与双栏摘要），自适应 Antigravity 语义设计变量。

### 2.5 随会话自主治理 + `Stop` Hook 自动反射 + `/a8-improve` 经验与规则库一体化精炼
明确区分不同治理动作的触发机制与职责边界：
- **随会话自主完成（由 `mind-rules.md` 自动驱动，无需人工调用）**：
  1. **显式状态机与标准工程目录规范**：跨仓库强制多阶段生命周期采用显式状态枚举与跃迁守卫；统一约定 `.agents/rules/`（自然语言红线）、`scripts/lints/`（可执行项目 Lint）、`scripts/tests/ui-verify/`（UI 验证脚本）、`logs/ui-verify/`（运行时产物）；
  2. **文档与双层仓库地图同步**：目标仓库的 `docs/` 长期文档、当前仓库的**仓库大地图 (`AGENTS.md`)** 以及宿主机全局**仓库地图 (`a8-agent-mind/repos.md`)**，在每次开发任务收尾交卷时由 Agent **自动随会话生成并同步更新**；
  3. **语义架构红线自主择机终审 (`a8-judge`)**：凡任务涉及触及 4 大正交红线的代码、接口契约或依赖边界修改，Agent 应在本地编译测试通过后、正式交卷前**自主判断合适时机主动调用一次 `a8-judge`** 执行零输出 Token 概率裁决自检（纯文档、注释与轻量样式微调自主免检）。
- **回合结束自动反射与文档门禁（`hooks.json` + `hooks/stop_reflect.py`）**：
  - 采用 **L0 零成本预筛 + Google Decisions API 五维联合裁决**（在 `NO_TOOL_CALL` 回合终止且存在变更/纠偏信号时自动触发），按三层防线优先级路由：
    - 适合机械检测的违规（`AUTO_LINT`）：唤醒主 Agent 直接将检查写入 `<repo>/scripts/lints/` 并现场自检通过（失败或误报自动降级）；
    - 无法机械检测但可语义裁决且归属明确（`can_be_semantic_decision == "yes"` ≥ 0.80 且 `scope_conf >= 0.70` → `AUTO_DECISION`）：唤醒主 Agent 自动沉淀为结构化 `<repo>/scripts/lints/*.decision.json` 或 `plugins/a8-agent-mind/decisions/*.decision.json` 并运行 `--validate-only` 校验通过；
    - 涉及设计品味或边界不明确的经验（`ASK_USER_UI`）：渲染 Generative UI 卡片，明确区分**通用全局规范 (`mind-rules.md`)**、**结构化 Decision (`*.decision.json`)**、**本项目红线 (`.agents/rules/redline.md`)** 与 **项目检查 (`scripts/lints/`)**，交由用户确认落盘；
    - **`docs/` 文档维护严格门禁（`DOCS_MAINTENANCE`）**：当本轮修改了非文档源码/配置（排除 `AGENTS.md`、`logs/`、`scratch/`、`.gemini/antigravity/brain/`、`.gemini/config/sidecars/` 等运行态目录）却未维护 `docs/` 时，合并附加 `docs_maintenance_needed` 裁决问题；**仅当 Decisions API 明确返回 `choice == "no"` 且置信度 `>= confidence_threshold`（默认 `0.85`）时才豁免放行**，其余任意情况（返回 `yes`、置信度不足、缺省或 API 不可用）均以 `{"decision": "continue"}` 自动提示主 Agent 核查并补全 `docs/` 与 `AGENTS.md`（`_extract_recent_turn_summary` 同时将 `Stop hook blocked termination:` 续行消息识别为新回合边界，并与 `turn_fingerprint`、`continuationActive` 协同杜绝“已解释免建档仍重复拦截”的死循环）。
- **三层治理资产一体化 UI（`AgentMindView`「规则规范」与三端同源看板）**：
  - Rust (`agent_mind.rs` / `sidecar.rs`) 与 Node Sidecar (`main.mjs`) 统一扫描插件全局与 `repos.md` 登记的全部仓库（`test-bed` 标为只读禁止写入），向「规则规范」面板输出 **Markdown 规则（含条款数）、Decision 决策（含启用态/触发器/通过与拦截判据/JSON 源码编辑与新建）与 Lint 检查（含 Python 源码只读浏览）**，并在导航与顶栏直接展示各层及跨项目总计数。
- **用户主动触发复盘与清理（`/a8-improve` / `a8-improve`）**：
  - 零 Subagent 在当前主会话运行，严格遵循 `Propose Then Stop` 编号审批（`写入全部` / `写入 1, 3`）；
  - 统一承担两项职责：① 从五维纠偏信号（含跨历史 `/a8-improve <sessions>`）提炼第一性原理规则或 `scripts/lints/` 检查；② **同步清理既有规则库中的无效/过时规则、相互冲突与重复逻辑**（不再单独拆分清理指令）。
- **用户主动发起界面验收（`/a8-ui-verify` / `a8-ui-verify`）**：
  - 统一调度目标仓库 `scripts/tests/ui-verify/` 自动化测试或浏览验证流程，产物落盘至 `logs/ui-verify/`（不污染版本库），仅在需长期留存里程碑基线时写入 `docs/`。

### 2.6 DSH 深度终审 Loop 技能自完整迁移与三端同源 Dashboard 审查列表
- **插件自完整 (`agents/dsh-reviewer.md` + `skills/a8-dsh-review/`)**：将原散落在单仓库 `a8-turbo/.agents/agents/dsh-reviewer` 的子代理与脚本连根清理并迁入全局插件 `a8-agent-mind`，形成跨仓库即插即用的自完整审核能力（`/a8-dsh-review`）。
- **物理通道与推理性能调优**：
  - **默认 `medium` 推理深度 + 上下文预打包**：`review.ps1` 通过 `dsh --patch` 默认将 `agent-default-model.config.reasoningEffort` 设为 `medium`（保留 `-Deep` 按需切换 `high`），并预打包 `git status` / `git diff --stat` 与 `scripts/lints/` 已检查声明，大幅压低每轮耗时与重复全仓检索；
  - **stdout / stderr 分离 & 沙箱只读禁 Shell**：`review.ps1` 通过 `ProcessStartInfo` 严格分离 `dsh.cmd headless` 的 `stdout`（终审正文）与 `stderr`（`dsh: reasoning:` 推理噪音），显式注入 `--permission-mode read-only --approval-policy never`，根治 Windows ACL `0xC0000142` 重试卡顿；
  - **动态会话映射 & YAGNI ($F \times S < 10$) 熔断**：基于 `-WorkspaceDir` 动态映射 `.dsh/sessions/--<Slug>--` 复用既有 Session，最多 2~3 轮收敛。
- **双通道交付与三端同源 UI 复用**：
  - 每次审核结论除正常返还主会话推进修复闭环外，自动在插件按仓库隔离归档 `reviews/<repo>/<YYYYMMDD-HHmmss>-<repo>-r<round>.md`（`plugins/a8-agent-mind/reviews/` 已纳入 `.gitignore` 不作为源码入库）并清理工作区临时 Prompt；
  - Rust 服务端 (`agent_mind.rs`) 与插件 Node Sidecar (`sidecars/panel/main.mjs`) 对齐实现 `reviews/<repo>/*.md` 递归扫描、`DshReviewRecordDto` 解析（无 Frontmatter 时支持由子目录反推 `repo`）、全文读取与删除（含空子目录回收）接口，其中 `main.mjs` 优先托管同源编译产物 `modules/devtools/ui`，实现 **Tauri 桌面端、`18765` Rust 独立看板与 `18766` 插件看板三端 100% 复用 `AgentMindView`「DSH 终审记录」按项目筛选与主从查阅视图**。

### 2.7 Harness 可观测遥测与自改进反馈闭环
- **滚动 JSONL 遥测账本（`harness_metrics.jsonl`）**：[`decisions_client.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/skills/a8-judge/scripts/decisions_client.py) 导出 `resolve_plugin_data_dir()` 与 `append_harness_metric(event, max_entries=200)`，将 `a8-judge` 与 [`stop_reflect.py`](file:///e:/a8-devtools/plugins/a8-agent-mind/hooks/stop_reflect.py) 的每轮裁决源（`stop_hook` / `a8_judge`）、触发模式（`PASS` / `AUTO_LINT` / `AUTO_DECISION` / `ASK_USER_UI` / `DOCS_MAINTENANCE` / `API_ERROR`）、置信度与决策选项滚动记录至 `%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\harness_metrics.jsonl`（并发容错、仅保留最近 200 条不膨胀）。
- **三端同源遥测聚合与可视化（`AgentMindView`「可观测」视图）**：Rust (`parse_harness_telemetry` in [`agent_mind.rs`](file:///e:/a8-devtools/modules/devtools/src/agent_mind.rs)) 与 Node Sidecar (`parseHarnessTelemetry` in [`main.mjs`](file:///e:/a8-devtools/plugins/a8-agent-mind/sidecars/panel/main.mjs)) 统一聚合最近 14 个自然日（`UTC+8`）的放行 / 门禁唤醒 / 红线拦截趋势与最近 60 条事件流，经 [`AgentMindView.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/components/AgentMindView.tsx) 通过 `EChartBox` SVG ECharts 渲染健康 KPI、裁决分布环图、14 日堆叠趋势、置信度校准柱图、Grok 提案采纳漏斗与可筛选事件明细表。

---

## 3. 跨仓库复用与安装路径 (Installation)

- **插件源码**：[`plugins/a8-agent-mind/`](file:///e:/a8-devtools/plugins/a8-agent-mind/)
- **全局安装**：通过 `bindflt` 直通映射挂载至 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind`
- **设计详细规约**：参见 [`plugins/a8-agent-mind/design.md`](file:///e:/a8-devtools/plugins/a8-agent-mind/design.md)
