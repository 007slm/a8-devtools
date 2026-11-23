---
name: a8-dsh-review
description: "基于本机 DeepSeek Harness (DSH) 与插件自完整 dsh-reviewer 子代理的跨文件深层因果链终审技能与有界 Loop 闭环协议。触发指令包括 /a8-dsh-review、/dsh-review、/review、DSH 审核。每次审查结论同时返还主会话推进闭环，并自动归档至 plugins/a8-agent-mind/reviews/ 在 A8 DevTools / A8 Agent Mind Dashboard 中列表展示。"
---

# DeepSeek Harness Architecture Review Loop (`a8-dsh-review`)

本技能将“调用本机 DeepSeek Harness (`dsh.cmd`) 做资深架构审查同事”的能力以自完整形式内建于 `a8-agent-mind` 插件中，与同插件内的 `a8-judge`（Google Gemini Decisions API 毫秒级 4 维概率定音）形成互补：

- **`/a8-judge` (`a8-judge`)**：毫秒级零输出 Token 概率校准裁决，平时不自动触发，仅在默认 `/a8-commit` Step 3 或手动 `/a8-judge` 时对后端变更做快速红线守门；
- **`/a8-dsh-review` (`dsh-reviewer`)**：跨文件调用链、全生命周期状态机与文档/实现一致性的深度终审，并内置 **YAGNI ($F \times S < 10$) 熔断器与有界 Loop 收敛机制**，同时将每次审查记录自动持久化供 Dashboard 查阅。

---

## 一、 核心防发散铁律（打破“对抗审查死循环”）

1. **需求锚定先行（Requirements-First）**：
   - 派发 `dsh-reviewer` 时，**必须显式传入用户的原始需求、验收条件与明确不做边界（Non-Goals）**；严禁只丢一个 Diff 让 DSH 按个人偏好自由发挥。
   - **无需重复搬运 `AGENTS.md`**：DSH 通过原生 `@deepseek-ai/dsh-agent-instructions` 自动加载仓库 `AGENTS.md`，`review.ps1` 只预打包紧凑的 `git status` / `git diff --stat` 与 `scripts/lints/` 列表。
2. **只修两类真问题，默认 1~2 轮收敛（硬上限 3 轮；分歧即早停交人）**：
   - **Round 1（干净新会话首审）**：`review.ps1` 在 `Round = 1` 默认启动全新干净 DSH 会话（避免跨任务旧会话上下文串味）；
   - **主会话独立鉴别（Triage Gate，不盲听审阅器）**：仅修 **① 真实 Bug / 因果链与状态机击穿 ($F \times S \ge 10$)** 或 **② 破损/遗漏的用户需求与显式契约**；凡 $F \times S < 10$、超出需求边界的“顺便抽象/额外健壮性”以及命名/措辞风格建议，**直接拒绝改码**，更不带入下一轮；
   - **Round 2（战线冻结复审，仅当 Round 1 修改了代码时触发）**：通过 `send_message` 复用同一 `dsh-reviewer`（脚本自动传入 `-SessionId` 复用本任务会话，并由 `Get-DshTriageDisciplinePrompt -Round 2` 强制注入**战线冻结**纪律——只核验上一轮修复项是否闭环与无新回归，严禁在未改动区域另开新挑刺战线）；
   - **分歧早停 + 终态验活**：若第 2 轮仍不收敛（或主会话判定 DSH 意见偏离需求），**直接熔断停手并列清分歧交用户拍板**，严禁盲跑无意义拉锯；退出审查后必须回到宿主机按 `docs/verify.md` 跑通最小真实运行面，以**代码真的能工作**而非“审阅器开心”为终点。
3. **stdout / stderr 严格隔离与极速推理调优**：
   - `dsh.cmd headless` 将推理噪音（`dsh: reasoning:`）打印在 `stderr`，将干净终审报告输出在 `stdout`；
   - 统一通过插件内置脚本 [scripts/review.ps1](scripts/review.ps1) 执行：内部默认将 `reasoningEffort` 收敛为 **`medium`**（重大跨仓重构可传 `-Deep` 切回 `high`），使用 `ProcessStartInfo` 分离双流、注入 `--permission-mode read-only --approval-policy never`，彻底消除日志污染与 ACL `0xC0000142` 卡顿。
4. **双通道结果交付（主会话消费 + Dashboard 列表留档）**：
   - 子代理返回纯净结构化结论给当前主会话用于决策与修补；
   - 每次调用 `review.ps1` 同时按仓库隔离归档至 `<plugin_dir>/reviews/<repo>/<YYYYMMDD-HHmmss>-<repo>-r<round>.md`（带 YAML Frontmatter；`reviews/` 已纳入 `.gitignore` 不入库），**A8 Agent Mind Dashboard（Tauri 桌面端、`18765` 与 `18766` 同源看板）的“DSH 终审记录”视图实时支持按项目筛选、可全文审阅**。

---

## 二、 主会话编排执行步骤 (Orchestration Workflow)

当用户触发 `/a8-dsh-review`（或要求做 DSH 差异 review / loop 审核）时，按以下流程执行：

1. **宿主机门禁先行（Fail-Fast）**：
   - 根据当前目标仓库语言（对照其 `AGENTS.md` / `docs/verify.md` 门禁），由主会话或 `dsh-reviewer` 先跑通编译、单测与 Lint，收集真实命令输出作为证据。
2. **唤起插件内置 `dsh-reviewer` 子代理**：
   - 使用 `invoke_subagent(TypeName="dsh-reviewer", Role="DSH Architecture Reviewer", Prompt=...)`，明确传入：
     - **用户原始需求、验收条件与明确不做边界（Non-Goals）**（核心锚点，严禁省略）；
     - 目标 `WorkspaceDir`、`Repo` 名称、`Round` 轮次（首轮 `1`）、本次审查主题 `Title`；
     - 改动范围（`git diff` 摘要）与外部门禁已实测通过的证据；
     - 插件脚本物理路径：`<plugin_dir>/skills/a8-dsh-review/scripts/review.ps1`（通常位于 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind\skills\a8-dsh-review\scripts\review.ps1`）。
3. **主会话执行需求与 YAGNI 分级决策**：
   - 收到 `dsh-reviewer` 的报告后：
     - 若 `verdict` 为 `PASSED`，或仅包含 $F \times S < 10$ / 风格偏好建议：直接向用户呈现通过结果，附带归档相对路径并结束 Loop；
     - 若存在真实 Bug ($F \times S \ge 10$) 或破损需求：主会话集中修复全部有效缺陷、复跑外部门禁通过后，使用 `send_message` 唤醒同一 `dsh-reviewer` 执行第 `2` 轮战线冻结复审（硬上限不超 3 轮；若主会话与 DSH 存在需求/权衡分歧直接熔断交人拍板）。
4. **终态验活与收尾整洁**：
   - 退出审查后按 `docs/verify.md` 确认改动在真实运行表面可正常工作；`review.ps1` 默认在归档后自动清理工作区临时 `logs/dsh_prompt*.md`，严禁在目标仓库残留临时审查产物。
