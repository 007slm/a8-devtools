# ADR：卸载 Stop Hook 并将红线审查与文档核验收归 a8-commit 提交门禁

- **日期**：2026-11-22
- **状态**：已落地（当时有效）
- **域**：agent-mind-governance.md
- **取代**：20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md（第 1 节 PreInvocation + Stop 钩子）

---

## 1. 问题与目标

- **约束与现象**：每轮对话结束触发 `PreInvocation + Stop` Hook（`stop_reflect.py`）存在双重低效：① 多轮连续开发半成品期间每回合仍需做 Git 快照与 Decisions API 判定，打断节奏且耗费调用；② 真正高价值的 4 维度架构红线审查（`decisions_client.py` + `arch-judge`）此前仅靠自然语言规则“交卷前自主择机触发”，容易在开发途中过早运行或提交前遗漏。
- **目标与非目标**：
  - **目标**：彻底卸载 `PreInvocation + Stop` Hook（方案 A），把「Decisions API 概率初筛 → 按需 `arch-judge` 语义终审 → 重大变更文档收口」全部收归 `/a8-commit` 作为提交前**强制必经闸门**（不设 `fast` 跳过口）；
  - **非目标**：不移除 DevTools / Sidecar 界面层的 `has_git` 警示与历史 `harness_metrics.jsonl` 兼容读取；经验沉淀保留独立 `/a8-improve`，夜间 20:00 `scan_docs_sync.mjs` 定时全量梳理维持不变。

## 2. 核心设计与结论

- **物理卸载回合级 Hook（零僵尸代码）**：
  - 删除 `plugins/a8-agent-mind/hooks.json`、`plugins/a8-agent-mind/hooks/stop_reflect.py` 与 `scripts/lints/check_stop_hook_invariants.py`；
  - 同步更新 `scripts/release.mjs`（4 项门禁改为异常保留、仓库卫生、Agent Frontmatter 与 `check_work_records.mjs`）、`AgentMindView.tsx` 遥测提示文案及全仓地图/规范文档。
- **`/a8-commit` 升级为强制 6 步提交前质量闸门**：
  - 仅在用户显式触发 `/a8-commit` 时运行，但提交前**绝对强制**执行：① 敏感/无关文件硬拦截；② 仓内编译与 Lint 门禁；③ 三段式红线审查（`judge_router.py` 路由 → 激活维度必跑 `decisions_client.py` → 告警/异常或高危架构面必跑 `arch-judge`，`VIOLATED` 硬阻断、`REQUIRES_APPROVAL` 须用户拍板，无 `fast` 旁路）；④ 重大变更当前上下文文档收口（禁起 `docs-sync`）；⑤ 原子拆分 + 中文两档模板（绝对无 AI 署名）+ `commit/push`（`nopush`/`onlycommit` 仅本地提交）；⑥ 水位同步与汇总表。
- **否决备选与重评触发条件**：
  - 否决“保留极简 `Stop` Hook 专做品味弹窗”与“`/a8-commit fast` 跳过审查口”，避免日常回合仍有隐式拦截风险或紧急口演变成常态绕过；
  - 重评触发条件：若未来需支持完全不走 Git 提交的非版本库工作区实时文档守护，再考虑按需手动巡检命令。

## 3. 当时验证范围

- **已验证**：`modules/devtools/web` 执行 `npm run build`（同步三端 IIFE 产物）、`cargo check --workspace`、`cargo test --workspace`、`scripts/release.mjs --dry-run`、全仓 4 项静态门禁（`check_swallowed_exceptions.mjs`、`check_workspace_hygiene.mjs`、`check_work_records.mjs`、`check_plugin_agents.py`）、`judge_router.py .` 与 `scan_docs_sync.mjs` 全部通过，且所有受限 `.md` 均 `< 20,000 B`。
- **未覆盖 / 依赖边界**：本轮未在真实线上 Gemini API 网络故障场景下端到端实测 `/a8-commit` Fail-Closed 阻断流程，待下次调用 `/a8-commit` 实战校验。

## 4. 对常青文档的影响

- 更新 [agent-mind-governance.md](../evergreen/agent-mind-governance.md) §4、§5、§6 与 [AI-研发工作流可视化指南.html](../evergreen/AI-研发工作流可视化指南.html) 图 03/04A，挂载本 ADR 回链，并对 [20261120-ADR](20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md) 就地加注 `部分失效` 横幅；
- 更新 [AGENTS.md](../../AGENTS.md)、[docs/verify.md](../verify.md)（D1/D5）与 [docs/glossary.md](../glossary.md)。
