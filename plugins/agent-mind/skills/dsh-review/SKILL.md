---
name: dsh-review
description: "基于本机 DeepSeek Harness (DSH) 与插件自完整 dsh-reviewer 子代理的跨文件深层因果链终审技能与有界 Loop 闭环协议。触发指令包括 /dsh-review、/review、DSH 审核。每次审查结论同时返还主会话推进闭环，并自动归档至 plugins/agent-mind/reviews/ 在 DevTools / Agent Mind Dashboard 中列表展示。"
---

# DeepSeek Harness Architecture Review Loop (`dsh-review`)

本技能将“调用本机 DeepSeek Harness (`dsh.cmd`) 做资深架构审查同事”的能力以自完整形式内建于 `agent-mind` 插件中，与同插件内的 `arch-judge`（Google Gemini Decisions API 毫秒级 4 维概率定音）形成互补：

- **`/judge` (`arch-judge`)**：毫秒级零输出 Token 概率校准裁决，适合日常每次改码前后的快速红线守门；
- **`/dsh-review` (`dsh-reviewer`)**：跨文件调用链、全生命周期状态机与文档/实现一致性的深度终审，并内置 **YAGNI ($F \times S < 10$) 熔断器与有界 Loop 收敛机制**，同时将每次审查记录自动持久化供 Dashboard 查阅。

---

## 一、 核心防发散铁律（彻底解决 Loop 死循环与慢响应）

1. **有界迭代上限（Hard Cap = 2~3 轮）**：
   - 标准终审 Loop **最多执行 2~3 轮**，严禁无休止送审。
   - **Round 1（深度首审）**：外部门禁通过后唤起 `dsh-reviewer` 执行首轮跨文件因果链审查；
   - **主会话独立鉴别（Triage Gate，必须亲自把关）**：主会话拿到 `dsh-reviewer` 返回的每条意见后，**必须逐条评估发生频率 $F \in [1,10]$ 与严重度 $S \in [1,10]$**：
     - **$F \times S \ge 10$（真实缺陷 / 架构红线破坏 / 契约不一致）**：必须修改代码，并重跑宿主机编译/单测/Lint 门禁；
     - **$F \times S < 10$（本机单人极端边缘、假想并发、未请求的额外健壮性需求）**：**立即执行 YAGNI 熔断**，记录为已知非阻塞边界，**严禁修改代码**，更不得为了安抚审阅器而把它们留到下一轮重审！
   - **Round 2（闭环复审，仅当 Round 1 修改了代码时触发）**：通过 `send_message` 复用同一个 `dsh-reviewer` 子代理（脚本自动复用同一 DSH Session，避免全仓重扫），仅核验 Round 1 的修复项。若无新的 $F \times S \ge 10$ 真实缺陷，**即刻终止 Loop 收口交付**。
2. **stdout / stderr 严格隔离与沙箱禁 Shell**：
   - `dsh.cmd headless` 将推理噪音（`dsh: reasoning:`）打印在 `stderr`，将干净终审报告输出在 `stdout`；
   - 统一通过插件内置脚本 [scripts/review.ps1](scripts/review.ps1) 执行，内部使用 `ProcessStartInfo` 分离双流、注入 `--permission-mode read-only --approval-policy never`，彻底消除 `2>&1` 日志污染与 ACL `0xC0000142` 重试卡顿。
3. **双通道结果交付（主会话消费 + Dashboard 列表留档）**：
   - 子代理返回纯净结构化结论给当前主会话用于决策与修补；
   - 每次调用 `review.ps1` 同时按仓库隔离归档至 `<plugin_dir>/reviews/<repo>/<YYYYMMDD-HHmmss>-<repo>-r<round>.md`（带 YAML Frontmatter；`reviews/` 已纳入 `.gitignore` 不入库），**Agent Mind Dashboard（Tauri 桌面端、`18765` 与 `18766` 同源看板）的“DSH 终审记录”视图实时支持按项目筛选、可全文审阅**。

---

## 二、 主会话编排执行步骤 (Orchestration Workflow)

当用户触发 `/dsh-review`（或要求做 DSH 差异 review / loop 审核）时，按以下流程执行：

1. **宿主机门禁先行（Fail-Fast）**：
   - 根据当前目标仓库语言（对照其 `AGENTS.md` 门禁），由主会话或 `dsh-reviewer` 先跑通编译、单测与 Lint，收集真实命令输出作为证据。
2. **唤起插件内置 `dsh-reviewer` 子代理**：
   - 使用 `invoke_subagent(TypeName="dsh-reviewer", Role="DSH Architecture Reviewer", Prompt=...)`，明确告知：
     - 目标 `WorkspaceDir`、`Repo` 名称、`Round` 轮次（首轮 `1`）、本次审查主题 `Title`；
     - 改动范围（如 `git diff` 摘要或对应 SPEC 文档）与外部门禁已实测通过的证据；
     - 插件脚本物理路径：`<plugin_dir>/skills/dsh-review/scripts/review.ps1`（通常位于 `%USERPROFILE%\.gemini\config\plugins\agent-mind\skills\dsh-review\scripts\review.ps1`）。
3. **主会话执行 YAGNI ($F \times S$) 分级与决策**：
   - 收到 `dsh-reviewer` 的报告后：
     - 若 `verdict` 为 `PASSED`，或仅包含 $F \times S < 10$ 的已知边缘提醒：直接向用户呈现通过结果，附带归档相对路径（如 `reviews/a8-devtools/20261114-175230-a8-devtools-r1.md`）并提醒可在 Dashboard「DSH 终审记录」页查看，结束 Loop。
     - 若存在 $F \times S \ge 10$ 的有效阻断项：主会话集中修复全部有效缺陷、复跑外部门禁通过后，使用 `send_message` 唤醒同一 `dsh-reviewer` 执行第 `N+1` 轮复审（最多至第 3 轮）。
4. **收尾整洁**：
   - `review.ps1` 默认在归档后自动清理工作区临时 `logs/dsh_prompt*.md`；严禁在目标仓库残留未清理的临时审查产物。
