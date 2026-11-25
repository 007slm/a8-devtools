# a8-agent-mind 设计与演进架构规范 (design.md)

> **模块定位**：面向自主智能体的工程良知与持续演进心智中枢（A8 Agent Mind），严控 **10 大核心技能（2 自动内功 + 8 手动大招）**，遵循**治理三线分离总原则**：Rule 写提示词、Lint 在会话 `Stop` 后做机械检查、Decision 在 `commit` 之前做语义判定。  
> **常青真源与使用路由**：现行全量红线、5 级防线阶梯、双层文档/术语表契约与机械门禁细节统一维护于 [`docs/evergreen/agent-mind-governance.md`](../../docs/evergreen/agent-mind-governance.md)（避免重复堆砌）；安装步骤与插件脚本能力路由表见 [`readme.md`](readme.md)。

---

## 1. 核心设计哲学 (Core Architectural Principles)

### 1.1 治理三线分离与三层模型 (Three-Line Separation & Tripartite Mind)
1. **Rule 写提示词（行为标准线）**：[`rules/mind-rules.md`](rules/mind-rules.md) 与单仓 `.agents/rules/` 只承载面向模型的规范要求、设计原则与模板约定，**严禁**混入具体 Lint 脚本路径，防止模型干活前翻阅检查源码“背考点”；
2. **Lint 在会话 `Stop` 后做机械检查（确定性检查线）**：根目录 [`hooks.json`](hooks.json) 挂载极轻本地 `Stop` Hook（[`hooks/stop_lint.py`](hooks/stop_lint.py)，0 Token、不调 LLM），在模型改完文件停步后自动调用 `run_repo_lints.py` 检查 `<repo>/scripts/lints/`；纯问答/无改动/全绿静默放行，违规直接回传报错与改法（`continuationActive` 防死循环）；
3. **Decision 在 `commit` 之前做判定（语义裁决线）**：日常编码与交卷前**严禁 AI 自动调用 `a8-judge` / `arch-judge`**；仅在默认 `/a8-commit`（非 `fast`）Step 3 或用户显式输入 `/a8-judge` 时，经元特征路由 + Google Gemini Decisions API 概率初筛 + 按需 `arch-judge` 全仓终审执行裁决；
4. **快慢双轨文档治理与按需大招**：确立 `docs/glossary.md` + `docs/verify.md` + `docs/evergreen/` + `docs/records/` + `docs/deferred/` 分域体系（日间顺手轻更、每晚 20:00 `scan_docs_sync.mjs` + `docs-sync` 全量补齐）；经验复盘统一由用户主动触发 `/a8-improve`，浏览器验收由用户主动触发 `/a8-ui-verify`。

### 1.2 语义裁决哲学（抛弃静态符号正则猜度）
- **传统工具死穴**：靠类名含 `Compat` 或 `@Deprecated` 正则猜度，易把协议驱动封装与代码生成桩误报为违规，却漏掉改名后的隐蔽违规；
- **语义裁决闭环**：架构红线关乎跨文件因果链与生命周期闭环，必须结合设计文档上下文与语义概率判定。

### 1.3 Google Gemini Decisions API (`gemini-decision-1`) 与三段式终审流水线
- **零输出 Token 概率校准**：`skills/a8-judge/scripts/decisions_client.py` 对接 `/v1beta/decisions`，对 4 个正交核心维度直接输出布尔判定与校准概率分布，按 [`skills/a8-judge/schemas/verdict.json`](skills/a8-judge/schemas/verdict.json) 严格校验；
- **Diff 指针 + `docs/` 路由 (`judge_router.py`)**：提取语法元特征与激活维度（`activated_categories`），解析目标仓 `AGENTS.md`（兼容 4/5/6+ 列索引表）定位相关文档（`relevant_docs`），前置精简红线摘要送审 Decisions API；告警或命中高危架构面时交由具备全工具权限的 `arch-judge` 结合源码与文档全文终审；
- **Antigravity `agents/*.md` 工具下发契约**：子代理 frontmatter 必须同时显式声明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，否则会被运行时静默降级为无 `run_command` 的 9 工具只读集（由 `scripts/lints/check_plugin_agents.py` 强制守卫）。

---

## 2. 4 个核心检查维度与通用元特征路由 (Zero Project Hardcoding)

全量规则划分为 4 个互不重叠的核心维度，由纯 Python 标库实现的 `skills/a8-judge/scripts/judge_router.py`（零项目硬编码、`< 50ms`）按代码变更语法元特征动态激活：

```text
                                  Git Diff 原始变动
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
【演化与生命周期契约】          【系统边界与拓扑隔离】          【并发安全与热路径性能】          【实现规范、直白命名与单一路径】
• `@Deprecated`, `obsolete`    • `import`, `package`          • `synchronized`, `Lock`       • `catch`, `throw`, `enum `
• 公开 API 签名增删            • 构建依赖 (`pom/json/mod`)    • `Thread`, `volatile`         • `System.out`, 日志门面
• 零擅自向后兼容死代码         • 底层模块零重型侵入          • 高频热路径无排他锁           • 直白简单命名、平实文档与异常保留
```

---

## 3. 职责解耦与执行闭环

