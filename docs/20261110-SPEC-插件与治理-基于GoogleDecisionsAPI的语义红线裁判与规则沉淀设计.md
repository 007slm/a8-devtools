# SPEC - 基于 Google Decisions API 的语义红线裁判与规则沉淀设计

| 状态 | 起草人 | 评审人 | 日期 | 关联模块 |
| :--- | :--- | :--- | :--- | :--- |
| **APPROVED** | Antigravity AI | 007slm | 2026-11-10 | `plugins/agent-mind` |

---

## 1. 战略定位与立项背景 (Motivation)

在开发者百宝箱平台（`a8-devtools`）中，为了赋能所有现代仓库（如 `a8-turbo` 及其他后端/桌面/文档仓库）实现自动化、高质量的架构治理与经验演进闭环，彻底解决传统静态分析（ArchUnit）依赖类名正则猜度导致的高误判、高漏判泥潭，正式确立打造通用 Antigravity 插件 **`agent-mind`**。

---

## 2. 核心架构与决策记录 (Key Decisions)

### 2.1 纯 Agent-Native 插件驱动形态（砍掉冗余 CLI）
- 坚决贯彻 YAGNI 原则，不搞多余的外部 npm/pip 打包发布工具链；
- 100% 走 Antigravity 原生 Plugin 体系，由 `mind-rules.md`（全局常驻自动治理）统领，驱动 `arch-judge`（AI 自主择机只读红线裁决）与双层地图/文档随会话闭环，并与 `arch-improve`（主会话用户主动规则沉淀）及 `dsh-reviewer`（有界跨文件深度终审）正交协同。

### 2.2 语法元特征自适应路由 + Google Gemini Decisions API 裁决流水线
- **步骤一（语法元特征自适应路由）**：通过零项目硬编码的 `judge_router.py`（< 50ms），根据 Git Diff 语法元特征仅激活命中的正交维度；
- **步骤二（Google Gemini Decisions API 零输出 Token 概率校准定音）**：由 `decisions_client.py` 调用 Google Gemini Decisions API (`gemini-decision-1`)，直接以零输出 Token 模式返回每个维度的校准先验概率 (`confidence` / `probabilities`) 与布尔裁决，并映射至标准 `ArchitectureVerdict` JSON Schema；针对命中的违规维度结合只读工具核实物理行号与因果现场，输出可直接执行的修正指引。

### 2.3 4 大正交维度与纯通用元特征路由 (Zero Project Hardcoding)
将架构红线按正交关注点聚合成 4 个互不重叠的类别，杜绝“一锅端导致大模型注意力稀释丢检查项”，同时杜绝“单条调用的 Token 浪费”：
1. `lifecycle_and_evolution`：生命周期闭环、零擅自向后兼容；
2. `topology_and_boundaries`：客户端 SDK 纯净隔离、模块单向分层；
3. `concurrency_and_performance`：数据面热路径无排他锁、杜绝幽灵轮询；
4. `implementation_hygiene`：核心能力单一解析路径、错误物理第一现场保留。

通过纯通用的语法元特征（`import`、公开方法签名、`synchronized`/锁原语、`catch`/异常）实现自适应毫秒级特征路由。

### 2.4 Generative UI 紧凑型现代报表
- 自动将 Google Gemini Decisions API 结构化决断与 `/improve` 规则补丁编译为高质感 HTML 卡片，通过 `<agent-embed>` 内嵌到对话流中；
- 紧凑布局（高密度 2x2 网格、折叠审计抽屉、状态徽章与双栏摘要），自适应 Antigravity 语义设计变量。

### 2.5 AI 自主文档地图及红线终审 vs 用户主动规则沉淀闭环 (`arch-improve`)
明确区分不同治理动作的触发机制与职责边界：
- **随会话自主完成（由 `mind-rules.md` 自动驱动，无需人工调用）**：
  1. **文档与双层仓库地图同步**：目标仓库的 `docs/` 长期文档、当前仓库的**仓库大地图 (`AGENTS.md`)** 以及宿主机全局**仓库地图 (`agent-mind/repos.md`)**，在每次开发任务收尾交卷时由 Agent **自动随会话生成并同步更新**（并在 `AGENTS.md` 中写明“先查本仓仓库大地图，跨仓查全局仓库地图索引”的两级查找法则）；
  2. **语义架构红线自主择机终审 (`arch-judge`)**：凡任务涉及触及 4 大正交红线的代码、接口契约或依赖边界修改，Agent 应在本地编译测试通过后、正式交卷前**自主判断合适时机主动调用一次 `arch-judge`** 执行零输出 Token 概率裁决自检（纯文档、注释与轻量样式微调自主免检），不再依赖人工手动输入 `/judge`。
