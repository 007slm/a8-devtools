# Agent Mind (`agent-mind`)

> **面向自主智能体的工程良知与持续演进心智中枢**。融合**AI 自主择机 Google Gemini Decisions API 架构红线终审 (`arch-judge`)**、**DeepSeek Harness 有界深度终审 (`/dsh-review`)**、**用户主动触发的经验与品味规则沉淀 (`/improve`)** 及 **全局文档与双层仓库地图随会话自动治理规范 (`mind-rules.md`)**。

---

## 解决的核心痛点

1. **架构红线 AI 自主守门 (The Conscience)**：彻底告别 ArchUnit 的死板与高误判，结合语法元特征自适应路由与 Google Gemini Decisions API (`gemini-decision-1`) 零输出 Token 概率校准裁决代码物理意图与生命周期闭环；由 `mind-rules.md` 驱动 AI 在涉及 4 大正交红线的代码变更交卷前**自主择机调用一次 `arch-judge`**，无需依赖人工调用；
2. **文档与双层仓库地图随会话自动同步 (The Blueprint)**：告别各仓库复制粘贴规范文档的版本偏离痛点，全局 `mind-rules.md` 强制每次开发交卷前**自动**完成 `docs/` 文档生成与两级检索地图（单仓“仓库大地图 `AGENTS.md`” + 全局“仓库地图 `repos.md`”）同步，**无需用户手动调用 Skill**；
3. **经验与品味规则主动沉淀 (The Growth)**：当开发过程中出现人工纠偏或反复踩坑时，由**用户主动调用 `/improve`** 捕捉五维信号，基于第一性原理向上归并既有规则或补充物理判据锚点（`Rewrite Stricter` / `Make it a check`），人工确认编号后落盘，严防规则枚举膨胀；
4. **上下文防火墙 (Context Firewall)**：研发期测试静音，杜绝海量测试报错冲垮主会话；全量单测与静态审查隔离在 Subagent 沙箱中用完即焚，彻底根除拆东墙补西墙的降智死循环。

---

## 插件结构

```text
agent-mind/
├── plugin.json                 # 插件元信息
├── config.json                 # Decisions API 等运行参数配置
├── design.md                   # 核心设计与演进架构规范
├── readme.md                   # 使用与维护指南
├── repos.md                    # 宿主机全局仓库地图索引（本机数据，已 .gitignore）
├── repos/                      # 跨仓库详情卡片与关系定义（本机数据，已 .gitignore）
├── reviews/                    # DSH 终审结构化归档（按项目目录隔离 reviews/<repo>/<ts>-<repo>-r<round>.md，已 .gitignore）
├── sidecars/
│   └── panel/                  # 插件 Dashboard Web Sidecar（优先托管同源编译产物 modules/devtools/ui）
├── agents/
│   ├── arch-judge.md           # 专职语义红线审查 Subagent（只读沙箱）
│   └── dsh-reviewer.md         # 专职 DSH 深度架构终审 Subagent（外置引擎调度与收敛控制）
├── skills/
│   ├── arch-judge/             # 【能力1：AI 自主择机架构红线裁决】(arch-judge / /judge)
│   ├── arch-improve/           # 【能力2：用户主动触发规则沉淀与剪枝】(/improve)
│   ├── ui-polish/              # 【能力3：企业级秩序与极简美学的 UI 设计原则】
│   └── dsh-review/             # 【能力4：有界收敛 DSH 终审循环与归档】(/dsh-review)
└── rules/
    └── mind-rules.md           # 【全局核心】通用架构红线、AI 自主终审、文档与双层仓库地图自动治理总则
```

---

## 安装与使用

### 1. 安装插件
本目录已通过 `bindflt` 直通映射挂载至 Antigravity 用户插件目录：
- Windows: `%USERPROFILE%\.gemini\config\plugins\agent-mind`
- Linux / macOS: `~/.gemini/config/plugins/agent-mind`

### 2. 在任意仓库中触发

#### 场景 A：日常代码变更自动终审 & 跨文件 DSH 深度终审
- **日常代码变更（自动触发，无需人工调用）**：当代码改动触及 `mind-rules.md` 第三节 4 大正交架构红线时，Agent 会在本地编译测试通过后、正式交卷前**自主择机调用一次 `arch-judge`** 完成零输出 Token 语义红线裁决（亦可在需要时手动输入 `/judge` 或 `@arch-judge 审查` 强制执行）；纯文档/注释/地图同步改动则自主免检。
- **跨文件深层因果链终审（按需触发）**：若需对跨文件状态机与全生命周期闭环做深度多轮复核，输入：
```text
/dsh-review
```
插件内置 `dsh-reviewer` 子代理与 `review.ps1` 将自动复用目标仓库对应的 DSH 会话、分离推理噪音、按 YAGNI ($F \times S < 10$ 熔断) 控制在 2~3 轮内收敛；结论除直接返回主会话推进修复外，还会自动归档至 `reviews/`，可在 DevTools / Agent Mind Dashboard「**DSH 终审记录**」页查看历史列表与完整报告。

#### 场景 B：任务收尾主动沉淀规则或剪枝（反哺）
当本次会话出现了用户纠偏、手动修改（`Silent edit`）或需清理膨胀规则时，主动输入：
```text
/improve
```
或 `/improve <sessions>` / `/improve prune`。无需启动 Subagent，直接在当前会话生成紧凑型 Generative UI 交互卡片与规则/机器检查补丁草案（Diff），经人工按编号确认（`写入全部` / `写入 1, 3`）后落盘。（注：`docs/` 文档与 `AGENTS.md` / `repos.md` 由 `mind-rules.md` 驱动随会话自动同步，不依赖 `/improve`。）

#### 场景 C：日常开发自动同步文档与两级查找（自动生效）
插件已全局生效 `mind-rules.md`，Agent 在各仓库中将自动遵循：
- 查找任何模块、代码、配置或文档时，先从当前仓库的**仓库大地图 (`AGENTS.md`)** 中找；若发现不是自己仓库的，优先从全局**仓库地图 (`agent-mind/repos.md`)** 中根据索引查找；
- 符合建档清单的长期设计/故障复盘随当前会话自动生成 `docs/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`，并自动同步更新目标仓库根目录 `AGENTS.md` 索引表格；微小改动严禁滥建文档。
