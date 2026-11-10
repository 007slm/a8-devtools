---
name: arch-improve
description: "面向任务收尾的架构复盘与经验反哺技能。触发指令包括 `/improve`、`/复盘`、`/提升`、`@arch-judge 复盘`。不启动 Subagent，直接基于当前会话第一现场，提炼改动亮点、踩坑痛点与规则草案，输出紧凑型 Generative UI 交互卡片，并生成落地到 AGENTS.md / rules 的规则补丁草案。"
---

# Architecture & Workflow Improvement (`arch-improve`)

本技能专用于在**开发任务收尾（Session Wrap-up）阶段**，对当前会话的工作过程与改动进行结构化复盘，并将踩坑经验自动转化为可沉淀的工程规则与本地文档补丁。

---

## 核心设计与执行铁律

1. **绝对在主会话中运行（No Subagent）**：
   - 严禁启动 Subagent！提升建议的原材料（踩坑过程、调试报错、人机纠偏）天然存在于当前主会话的完整上下文中。
   - 在当前会话直接执行，零进程开销、零延迟，且不影响任务收尾后的会话生命周期。

2. **拒绝空洞废话与大段八股文（Actionable & Concise）**：
   - 提取的经验必须是**痛定思痛的具体事实**（如“某环境缺少动态库”、“某接口未做防抖导致死锁”、“双轨兼容残留”）；
   - 严禁生成“要注重代码质量”、“多写单测”这类毫无可操作性的空话。

3. **人机协同确认机制（Human-in-the-loop）**：
   - 生成的规则补丁必须是**草案（Draft Diff）**；
   - **严禁擅自静默修改**项目中的 `AGENTS.md`、`CLAUDE.md` 或 `.gemini/rules`。必须由人类工程师审阅、点头后方可落盘。

4. **强制配合 Generative UI 紧凑型卡片**：
   - 必须生成高颜值、高信息密度的 HTML 卡片并通过 `<agent-embed>` 内嵌呈现，让工程师一眼抓取核心产物。

---

## 执行流水线 (Execution Pipeline)

### 步骤 1：扫描会话第一现场与改动上下文
综合分析以下信息源：
- **用户原始诉求与纠偏记录**：用户纠正过 AI 哪些认知偏差？
- **调试与执行日志**：中途哪些命令失败了？报了什么错？为什么反复重试？
- **代码变动事实**：改了哪些核心文件？是否触碰了架构边界？
- **架构审查结果**：如果本轮调用过 `arch-judge`，是否有潜在架构违规或警告？

### 步骤 2：提炼双维度核心产物
输出必须收敛为两大正交维度：
1. **工作流/环境痛点（Workflow Friction & Tech Debt）**：
   - 本地开发/构建环境的暗坑、缺少的依赖、不清晰的脚本说明。
2. **规则沉淀补丁（Rule Patch Draft）**：
   - 针对本次踩坑提炼 1~2 条**可被未来 Agent 机器阅读并严格遵守的防呆规则**；
   - 明确标注目标规则文件（优先顺序：`AGENTS.md` > `.gemini/rules/` > `CLAUDE.md`）。

### 步骤 3：生成并嵌入 Generative UI 交互卡片
在 Artifact 目录创建紧凑型 HTML 报告文件（如 `retro_card.html`），并嵌入当前对话：
```html
<agent-embed src="file:///<artifact_path>/retro_card.html"></agent-embed>
```

#### Generative UI 设计规范
- 引入官方 Tailwind 脚本：`<script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>`；
- `<body class="bg-transparent text-[var(--foreground)] antialiased p-3">`；
- 全部使用宿主语义颜色变量（`bg-[var(--card)]`, `text-[var(--foreground)]`, `border-[var(--border)]`, `text-[var(--muted-foreground)]`）；
- 整体高度保持在 **280px ~ 360px** 紧凑区间，结构分为：
  - **顶部**：微徽章（`⚡ 经验沉淀`）、本次交付核心亮点（1~2 句话）；
  - **中部**：工作流优化要点 + 架构/规范补丁摘要；
  - **底部**：代码块格式的标准 `git diff` 补丁预览。

### 步骤 4：询问确认与落盘执行
在卡片下方简明询问用户：
> *“是否将上述规则草案合并写入本地 `<target_rule_file>`？回复‘写入’或‘确认’即可立即生效。”*
用户确认后，使用 `edit_file` 或 `write_file` 真正完成沉淀闭环。
