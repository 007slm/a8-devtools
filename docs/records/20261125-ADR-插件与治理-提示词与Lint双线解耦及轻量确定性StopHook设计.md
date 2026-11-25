# ADR：提示词与 Lint 双线解耦及轻量确定性 Stop Hook 设计

- **日期**：2026-11-25
- **状态**：已落地（当时有效）
- **域**：agent-mind-governance.md
- **取代**：20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md（第 1 节“零 Stop Hook”边界）

---

## 1. 问题与目标

- **约束与现象**：此前全局 `mind-rules.md`、`a8-workflow/SKILL.md` 与仓库根目录 `AGENTS.md` 直接把 `scripts/lints/` 路径与具体脚本名写进常驻提示词，导致 Agent 在写代码或工作记录前主动用 `read_file` 翻阅 Lint 源码“背考点”（单次耗时 45 秒并白耗上下文 Token），把「提示词规范要求」与「代码静态检查」混成了同一条线。
- **目标与非目标**：
  - **目标**：物理拆分两条线——① 提示词只描述规范要求与模板，不再在常驻规则与 `AGENTS.md` 中暴露具体 Lint 脚本路径；② 恢复极轻本地确定性 `Stop` Hook（`plugins/a8-agent-mind/hooks.json` + `hooks/stop_lint.py`），在模型改完文件准备结束回合时自动静默跑 `<repo>/scripts/lints/`，仅在发现违规时回传报错与改法；
  - **非目标**：绝不恢复回合级 LLM 语义评审或远端 Decisions API 调用（架构红线语义审查与重大变更文档收口继续留在 `/a8-commit` 提交闸门）。

## 2. 核心设计与结论

- **治理三线分离总原则（固化为顶层规范）**：
  - **Rule 写提示词**：`mind-rules.md` 与单仓 `.agents/rules/` 只写面向模型的规范要求，绝不暴露具体 Lint 脚本路径或实现细节；
  - **Lint 在会话 `Stop` 后做机械检查**：本地确定性 `Stop` Hook（0 Token、不调 LLM）自动执行 `<repo>/scripts/lints/` 并在违规时回传报错与改法（`/a8-commit` Step 2 兜底复核）；
  - **Decision 在 `commit` 之前做判定**：跨文件语义红线裁决（`*.decision.json` + `arch-judge`）严格收归 `/a8-commit` Step 3（或手动 `/a8-judge`），日常绝不自动触发。
- **极轻确定性 `Stop` Hook（`plugins/a8-agent-mind/hooks/stop_lint.py`）**：
  - 通过插件根目录 `hooks.json` 注册 `a8-repo-lint`（`Stop` 事件，timeout `25s`，命令 `py -3 hooks/stop_lint.py`），直接复用 `scripts/run_repo_lints.py` 单一路径执行 `<repo>/scripts/lints/`（纯本地确定性，0 Token、不联网、Windows 全程 `CREATE_NO_WINDOW` 零黑窗）；
  - **5 道零打扰与防死循环守卫**：① 仅处理 `terminationReason == "NO_TOOL_CALL"`；② `continuationActive == true` 直接返回 `{}` 放行，确保单回合最多自动拉回修复 1 次；③ 逆序快扫 `transcriptPath` 尾部 512 KB 至最近一条 `USER_INPUT`，本轮未调用任何写工具（`write_file`/`edit_file`/`run_command` 等）时 `< 5ms` 放行；④ 目标仓无 `scripts/lints/` 或 `git status --porcelain=v1 -uall` 为空时直接放行；⑤ 异常或超时按 Fail-Open 返回 `{}`（硬阻断兜底在 `/a8-commit` Step 2）；
  - 仅在 Lint 失败时记录 `stop_hook`（`mode: "LINT_GATE"`, `verdict: "continue"`）遥测，并截断拼接核心 `[FAIL]` 报错（上限 2500 字符），明确提示模型直接按报错修正且无需翻阅 `scripts/lints/` 源码。
- **Prompt 线彻底剥离 Lint 实现细节**：
  - 清理 `plugins/a8-agent-mind/rules/mind-rules.md`、`plugins/a8-agent-mind/skills/a8-workflow/SKILL.md` 与 `AGENTS.md` 中的具体 Lint 脚本文件名与日常手动跑 `scripts/lints/` 要求，改为声明规范本身并明确静态 Lint 由 `Stop` Hook 与 `/a8-commit` 自动兜底。
- **否决备选与重评触发条件**：
  - 否决方案 A（`PostToolUse` 写后单文件检查 + `PreInvocation` 旁路状态文件注入）：Antigravity 当前 `PostToolUse` 契约仅接受 `{}` 输出，无法直接向模型回传报错，需额外维护按 `conversationId` 隔离的临时告警队列与 `Stop` 双重兜底，复杂度高于方案 B；
  - 否决方案 C（仅靠 `PreToolUse` 拦 `git commit`）：开发途中的文档格式与卫生违规要拖到提交时才暴露；
  - 重评触发条件：若未来 Antigravity `PostToolUse` 原生支持向模型注入校验反馈，或单仓静态 Lint 全量耗时超过 8 秒影响回合交互流畅度，再切为按改动文件路由的增量 `PostToolUse` 模式。

## 3. 当时验证范围

- **已验证**：`py -3 -m unittest plugins/a8-agent-mind/hooks/test_stop_lint.py` 覆盖 6 项不变量（非正常结束、防死循环 `continuationActive`、只读回合过滤、写工具识别、绿灯静默、失败拦截格式）；以真实 `stdin` JSON 调用 `py -3 hooks/stop_lint.py` 实测纯绿放行与临时破坏 `docs/records/` 样本的正反双证拦截（验完已删除样本）；全仓 4 项静态门禁与 `cargo check --workspace` 通过。
- **未覆盖 / 依赖边界**：Antigravity 宿主热加载 `plugins/a8-agent-mind/hooks.json` 需在下一轮实际编辑会话中由宿主生命周期端到端触发观察（受宿主插件缓存加载周期影响）。

## 4. 对常青文档的影响

- 更新 [agent-mind-governance.md](../evergreen/agent-mind-governance.md) §1、§2、§4、§6 与回链清单，并将 [20261122-ADR](20261122-ADR-插件与治理-卸载StopHook并将红线审查与文档核验收归a8-commit提交门禁.md) 状态更新为 `部分失效`；
- 更新 [AGENTS.md](../../AGENTS.md) 交卷门槛与 [docs/verify.md](../verify.md) D5 验证执行卡。
