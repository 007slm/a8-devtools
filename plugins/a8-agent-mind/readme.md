# A8 Agent Mind (`a8-agent-mind`)

> **面向自主智能体的工程良知与持续演进心智中枢**（9 大核心技能：3 个自动内功 + 6 个手动大招）。融合**精简研发主线工作流 (`a8-workflow`)**、**事前提示词深化重写 (`/a8-prompt`)**、**开发决策过程 TSV 账本 (`/a8-trace`)**、**Google Gemini Decisions API 架构红线裁决 (`a8-judge`)**、**DeepSeek Harness 有界深度终审 (`/a8-dsh-review`)**、**标准化 Git 提交强制门禁 (`/a8-commit`)**、**经验沉淀与规则库清理 (`/a8-improve`)**、**独立 UI 验证 (`/a8-ui-verify`)**、**UI 设计规范 (`a8-ui-design`)** 及 **全局文档与双层仓库地图治理规范 (`mind-rules.md`)**。

---

## 解决的核心痛点

1. **提交前强制红线闸门 (`/a8-commit` + `a8-judge`)**：彻底卸载每轮对话结束的 `Stop` Hook，日常编码零打扰；默认 `/a8-commit` 提交代码前**强制**跑完「敏感文件拦截 → 确定性 Lint → `judge_router.py` 路由 + Google Gemini Decisions API 初筛 → 告警/高危面 `arch-judge` 全仓语义终审 → 文档收口」（支持用户显式传 `fast` 仅跳过语义红线审查、`nopush` 仅本地提交，亦可开发途中手动 `/a8-judge`）；
2. **快慢双轨文档、共享术语表与地图治理 (The Blueprint)**：全局 `mind-rules.md` 确立 **共享术语表 (`docs/glossary.md`) + 验证地图 (`docs/verify.md`) + 常青文档 (`docs/evergreen/*.md`) + 按日期工作记录 (`docs/records/YYYYMMDD-*.md`) + 暂缓区 (`docs/deferred/`)** 分域结构；不在术语表中的非通用概念须补入术语表或用普通话直接解释，严禁未定义黑话；日间开发与 `/a8-commit` 提交前由当前对话顺手轻更新常青与地图（不额外起子代理），每晚 20:00 定时任务配合 `scripts/scan_docs_sync.mjs` 与 `docs-sync` 对有变动仓库做全量深度梳理（仅写盘不提交）；
3. **主动经验精炼与规则库体检 (`/a8-improve`)**：彻底取消回合级静默/弹窗打扰，只需输入 `/a8-improve`，由 Agent 自主决定按需抽查本机近期历史会话做跨会话交叉验证（确认是否值得沉淀）、提取五维纠偏信号、优先升格为静态检查并同步清理无效/冲突/重复规则，经交互式卡片编号确认后落盘；
4. **独立界面验证与 DSH 极速终审 (`a8-ui-verify` / `a8-dsh-review`)**：标准化目标仓库 `scripts/tests/ui-verify/` 与 `logs/ui-verify/`，提供 `/a8-ui-verify` 一键界面验证；DSH 终审默认 `medium` 推理深度并预打包 diff 摘要；
5. **上下文防火墙 (Context Firewall)**：研发期测试静音，杜绝海量测试报错冲垮主会话；全量单测与静态审查隔离在 Subagent 沙箱中用完即焚，彻底根除拆东墙补西墙的降智死循环。

---

## 插件结构

