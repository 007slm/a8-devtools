# `a8-improve` 按需参考：落盘模板、复盘卡片与盲测协议

> **按需加载说明**：本文件为 [`SKILL.md`](../SKILL.md) 的配套参考，仅在以下场景按需读取：① 执行 Phase 3 拼装落盘条目或 Phase 4 生成复盘卡片与 6 节确认清单；② 大幅修订 `mind-rules.md` / `a8-improve` / `a8-workflow` 需做隔离盲测时。

---

## 一、 Phase 3 自我反测门与标准落盘条目格式

### 1. 自我反测门（Self-Test Before Proposing）

在向用户展示规则草案前，**只读“第一性原理 + 物理判据锚点”与其 Why（完全屏蔽本轮对话回忆）**：
- 反问：*“一个毫无背景的新 Agent 仅凭这句话去做原先那个任务，还会因为理解过于空泛而重犯原错吗？”*
- 若答案是“仍然有可能”，说明括号内的物理判据锚点不够锋利（缺少清晰边界特征或典型反例），必须收紧锚点后再提案。

### 2. 标准落盘条目格式（含原话时间戳考古注释）

```markdown
- **[第一性原理标题]**：[跨场景通用工程偏好与因果律主干，使用“必须/严禁”，禁用“尽量/适当/优先”；保留清晰适用前提（物理判据锚点：例如具体机制边界/API约束或典型反例）]。
  - **原因 (Why)**：[用户原话原因，或经用户确认后的原因]。
  <!-- YYYY-MM-DD: "用户原话摘录或 Silent edit 物理变动摘要" -->
```

*(保留 HTML 注释中的日期与原话锚点，便于日后出现新旧意图冲突或执行 `/a8-improve` 规则库体检时快速溯源。)*

---

## 二、 Phase 4：Generative UI 卡片设计与嵌入约束

参考模板 [`../templates/improve_card.html`](../templates/improve_card.html)，在 `<Artifact Directory Path>/improve_card.html` 写入本次复盘卡片（`ArtifactMetadata`: `UserFacing: true`、`RequestFeedback: false`）并在回复中内嵌展示：

```html
<agent-embed src="file:///<artifact_path>/improve_card.html"></agent-embed>
```

**Generative UI 硬约束**：
- 引入官方 Tailwind 脚本 `<script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>`，`<body>` 使用 `<body class="bg-transparent text-[var(--foreground)] antialiased p-0 m-0">`（无外层浮雕卡片与阴影，`>= 12px` 最小字号，总高严控 `<= 450px` 防内嵌整页滚动，禁用 `100vh`/`h-screen`）；
- 严格只用宿主语义变量（`--card`、`--card-border`、`--foreground`、`--muted-foreground`、`--primary`、`--success`、`--warning`、`--error` 等与 `color-mix`），严禁 `:root` 回退或硬编码色板；
- 按实替换脚本内 `const IMPROVE_DATA = { ... }`：顶部展示量化收益徽章，左侧可勾选清单标明**防线层级 (`L1~L5` / `清理冗余`)** 与目标文件，右侧提供**「现状痛点（改前）→ 提升效果（改后）」**与**「变更补丁 (Diff)」**双视图，底部支持一键复制联动确认指令。

---

## 三、 Phase 4：结构化确认清单模板（卡片下方）

按以下 6 个固定小节呈现（**内容为空的小节直接省略**；若整场会话没有任何经验/品味纠偏，直接一行说明 `本轮会话无新增规则纠偏（零膨胀状态良好）`——“无事可学”也是优秀结果，严禁为了交差硬凑规则）：

- **`📏 候选规则与既有原理收紧 (Rules to Merge / Rewrite / Add)`**：

  | # | 触发信号 / 发现来源 | 动作 | 规则正文或清理说明 (含作用域) | Why | 目标文件 |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | 1 | `"..."` / `Silent edit` / `历史规则体检` | 新增 / 归并收紧 / 清理失效或重复 | `[第一性原理主干（物理判据/典型反例）或废弃删除原因]` | `[用户原因]` 或 `*inferred*: ...` | `mind-rules.md` / `.agents/rules/redline.md` |

- **`❓ 待你拍板 (Needs your answer)`**：汇总每条 `*inferred*:` 原因、归并至某既有原理还是单列新原理、以及**通用规范 (`mind-rules.md`) vs 本项目红线 (`.agents/rules/redline.md`)** 归属问题，每条 1 行并附 AI 推荐选项。
- **`⚔️ 规则冲突 (Conflicts)`**：并列展示现行旧规、本次新纠偏，以及保留建议。
- **`🔍 升级为机器检查 (scripts/lints/)`**：给出可直接写入 `<repo>/scripts/lints/` 的检查脚本/规则片段（报错信息需直接提示改法），以及在当前代码库中预扫描会命中的存量数量。
- **`📋 待自动化积压 (Backlog)`**：记录值得机械化（写成架构约束、静态 Lint 或核验脚本）但本轮暂不改造代码库的候选项，避免硬塞进自然语言规则污染 `mind-rules.md`。
- **`⏭️ 已跳过项 (Skipped)`**：每条 1 行写明被过滤的纠偏及跳过原因（如“一次性页面调整”或“仅单会话偶发且未过 6 个月滤网”），方便用户随时纠正“不对，这条要记”。

结尾固定提示：
> *请回复 `写入全部` 或 `写入 1, 3`（可同时回答上方待拍板问题与作用域切换）以完成落盘。*

---

## 四、 附录：大改隔离盲测验证协议（可选）

仅当大幅修订 `mind-rules.md`、`a8-improve` 或 `a8-workflow` 需检验是否过拟合时使用（日常复盘免做）：
1. 在两个独立脱敏工作区分别放置旧版与新版规则/技能；
2. 使用不含 `eval`、`test`、`rubric` 等暗示词的自然工程任务指令对比执行；
3. **不靠模型口头自报“遵守了哪些规则”**，直接审查各自 `transcript.jsonl` 实际打开了哪些文件及产出代码形态做客观裁决。
