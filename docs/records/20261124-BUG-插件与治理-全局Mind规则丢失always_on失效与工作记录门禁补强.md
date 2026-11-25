# BUG：全局 Mind 规则丢失 trigger: always_on 静默失效与工作记录门禁补强

- **日期**：2026-11-24
- **状态**：已落地（当时有效）
- **域**：agent-mind-governance
- **取代**：无

---

## 1. 问题与目标

- **约束与现象**：2026-11-23 至 2026-11-24 在 `a8-turbo` 完成多轮大型改动并提交（84 文件 + 22 文件）后，未新建任何 `docs/records/` 工作记录。核查宿主会话 `<user_rules>` 发现，虽然 `a8-agent-mind` 插件处于启用状态且技能与子代理正常加载，但 `plugins/a8-agent-mind/rules/mind-rules.md` 与 `TOKENS.md` 完全未被注入会话上下文。
- **目标与非目标**：根治插件规则静默不加载并建立机械 Lint 防止再犯；收紧 `/a8-commit` Step 4 防止仅更新常青文档时跳过工作记录。不将 `mind-rules.md` 重命名为 `AGENTS.md`（避免波及 DevTools 看板、Rust 宿主、`judge_router.py` 及已有单测引用）。

## 2. 核心设计与结论

- **根因链**：
  1. `dfa83d6`（2026-11-16）精简重写 `plugins/a8-agent-mind/rules/mind-rules.md` 时误删了顶部的 `---\ntrigger: always_on\n---`，而 `TOKENS.md` 自创建起未声明 `trigger: always_on`。
  2. Antigravity 对插件 `rules/` 下非 `AGENTS.md`/`GEMINI.md` 文件要求显式 `trigger: always_on` 才会无条件注入 `<user_rules>`；缺失后 Language Server `GetAllPlugins` 不再产生 `CORTEX_MEMORY_TRIGGER_ALWAYS_ON`，导致全局规则静默空转。
  3. 叠加 `/a8-commit` Step 4 原措辞为“尚未更新 `docs/` 时补写 `docs/records/`”，导致已更新 `docs/evergreen/` 的大提交误判为文档已收口而跳过留档。
- **最终决定 / 契约**：
  1. 在 `plugins/a8-agent-mind/rules/mind-rules.md` 与 `TOKENS.md` 首行恢复 `---\ntrigger: always_on\n---`（经 `bindflt` 即时同步至 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind\`）。
  2. 在 `scripts/lints/check_workspace_hygiene.mjs` 新增机械检查 `RULE_ACTIVATION_CONTRACT`（并同步至 `a8-turbo`）：强制要求 `plugins/*/rules/*.md` 与 `.agents/rules/*.md` 中非 `AGENTS.md`/`GEMINI.md` 文件必须包含合法 YAML frontmatter `trigger:`（`always_on` / `model_decision` / `glob` / `manual`，其中 `model_decision` 必配 `description`、`glob` 必配 `globs`），`AGENTS.md`/`GEMINI.md` 则禁止带 frontmatter。
  3. 收紧 `plugins/a8-agent-mind/skills/a8-commit/SKILL.md` Step 4：明确更新 `docs/evergreen/` 不等于免写 `docs/records/`，命中架构/契约/状态机/深层根因或 `>= 5` 个生产源码文件时必须补写工作记录。
- **否决备选与代价**：否决了把 `mind-rules.md` 与 `TOKENS.md` 合并重命名为 `rules/AGENTS.md` 的方案，因为 `trigger: always_on` 经实机验证即可触发 `CORTEX_MEMORY_TRIGGER_ALWAYS_ON` 完整注入，无需改动看板、Rust 宿主与路由器多处硬引用。

## 3. 当时验证范围

- **已验证**：
  - 宿主机 `GetAllPlugins` 实机对比：补回前无 `trigger` 字段，补回后两份文件均返回 `CORTEX_MEMORY_TRIGGER_ALWAYS_ON`；
  - 新建隔离实机子代理验证：`<user_rules>` 实际出现 `C:\Users\007sl\.gemini\config\plugins\a8-agent-mind\rules\mind-rules.md` 与 `TOKENS.md`；
  - 破坏抓虫正反实证：`validateRuleActivation` 对缺 frontmatter、非法 `trigger`、缺 `description`/`globs` 与给 `AGENTS.md` 误加 frontmatter 全部准确拦截报错，合法配置返回 0 错；
  - `a8-devtools` 4 项门禁（`check_swallowed_exceptions.mjs`、`check_workspace_hygiene.mjs`、`check_work_records.mjs`、`check_plugin_agents.py`）、`judge_router.py` 单测及 `a8-turbo` `run_lints.py` 全绿。
- **未覆盖 / 依赖边界**：未重新编译 `a8-devtools.exe`（未改动 Rust 或前端源码）；`/a8-commit` Step 4 属技能提示词约束而非 git pre-commit hook，仍需在后续提交实践中观察执行率。

## 4. 对常青文档的影响

- 已同步更新 `docs/evergreen/agent-mind-governance.md`（§1 补充规则激活契约红线、§4 更新 Step 4 收口判据、§5 补全 `check_workspace_hygiene.mjs` 守卫项）与 `docs/verify.md`（D1 判据补充 `RULE_ACTIVATION_CONTRACT`）。
