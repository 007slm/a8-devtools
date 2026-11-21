# SPEC：基于 Google Decisions API 的语义红线裁判与规则沉淀设计

- **日期**：2026-11-10
- **状态**：部分失效（被 20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md, 20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md 更新）
- **域**：agent-mind-governance.md
- **取代**：无

> **[部分失效（2026-11-20 补标）]**
> 本文确立的 Google Decisions API 三层治理漏斗、4 个核心裁决维度、`/a8-judge`、`/a8-dsh-review`、`/a8-improve` 与遥测闭环仍有效；但第 2 节中原先约定的“单层 `AGENTS.md` + `docs/INDEX.md` 索引归档规范”与“`Stop` Hook 解析 `transcript.jsonl` 收集变更文件”方案已分别被 [20261120 双层文档 ADR](20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md) 与 [20261120 严格 Git 快照 ADR](20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md) 取代，现行真相请以 [agent-mind-governance.md](../evergreen/agent-mind-governance.md) 为准。

---

## 1. 问题与目标

- **要解决的问题**：传统静态分析工具（如 ArchUnit 类正则）依赖类名约定导致高误报与高漏判，且工作流缺乏跨仓库共享的高阶架构裁决、规则生命周期治理与可观测闭环。
- **设计目标**：打造纯 Agent-Native 的全局插件 `a8-agent-mind`，建立 `Lint > Decision > Rule` 三层治理漏斗，整合架构红线裁决（`a8-judge`）、有界深度终审（`a8-dsh-review`）、自主经验沉淀与去噪清理（`/a8-improve`）及全链路遥测面板。

## 2. 核心设计与结论

1. **三层治理漏斗与对称双域存储**：确定性 Lint（`scripts/lints/*.py|*.mjs`）> 结构化语义 Decision（`*.decision.json`）> 自然语言规则（`mind-rules.md` / `.agents/rules/*.md`）。全局 4 个互不重叠核心决策（`lifecycle_and_evolution`、`topology_and_boundaries`、`concurrency_and_performance`、`implementation_hygiene`）固化于插件 `decisions/`，各仓库专属规则、Decision 与 Lint 置于目标仓 `.agents/rules/` 与 `scripts/lints/`。
2. **`judge_router.py` 变更指针路由 + `decisions_client.py` 无损分片初筛**：
   - 将 Git Diff 作为变更指针，提取元特征（锁原语、异常、公开签名等）并加载 `AGENTS.md` 关联设计文档上下文，过滤锁文件与构建产物噪音；
   - `decisions_client.py` 按 `diff --git` 与 `@@` hunk 无损分片（`CHUNK_DIFF_CHARS = 28000`、`BATCH_QUESTION_CHARS = 6000`、`BATCH_MAX_QUESTIONS = 12`、`MAX_CONCURRENT_API_CALLS = 4`），并发调用 `gemini-decision-1` 供 `arch-judge`（配置显式 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`）结合全仓源码作最终裁决。
3. **`Stop` Hook 方案 B（未收口回合抑制 + 双重品味门禁）**：
   - 未收口回合（`/plan`、`RequestFeedback == true`、`ask_question`、未完结子代理）静默返回 `{}` 且不推进 `last_taste_step`；脱敏明文密钥（`_redact_secrets`）与隔离外部粘贴注入（`_sanitize_external_pastes`）；
   - 高维品味门禁要求同时通过 `has_high_level_taste_lesson`（>= 0.90）与 `is_distinct_from_bugfix_detail`（>= 0.85），仅通过 `ASK_USER_UI` 卡片编号审批后落盘，彻底废除静默写盘 `AUTO_LINT`/`AUTO_DECISION`；`DOCS_MAINTENANCE` 对真实源码改动作文档维护兜底提示（*注：变更文件感知现已升级为严格 Git 快照，见 20261120 ADR*）。
4. **DSH 自完整终审（`/a8-dsh-review`）与 `/a8-improve` 双向精炼**：
   - `review.ps1` 预打包 `docs/` 设计上下文、使用 `-PermissionMode read-only` + `stdout/stderr` 分离与动态 `.dsh/sessions/` 复用，自动归档至 `reviews/<repo>/` 并接入三端同源看板；
   - `/a8-improve` 同步负责从五维纠偏信号沉淀新规则并清理冗余/冲突旧规则；`/a8-ui-verify` 统一验收脚本落点；`TOKENS.md`（< 1KB）守卫上下文节流。
5. **Harness 可观测遥测与作用域隔离 UI**：`harness_metrics.jsonl` 分池保留最近 200 条 Hook 记录与 1000 条检查器评估，支撑规则预算 ECharts、14 日趋势图与“长期零违规决策/Lint 清理闭环”。

## 3. 当时验证范围

- **2026-11-10～19 迭代验证**：`scripts/lints/` 全部检查（`PLUGIN_AGENT_FRONTMATTER`、`STOP_HOOK_INVARIANTS`、`NO_SWALLOWED_EXCEPTIONS`、`WORKSPACE_HYGIENE`）及 `cargo test --workspace`、`npm run build` 验证通过；后续 2026-11-20 两项 ADR 已接管双层文档与 Git 增量感知演进。

## 4. 对常青文档的影响

- 本设计保留的有效核心契约已全面沉淀至 [agent-mind-governance.md](../evergreen/agent-mind-governance.md)；文中过时的单层文档规则与旧版轨迹解析描述仅作演进背景保留。