```text
【日常编码 / 回合结束】
  ├──► Rule 线：mind-rules.md 仅提供提示词规范要求（不暴露 Lint 脚本路径）
  ├──► Lint 线（Stop Hook）：修改文件后回合停步自动静默跑 scripts/lints/，违规回传报错与改法
  ├──► 日间快轨：重大变更写轻量记录 (docs/records/) 并顺手轻更常青文档（不起 docs-sync）
  ├──► 按需人工大招：/a8-prompt（深化重写） · /a8-brain（知识大脑） · /a8-trace（决策账本）
  │                  /a8-dsh-review（DSH 有界终审，F×S ≥ 10） · /a8-ui-verify（独立界面验收）
  ├──► Decision 线（/a8-commit 提交前强检，显式 fast 仅跳语义审）：
  │      敏文件拦截 → 仓内 Lint 兜底 → judge_router → Decisions API → 按需 arch-judge → 文档收口 → 推送
  └──► 主动复盘 /a8-improve：主会话五维信号提取 + 规则-强制器体检 + 确认落盘（规则细则见 skills/a8-improve/SKILL.md）
```

---

## 4. 上下文防火墙与防降智流水线 (Context Firewall)

- **痛点根治**：主会话反复刷屏跑全量测试或重型静态分析，海量 Traceback 会击穿上下文并诱发拆东墙补西墙的防御性废代码；
- **开发 / 校验隔离**：
  1. **开发主干期测试静音**：聚焦业务主干、状态机自洽与局部快速验绿；
  2. **子代理隔离防火墙**：全量单测、跨仓调用链深查与重型静态审查交由带 `run_command` 权限的隔离 Subagent 执行，脏日志用完即焚，主会话仅接收高密度诊断骨架（失败用例、物理行号与因果核心）。

---

## 5. Generative UI 紧凑型卡片约束

插件通过 `<agent-embed>` 在对话中内嵌原生交互卡片，均须使用宿主语义变量（`--card`、`--foreground`、`--muted-foreground`、`--border` 等自适应明暗主题）并严控高度防滚动：
- `a8-judge` 报表：2×2 网格展示 4 维度裁决与 Decisions API 置信度（高度 `250px~360px`），附 `<details>` 变动溯源；
- `a8-improve` 卡片：无外框嵌入式 Master-Detail 布局（`<= 450px`），细则见 [`skills/a8-improve/references/card-and-eval.md`](skills/a8-improve/references/card-and-eval.md)。

---

## 6. 目录与资产布局 (Directory Structure)

```text
E:\a8-devtools\plugins\a8-agent-mind/
├── plugin.json                     # Antigravity 插件元定义
├── hooks.json                      # 极轻本地确定性 Stop Hook 注册（仅机械 Lint，零 LLM）
├── hooks/                          # stop_lint.py 及单测 test_stop_lint.py
├── config.json                     # Google Decisions API (gemini-decision-1) 配置
├── design.md                       # 核心设计与演进架构规范（本文件，严控 <= 20 KB）
├── readme.md                       # 安装指南与脚本能力路由表（tools as files）
├── repos.md & repos/               # 宿主机全局仓库地图索引与跨仓关系（本机数据）
├── scripts/                        # 跨技能通用脚本（scan_docs_sync.mjs / run_repo_lints.py / strip_html_text.py）
├── decisions/                      # 全局结构化 Decision 规范 (*.decision.json)
├── templates/                      # work-record 与 nightly-evergreen-docs-sync 定时任务模板
├── sidecars/panel/                 # 插件看板 Sidecar（复用 modules/devtools/ui 单包产物，默认 :18766）
├── reviews/                        # DSH 终审按仓隔离归档 (reviews/<repo>/*.md，.gitignore)
├── wiki/                           # 个人 LLM Wiki 知识库（供 /a8-brain 按需索引读写）
├── agents/                         # arch-judge.md / docs-sync.md / dsh-reviewer.md
├── skills/                         # 10 大核心技能（2 自动 + 8 手动）
│   ├── a8-workflow/                # [自动] 研发主线总控 + guides/ (5 场景) + references/
│   ├── a8-ui-design/               # [自动] 企业级秩序与极简美学 UI 规范
│   ├── a8-prompt/                  # [手动] 事前提示词专家级深化与重写
│   ├── a8-brain/                   # [手动] LLM Wiki 知识大脑、定名重构与体检
│   ├── a8-judge/                   # [手动/嵌入commit] 元特征路由 + Decisions API + schemas/scripts
│   ├── a8-dsh-review/              # [手动] DSH 有界终审闭环与归档 (scripts/review.ps1)
│   ├── a8-ui-verify/               # [手动] 跨仓自动化 UI 验收协议
│   ├── a8-trace/                   # [手动] 开发决策过程 7 列 TSV 账本
│   ├── a8-commit/                  # [手动] 提交前强制门禁、文档收口与标准化推送
│   └── a8-improve/                 # [手动] 经验沉淀与规则清理 (SKILL.md + references/ + templates/)
└── rules/
    ├── mind-rules.md               # 全局通用架构与文档治理总则
    └── TOKENS.md                   # 上下文节流 5 条原则
```

---

## 7. 新会话接管与演进指引 (Context Continuity Guide)

1. **先读真源再动工**：依次阅读本文件、[`docs/evergreen/agent-mind-governance.md`](../../docs/evergreen/agent-mind-governance.md) 与 [`rules/mind-rules.md`](rules/mind-rules.md)；
2. **规则与脚本入口**：通用红线在 `rules/mind-rules.md` 维护，脚本命令行用法统一查阅 [`readme.md`](readme.md) 脚本能力路由表（`--help` 或单行参数）；
3. **门禁校验**：修改规则、技能、Agent 或本文件后，运行仓库根目录 `check_workspace_hygiene.mjs`、`check_plugin_agents.py` 与 `judge_router.py .` 确认体积与契约全绿；
4. **实时生效**：Windows 通过 `bindflt` 直通挂载至 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind`，源码改动即时生效。
