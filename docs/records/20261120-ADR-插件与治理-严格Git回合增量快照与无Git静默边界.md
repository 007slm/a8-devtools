# ADR：严格 Git 回合增量快照（PreInvocation + Stop）与无 Git 静默边界

- **日期**：2026-11-20
- **状态**：部分失效（被 20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md 更新）
- **域**：agent-mind-governance.md, dashboard-and-workflows.md
- **取代**：20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md（第 2.5 节旧版编辑文件轨迹解析）, 20261120-ADR-插件与治理-双层文档体系与隔离Curator闭环架构.md（原基于 transcript.jsonl 的单层感知边界）

> **[部分失效（2026-11-22）]**
> 以下正文为当时历史快照。第 1 节 `PreInvocation + Stop` 回合级快照 Hook 已彻底卸载并被 [卸载 Stop Hook 并收归 `/a8-commit` 提交门禁](20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md) 取代；第 2 节 DevTools / Sidecar 界面层 `has_git` 检测与「无 Git」警示仍继续生效，现行系统真相请以 [agent-mind-governance.md](../evergreen/agent-mind-governance.md) 为准。

---

## 1. 问题与目标

- **要解决的问题**：Antigravity `Stop` Hook `stdin` 契约不携带当前 Turn `changedFiles`；原 `stop_reflect.py` 依赖解析父会话 `transcript.jsonl` 中的 `edit_file` / `write_file` 调用，导致委托子代理（如 `DeepCoder`）或通过 `run_command` 改码的回合静默漏检，且会把已撤回修改当成净变更。
- **设计目标**：完全放弃对话轨迹猜文件，改为 `PreInvocation + Stop` 严格 Git 工作区净增量快照作为唯一事实源；遇到无 Git 目录 Hook 静默失效不兜底，并在 DevTools UI 层给出显式警告。

## 2. 核心设计与结论

1. **`PreInvocation` 基线 + `Stop` Git 净增量快照**：
   - `hooks.json` 挂载 `PreInvocation`（`stop_reflect.py --pre-invocation`）：按 `(conversationId, turn_key)` 在 Turn 首次调模型前写一次轻量基线 `baseline_<digest>.json`（`head_sha` + `git status --porcelain=v1 -z -uall` 各条目 `xy` / `mtime_ns` / `size`）；
   - `Stop` 阶段重采 Git 快照并结合 `HEAD` 变化算出本 Turn 真实物理净变更文件列表（涵盖主会话、任意编码子代理、`docs-curator` 与脚本改动，排除 Turn 前已有的老脏文件），同时提取真实 `git diff --stat` 注入 Decisions API；
   - 彻底移除基于 `transcript.jsonl` 工具调用收集编辑文件的旧代码（`Reconsider when`：仅当未来 Antigravity 官方 Hook payload 直接提供结构化 `changedFiles` / `turnDiff` 或需支持非 Git 版本库时再重新评估）。
2. **无 Git 目录静默失效与 DevTools 显式警告**：
   - Hook 遇非 Git 目录或驱动器根目录直接返回 `{}` 静默退出，不做非 Git 兜底；
   - Rust（`HostProjectCardDto.has_git`）与 Node Sidecar（`parseReposMd` `has_git`）无进程遍历祖先 `.git`，并在 `AgentMindView.tsx` 与 `CodeReviewTab.tsx` 展现「无 Git」琥珀警示徽标。

## 3. 当时验证范围

- **2026-11-20 验证**：`py -3 scripts/lints/check_stop_hook_invariants.py`（19 项不变量校验，覆盖真实临时 Git 仓基线与子代理改码场景）、`cargo test --workspace`、`npm run build` 及 `run_repo_lints.py .` 全绿通过。

## 4. 对常青文档的影响

- 本决策的 `PreInvocation + Stop` 状态契约与无 Git UI 告警边界已沉淀至 [agent-mind-governance.md](../evergreen/agent-mind-governance.md) 与 [dashboard-and-workflows.md](../evergreen/dashboard-and-workflows.md)，并联动将前序两篇记录标为 `部分失效`。
