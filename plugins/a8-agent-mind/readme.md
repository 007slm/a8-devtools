# A8 Agent Mind (`a8-agent-mind`)

> **面向自主智能体的工程良知与持续演进心智中枢**。融合**AI 自主择机 Google Gemini Decisions API 架构红线终审 (`a8-judge`)**、**DeepSeek Harness 有界深度终审 (`/a8-dsh-review`)**、**经验沉淀与规则库清理 (`/a8-improve`)**、**独立 UI 验证 (`/a8-ui-verify`)** 及 **全局文档与双层仓库地图随会话自动治理规范 (`mind-rules.md`)**。

---

## 解决的核心痛点

1. **架构红线 AI 自主守门 (The Conscience)**：彻底告别 ArchUnit 的死板与高误判，结合语法元特征自适应路由与 Google Gemini Decisions API (`gemini-decision-1`) 零输出 Token 概率校准裁决代码物理意图与生命周期闭环；由 `mind-rules.md` 驱动 AI 在涉及 4 个核心架构维度的代码变更交卷前**自主择机调用一次 `a8-judge`**，无需依赖人工调用；
2. **双层文档、共享术语表与地图随会话治理 (The Blueprint)**：全局 `mind-rules.md` 确立 **共享术语表 (`docs/glossary.md`) + 常青文档 (`docs/evergreen/*.md`) + 按日期工作记录 (`docs/records/YYYYMMDD-*.md`) + 暂缓区 (`docs/deferred/`)** 分域结构；不在术语表中的非通用概念须补入术语表或用普通话直接解释，严禁未定义黑话；日常简单修改免建档，触及系统真相时由 `Stop` Hook 经 Decisions API 判定后交由隔离上下文子代理 `docs-curator` 对照真实源码同步常青文档与 `AGENTS.md`（直接挂接常青索引）；
3. **后置品味轻提示 + 主动经验精炼 (The Growth)**：回合结束时 `Stop` Hook 会自动屏蔽 `/plan` 规划、待审批计划与运行中后台任务，仅在代码落地验证后且命中既有规则未覆盖的高维工程品味时通过 `ASK_USER_UI` 轻提示审批（绝不静默写盘，具体 Bug Fix 归入 `docs/`）；主动调用 `/a8-improve` 时一方面捕捉五维纠偏信号（含跨历史 `/a8-improve <sessions>`），另一方面同步清理无效、冲突与重复规则；
4. **独立界面验证与 DSH 极速终审 (`a8-ui-verify` / `a8-dsh-review`)**：标准化目标仓库 `scripts/tests/ui-verify/` 与 `logs/ui-verify/`，提供 `/a8-ui-verify` 一键界面验证；DSH 终审默认 `medium` 推理深度并预打包 diff 摘要；
5. **上下文防火墙 (Context Firewall)**：研发期测试静音，杜绝海量测试报错冲垮主会话；全量单测与静态审查隔离在 Subagent 沙箱中用完即焚，彻底根除拆东墙补西墙的降智死循环。

---

## 插件结构

```text
a8-agent-mind/
├── plugin.json                 # 插件元信息
├── hooks.json                  # Stop 自动反射钩子 (stop_reflect.py)
├── config.json                 # Decisions API 等运行参数配置
├── hooks/
│   └── stop_reflect.py         # 未收口回合屏蔽 + 高维品味双门禁 (ASK_USER_UI / DOCS_MAINTENANCE)
├── design.md                   # 核心设计与演进架构规范
├── readme.md                   # 使用与维护指南
├── repos.md                    # 宿主机全局仓库地图索引（本机数据，已 .gitignore）
├── repos/                      # 跨仓库详情卡片与关系定义（本机数据，已 .gitignore）
├── reviews/                    # DSH 终审结构化归档（按项目目录隔离 reviews/<repo>/<ts>-<repo>-r<round>.md，已 .gitignore）
├── sidecars/
│   └── panel/                  # 插件 Dashboard Web Sidecar（优先托管同源编译产物 modules/devtools/ui）
├── agents/
│   ├── arch-judge.md           # 专职语义红线审查 Subagent
│   ├── docs-curator.md         # 专职双层文档整合与常青真源核验 Subagent
│   └── dsh-reviewer.md         # 专职 DSH 深度架构终审 Subagent（外置引擎调度与收敛控制）
├── skills/
│   ├── a8-judge/               # 【能力1：AI 自主择机架构红线裁决】(a8-judge / /a8-judge)
│   ├── a8-improve/             # 【能力2：经验沉淀与无效/重复规则清理】(/a8-improve)
│   ├── a8-ui-verify/           # 【能力3：跨仓库自动化 UI 验证】(/a8-ui-verify)
│   ├── a8-ui-polish/           # 【能力4：企业级秩序与极简美学的 UI 设计原则】
│   └── a8-dsh-review/          # 【能力5：极速有界收敛 DSH 终审循环与归档】(/a8-dsh-review)
└── rules/
    └── mind-rules.md           # 【全局核心】通用架构红线（含显式状态机）、标准工程目录、AI 自主终审与地图治理总则
```