- **用户主动触发规则沉淀（`/improve` / `arch-improve`）**：专注于需要人工审慎判断的经验与品味沉淀，零 Subagent 在当前主会话运行，严格遵循 `Propose Then Stop` 编号审批（`写入全部` / `写入 1, 3`）：
  - **五维纠偏信号捕获**：覆盖显式纠偏、`Silent edit`（外部静默改码）、`Repeated nudge`（连续微调终值）、`Revert / Rejection` 及确认非显而易见决策；
  - **防膨胀过滤漏斗**：对命中既有规则却仍犯错的场景强制走 `Rewrite Stricter`（收紧重写旧规而非新增第二条）；可自动化拦截的违规优先升格为 `Make it a check`（Lint/Test/`judge_router.py`/Decisions API），规则档仅保留 1 行指针；
  - **真实性与第一性原理防膨胀质检门**：禁止编造原因（推演理由必标 `*inferred*:` 进入 `Needs your answer`）；拒绝按具体组件类别堆砌枚举规则，而是通过**第一性原理**抽取跨场景通用工程偏好并优先归并进既有原理（采用“第一性原理主干 + 具体物理判据/典型反例”并通过零上下文独立复现自测），落盘附带 `<!-- YYYY-MM-DD: "用户原话" -->` 时间戳锚点；
  - **全生命周期演化变体**：支持 `/improve <sessions>`（跨历史 `transcript.jsonl` 挖掘顽固踩坑）与 `/improve prune`（规则库合并去重、消解冲突、收紧软弱措辞）。

### 2.6 DSH 深度终审 Loop 技能自完整迁移与三端同源 Dashboard 审查列表
- **插件自完整 (`agents/dsh-reviewer.md` + `skills/dsh-review/`)**：将原散落在单仓库 `a8-turbo/.agents/agents/dsh-reviewer` 的子代理与脚本连根清理并迁入全局插件 `agent-mind`，形成跨仓库即插即用的自完整审核能力（`/dsh-review`）。
- **物理通道与收敛红线修复**：
  - **stdout / stderr 分离**：`review.ps1` 通过 `ProcessStartInfo` 严格分离 `dsh.cmd headless` 的 `stdout`（终审正文）与 `stderr`（`dsh: reasoning:` 推理噪音），彻底消除数千行中间推理混入报告；
  - **宿主机门禁先行 + 沙箱只读禁 Shell**：显式注入 `--permission-mode read-only --approval-policy never` 并在 Prompt 禁止沙箱运行 `pwsh`，根治 Windows ACL `0xC0000142` 重试卡顿；
  - **动态会话映射**：基于 `-WorkspaceDir` 动态映射 `.dsh/sessions/--<Slug>--`（支持 ASCII 与 `~XXXX` 中文编码路径）复用既有 Session；
  - **YAGNI ($F \times S < 10$) 熔断与轮次上限**：明确规定最多 2~3 轮收敛，主会话仅修补 $F \times S \ge 10$ 真实缺陷，对极端边缘直接熔断归档，杜绝无限 Loop 拉锯。
- **双通道交付与三端同源 UI 复用**：
  - 每次审核结论除正常返还主会话推进修复闭环外，自动在插件按仓库隔离归档 `reviews/<repo>/<YYYYMMDD-HHmmss>-<repo>-r<round>.md`（`plugins/agent-mind/reviews/` 已纳入 `.gitignore` 不作为源码入库）并清理工作区临时 Prompt；
  - Rust 服务端 (`agent_mind.rs`) 与插件 Node Sidecar (`sidecars/panel/main.mjs`) 对齐实现 `reviews/<repo>/*.md` 递归扫描、`DshReviewRecordDto` 解析（无 Frontmatter 时支持由子目录反推 `repo`）、全文读取与删除（含空子目录回收）接口，其中 `main.mjs` 优先托管同源编译产物 `modules/devtools/ui`，实现 **Tauri 桌面端、`18765` Rust 独立看板与 `18766` 插件看板三端 100% 复用 `AgentMindView`「DSH 终审记录」按项目筛选与主从查阅视图**。

---

## 3. 跨仓库复用与安装路径 (Installation)

- **插件源码**：[`plugins/agent-mind/`](file:///e:/a8-devtools/plugins/agent-mind/)
- **全局安装**：通过 `bindflt` 直通映射挂载至 `%USERPROFILE%\.gemini\config\plugins\agent-mind`
- **设计详细规约**：参见 [`plugins/agent-mind/design.md`](file:///e:/a8-devtools/plugins/agent-mind/design.md)