```text
a8-agent-mind/
├── plugin.json                 # 插件元信息
├── config.json                 # Decisions API 等运行参数配置
├── scripts/
│   └── scan_docs_sync.mjs      # 每晚 20:00 定时梳理前置增量扫描与静态健康体检
├── design.md                   # 核心设计与演进架构规范
├── readme.md                   # 使用与维护指南
├── repos.md                    # 宿主机全局仓库地图索引（本机数据，已 .gitignore）
├── repos/                      # 跨仓库详情卡片与关系定义（本机数据，已 .gitignore）
├── reviews/                    # DSH 终审结构化归档（按项目目录隔离 reviews/<repo>/<ts>-<repo>-r<round>.md，已 .gitignore）
├── templates/                  # 工作记录模板与定时自动化配置模板（含 nightly-evergreen-docs-sync）
├── sidecars/
│   └── panel/                  # 插件 Dashboard Web Sidecar（优先托管同源编译产物 modules/devtools/ui）
├── agents/
│   ├── arch-judge.md           # 专职语义红线审查 Subagent
│   ├── docs-sync.md            # 夜间慢轨 / 手工触发常青真源全量梳理 Subagent
│   └── dsh-reviewer.md         # 专职 DSH 深度架构终审 Subagent（外置引擎调度与收敛控制）
├── skills/
│   ├── a8-workflow/            # 【核心内功：全阶段自主工程工作流与 5 份场景指南】(自动生效 / /a8-workflow)
│   ├── a8-prompt/              # 【事前打磨：提示词专家级深化与重写】(/a8-prompt，重写即停)
│   ├── a8-judge/               # 【能力1：AI 自主择机架构红线裁决】(a8-judge / /a8-judge)
│   ├── a8-improve/             # 【能力2：经验沉淀与无效/重复规则清理】(/a8-improve)
│   ├── a8-ui-verify/           # 【能力3：跨仓库自动化 UI 验证】(/a8-ui-verify)
│   ├── a8-ui-design/           # 【能力4：企业级秩序与极简美学的 UI 设计规范】
│   ├── a8-dsh-review/          # 【能力5：极速有界收敛 DSH 终审循环与归档】(/a8-dsh-review)
│   ├── a8-trace/               # 【能力6：开发决策过程 TSV 账本（备选/回退/证据/风险）】(/a8-trace)
│   └── a8-commit/              # 【能力7：提交前强制审查与标准化 Git 推送（无 AI 署名）】(/a8-commit)
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

#### 场景 B：提交前强制审查 (`/a8-commit`) 与主动复盘 (`/a8-improve`)
- **提交前强制质量闸门 (`/a8-commit`)**：日常开发零回合钩子打扰；默认发起 `/a8-commit` 时强制走完敏感/无关文件拦截、仓内门禁、`judge_router` + Decisions API + 按需 `arch-judge` 语义审查、重大变更文档收口、原子拆分与无署名提交推送（仅用户显式传 `fast`/`--fast` 可跳过第 3 步语义审查，严禁 AI 擅自启用；带 `nopush`/`onlycommit` 仅本地 commit，两者可组合）。
- **主动全面复盘与规则清理 (`/a8-improve`)**：只需输入 `/a8-improve`，无需记参数、无需启动子代理；Agent 发现疑似规则/流程/偏好/原则候选项时会自动抽查本机近期历史会话做交叉验证，一体化完成新防线提炼及历史规则库中的**无效、过时与重复逻辑清理**，通过交互卡片编号确认后落盘。

#### 场景 C：独立触发自动化界面验收 (`/a8-ui-verify`)
需要真机浏览器端到端检查界面状态与接口异常时，输入 `/a8-ui-verify`：优先调度目标仓库 `scripts/tests/ui-verify/` 自动化测试（兼容既有测试套件索引），截图与报告产物统一落盘 `logs/ui-verify/`（自动被 `.gitignore` 忽略）。

#### 场景 D：日常开发自动同步文档与两级查找（自动生效）
插件已全局生效 `mind-rules.md`，Agent 在各仓库中将自动遵循：
- 查找任何模块、代码、配置或文档时，先从当前仓库的**仓库大地图 (`AGENTS.md`)** 并按需阅读命中的 **`docs/evergreen/` 常青文档**（仅在深挖历史背景或排障细节时顺回链查阅 `docs/records/`）；跨仓库问题优先查全局**仓库地图 (`a8-agent-mind/repos.md`)**；
- 触及架构/契约/状态机/深层根因的变更在 `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md` 写入轻量工作记录后，**直接在当前上下文顺手轻量化同步** `docs/evergreen/*.md`、`docs/verify.md` 与 `AGENTS.md`（不额外启动 `docs-sync` 子代理）；每晚 20:00 定时梳理任务会通过 `scan_docs_sync.mjs` 自动跳过无变更仓，对有变动或体检异常的仓对照真实源码全面梳理补全并保留结果于工作区；常规局部改动与简单 Bug 修复严禁滥建文档。