---

## 安装与使用

### 1. 安装插件
本目录已通过 `bindflt` 直通映射挂载至 Antigravity 用户插件目录：
- Windows: `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind`
- Linux / macOS: `~/.gemini/config/plugins/a8-agent-mind`

### 2. 在任意仓库中触发

#### 场景 A：日常代码变更自动终审 & 跨文件 DSH 深度终审
- **高风险架构变更（高门槛自主终审，常规局部改动免检）**：仅当改动触及跨模块边界、核心契约/依赖调整、并发锁/状态机重构或兼容清理时，Agent 才会在本地编译测试通过后、正式交卷前**自主择机调用一次 `a8-judge`**（常规局部功能、UI、局部修 Bug、文档更新及同任务内的微调均免检，杜绝高频增量复核；需要时可手动输入 `/a8-judge` 强制执行）。
- **跨文件深层因果链终审（按需触发）**：若需对跨文件状态机与全生命周期闭环做深度多轮复核，输入：
```text
/a8-dsh-review
```
插件内置 `dsh-reviewer` 子代理与 `review.ps1` 将自动复用目标仓库对应的 DSH 会话、分离推理噪音、按 YAGNI ($F \times S < 10$ 熔断) 控制在 2~3 轮内收敛；结论除直接返回主会话推进修复外，还会自动归档至 `reviews/`，可在 A8 DevTools / A8 Agent Mind Dashboard「**DSH 终审记录**」页查看历史列表与完整报告。

#### 场景 B：后置品味轻提示与主动 `/a8-improve`（规则沉淀 + 清理）
- **回合结束反射与文档门禁（Stop Hook）**：`stop_reflect.py` 在 `/plan` 规划讨论、待批计划或后台任务运行期间保持静默（跨轮保留未消费纠偏水位），绝不未经确认静默写入任何规则或 Decision 文件；仅在真实代码落地后，针对全新高维工程品味（排除具体 Bug Fix 细节与既有规则已覆盖项）弹出 `ASK_USER_UI` 确认卡由你拍板，并守护 `docs/` 文档维护闭环。
- **主动全面复盘与规则清理**：输入 `/a8-improve` 或 `/a8-improve <sessions>`，无需启动 Subagent，直接在当前会话一次性完成新经验提炼及历史规则库中的**无效、过时与重复逻辑清理**，确认编号后落盘。

#### 场景 C：独立触发自动化界面验收 (`/a8-ui-verify`)
需要真机浏览器端到端检查界面状态与接口异常时，输入 `/a8-ui-verify`：优先调度目标仓库 `scripts/tests/ui-verify/` 自动化测试（兼容既有测试套件索引），截图与报告产物统一落盘 `logs/ui-verify/`（自动被 `.gitignore` 忽略）。

#### 场景 D：日常开发自动同步文档与两级查找（自动生效）
插件已全局生效 `mind-rules.md`，Agent 在各仓库中将自动遵循：
- 查找任何模块、代码、配置或文档时，先从当前仓库的**仓库大地图 (`AGENTS.md`)** 并按需阅读命中的 **`docs/evergreen/` 常青文档**（仅在深挖历史背景或排障细节时顺回链查阅 `docs/records/`）；跨仓库问题优先查全局**仓库地图 (`a8-agent-mind/repos.md`)**；
- 触及架构/契约/状态机/深层根因的变更在 `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md` 写入轻量工作记录，由 `docs-curator` 核验真实源码后同步 `docs/evergreen/*.md` 与根目录 `AGENTS.md` 常青索引；常规局部改动与简单 Bug 修复严禁滥建文档。
