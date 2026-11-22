# a8-agent-mind 设计与演进架构规范 (design.md)

> **模块定位**：面向自主智能体的工程良知与持续演进心智中枢（A8 Agent Mind）。基于 Google Antigravity 插件机制与 **Google Gemini Decisions API (`gemini-decision-1`)**，融合**“全局文档、共享术语表、验证地图 (`docs/verify.md`)、显式状态机与双层仓库地图治理 (`mind-rules.md`)”**、**“全阶段自主工程工作流内功 (`a8-workflow`)”**、**“事前提示词深化与重写 (`/a8-prompt`)”**、**“提交前强制红线与文档总闸门 (`/a8-commit` + `a8-judge`)”**、**“DSH 极速有界终审闭环 (`/a8-dsh-review`)”**、**“经验复盘与规则库清理 (`/a8-improve`)”**、**“UI 设计规范 (`a8-ui-design`)”**与**“独立 UI 端到端验证 (`/a8-ui-verify`)”**，彻底卸载回合级 `Stop` Hook，构建日常零打扰、落库前强把关的智能体心智中枢（严控 8 大核心技能：3 个自动内功 + 5 个手动大招）。

---

## 1. 核心设计哲学 (Core Architectural Principles)

### 1.1 智能体心智的三层模型 (The Tripartite Mind)
1. **理智与戒律 (Super-ego / 高风险自主终审)**：遵循全局 `mind-rules.md`，仅当代码改动触及跨模块边界、状态机/并发重构或兼容层清理等高架构风险时，由 AI 在交卷前**自主择机调用一次 `a8-judge`**（常规局部功能、UI 与微调免检且禁止同任务频繁增量复核，亦支持 `/a8-judge` 显式发起），通过语法元特征自适应路由与 Google Gemini Decisions API 零输出 Token 概率校准裁决执行冷酷审查；
2. **认知与记忆仓库地图 (Memory / 快慢双轨文档治理)**：由全局 `mind-rules.md` 强制驱动，确立 **常青文档 (`docs/evergreen/*.md`) + 按日期工作记录 (`docs/records/YYYYMMDD-*.md`) + 暂缓区 (`docs/deferred/`)** 双层分域体系；日间开发写完轻量工作记录（简单修复靠单测与注释）后，直接在当前对话利用既有上下文顺手轻更新 `docs/evergreen/`、`docs/verify.md` 与根目录 `AGENTS.md`（不额外起 `docs-sync` 子代理）；每晚 20:00 定时任务通过 `scripts/scan_docs_sync.mjs` 增量扫描 `repos.md` 在管仓，仅针对有变动或体检异常的仓库按 **`docs-sync`** 慢轨规范对照真实源码全量整理补齐；
3. **提交前强制总闸门 (`/a8-commit`) + 主动经验精炼 (`/a8-improve`)**：
   - 彻底卸载回合级 `PreInvocation + Stop` Hook，日常多轮编码与试错零打扰、零隐藏 API 消耗；
   - 执行 `/a8-commit` 提交代码前**强制**完成敏感/无关文件拦截、仓内门禁、`judge_router` → Decisions API → 告警/高危面 `arch-judge` 三段式红线终审（无跳过开关）与重大变更文档收口；
   - 当用户需要跨会话深度复盘、全面审视经验，或清理无效/冲突/重复规则时，主动调用 `/a8-improve` 一体化完成沉淀与精简。
4. **独立界面验证 (`/a8-ui-verify`)**：标准化目标仓库 `scripts/tests/ui-verify/` 脚本目录与 `logs/ui-verify/` 产物目录，由用户按需触发全链路浏览器验证。

### 1.2 彻底抛弃 ArchUnit 等静态符号匹配
- **传统工具死穴**：依靠类名是否包含 `Compat`、是否有 `@Deprecated` 注解进行正则猜度。在真实复杂工程中，必然把正常协议驱动封装误判为违规、把 Protobuf 编译器自动生成的桩代码全部误报，却防不住改换名称的隐蔽违规。
- **语义裁决哲学**：架构红线是**高维的物理因果链与生命周期闭环**（如“是否破坏单一事实源”、“是否为了照顾旧系统私自保留新旧并存死代码”）。必须由具备上下文推理能力的 Judge 结合语义概率判定完成闭环。

### 1.3 Google Gemini Decisions API (`gemini-decision-1`) 零输出 Token 概率校准裁决
插件裁决引擎已全面切换至官方 **Google Gemini Decisions API (`gemini-decision-1`)**：
- **零输出 Token 结构化判定 (Zero Output Token)**：不生成开放式冗余文本，直接对 4 个互不重叠的核心维度输出布尔选项与校准概率分布 (`confidence` / `probabilities`)；
- **低延迟高确定性**：通过 `skills/a8-judge/scripts/decisions_client.py` 原生对接 `/v1beta/decisions`，毫秒级定音；
- **严格 Schema 约束**：裁决结果严格映射并校验为 `skills/a8-judge/schemas/verdict.json` 定义的 `ArchitectureVerdict`，杜绝格式幻觉。

### 1.4 语法元特征与 `docs/` 指针路由 + 全自由度终审流水线
既做到“只评相关维度、节省上下文”，又做到“结合设计文档避免误报、全仓核验准确定音”：
1. **步骤一：变更指针与设计文档路由 (`judge_router.py`)**：
   - 提取当前 Git Diff 语法元特征与真正触及的检查维度 (`activated_categories`)，并兼容解析目标仓库 `AGENTS.md`（支持 4/5/6+ 列常青/SPEC 索引表，含表头自动识别与全列源码路径提取）输出命中文档清单 (`relevant_docs`)；
2. **步骤二：Decisions API 先验初筛 + `arch-judge` 全自由终审**：
   - 将 Git Diff 仅作为变更指针：`decisions_client.py` 为每个分片前置 `Documented Design Context` 向 `gemini-decision-1` 发起先验初筛，最终由具备完整工具权限的 `arch-judge` 结合项目 `AGENTS.md`、`docs/`、源码全貌与调用链作出终审；
   - **Antigravity `agents/*.md` 工具下发契约**：插件定义独立执行权子代理时，frontmatter 必须同时显式声明 `subagent: true`、`mainAgent: false` 与单行 `tools: [read_file, edit_file, write_file, run_command, manage_task, search_web]`；缺少 `mainAgent: false` 或使用多行 YAML `tools:` 列表会被运行时静默降级为无 `run_command` 的 9 工具只读集。

---

## 2. 4 个核心检查维度与通用元特征路由 (Zero Project Hardcoding)

为了防止“一锅端导致大模型注意力稀释丢检查项”，同时防止“逐条检查导致 Token 浪费与延迟暴增”，将全量规则划分为 4 个互不重叠的检查维度，并基于 **代码变更的语法元特征** 自动路由：

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

- **路由脚本**：`skills/a8-judge/scripts/judge_router.py`（纯 Python 标库，无任何三方依赖，无任何特定项目硬编码，执行耗时 < 50ms）。

---

## 3. 职责分工机制：AI 自主地图文档与红线终审 + `/a8-dsh-review` + `/a8-improve` 主动沉淀规则

为了避免混淆“日常必尽的自主治理义务”与“高谨慎度的人工规则演化”，系统将各项能力清晰解耦：

```text
                    【日常编码 / 任务收尾】
                              │
   自动履行 (mind-rules.md)   ├──► 1. 日间快轨：重大变更写轻量工作记录 (docs/records/) 并顺手轻改常青文档
                              │       （写过即放行，不起 docs-sync 子代理；每晚 20:00 定时任务全量兜底梳理）
                              │
                              ▼    2. 触及 4 大红线的代码变更交卷前，AI 自主择机调用一次：
        ┌────────────────────────────────────────────┐
        │         a8-judge (语义架构终审裁判)         │  <-- 触发：AI 自主择机（亦支持 /a8-judge 显式调用）
        │  • 运行方式：全工具自由 Subagent (上下文隔离)│  <-- 权限：run_command + 全仓读写(默认不改业务码)
        │  • 裁决引擎：Diff 指针 + docs/ 全貌 + Decisions│  <-- 初筛：gemini-decision-1 雷达；终审：arch-judge
        └─────────────────────┬──────────────────────┘
                              │ (跨文件深层因果链与全生命周期终审)
                              ▼
        ┌────────────────────────────────────────────┐
        │     dsh-reviewer (DeepSeek Harness 终审)   │  <-- 触发：/a8-dsh-review（有界 2~3 轮）
        │  • 运行方式：插件内建自完整 Subagent        │  <-- 提速：--patch medium + 预打包 diff
        │  • 熔断纪律：仅修 F×S ≥ 10，跳过 lint 已查项 │  <-- 交付：返还主会话 + reviews/*.md 归档
        └─────────────────────┬──────────────────────┘
                              │ (回合结束自动触发 / 用户按需主动发起)
                              ▼
        ┌────────────────────────────────────────────┐
        │   /a8-commit (提交前强制质量总闸门) & /a8-improve │
        │  • 强制审查：敏文件拦截 → Lint → Decisions → Judge│  <-- 不可跳过；日常编码零 Stop Hook 打扰
        │  • 文档收口：重大改动补记录轻更常青随代码同提  │  <-- 每晚 20:00 scan_docs_sync 全量兜底
        │  • /a8-improve：沉淀新规+清理无效与重复规则 │  <-- 主会话零子代理，确认后落盘
        └────────────────────────────────────────────┘
                              │ (用户显式发起界面验收)
                              ▼
        ┌────────────────────────────────────────────┐
        │   a8-ui-verify (/a8-ui-verify 独立 UI 验证) │  <-- 脚本 scripts/tests/ui-verify/
        │  • 产物隔离：logs/ui-verify/（不污染仓库）   │  <-- 长期基线报告按需归档 docs/
        └────────────────────────────────────────────┘
```

#### 3.1 提交前强制闸门与 `a8-improve` 职责分离
- **职责纯洁性**：回合级 `Stop` Hook 已彻底卸载；代码红线初筛/语义终审与重大变更文档收口统一在 `/a8-commit` 提交前强制闭环（无跳过开关），`/a8-improve` 专职深度五维纠偏沉淀**以及**规则库中的无效/冲突/重复逻辑清理；
- **五维纠偏信号捕获**：除显式批评外，强制回溯 `Silent edit`（外部静默修改）、`Repeated nudge`（连续微调终值）、`Revert / Rejection` 与 `Confirmed non-obvious choice`；
- **防膨胀过滤漏斗 (`Rewrite Stricter`)**：命中既有规则覆盖范围且仍犯错时，判定为旧规失效并收紧重写（补齐数值/API/绝对词），严禁堆砌第 2 条重复规则；可精确机械拦截项一律优先写入目标仓库 `scripts/lints/`；
- **真实 Why 与审计锚点**：严禁编造原因（AI 推演必标 `*inferred*:` 并列入 `Needs your answer`），规则下方保留 `<!-- YYYY-MM-DD: "用户原话" -->` 时间戳注释；
- **第一性原理归因与防膨胀定尺**：拒绝按具体组件类别堆砌枚举，向上抽取跨场景通用工程偏好并优先归并进既有第一性原理（采用“原理主干 + 具体物理判据/典型反例”格式），提案前须通过“零上下文新 Agent 独立复现不重犯”自测。

---

## 4. 上下文防火墙与防降智流水线 (Context Firewall & Anti-Degradation)

- **痛点根治**：频繁在主会话中运行全量测试套件或静态分析，会导致成百上千行 Traceback 报错与编译器日志直接砸碎上下文，模型注意力陷入“消灭眼前报错”的目标漂移，催生大量拆东墙补西墙的防御性废代码。
- **开发 / 校验隔离机制**：
  1. **开发主干期测试静音 (Dev Silence)**：编码与调优阶段专注业务主干逻辑、状态机自洽与视觉交互，严禁在主会话反复刷屏跑全量单测；
  2. **验证收尾期子进程隔离 (Subagent as Context Firewall)**：需要全量单测、调用链检索或重型静态分析时，交由具备 `run_command` 权限的 Subagent（如 `arch-judge`）在独立子会话中执行。数千行脏日志在子会话中“用完即焚”，主会话仅接收结构化的高密度诊断骨架（失败用例、物理行号与因果核心），保证主会话上下文终身纯净。

---

## 5. Generative UI 紧凑型现代报表设计 (Compact & Precision UI)

插件支持在 Antigravity 对话中通过 `<agent-embed>` 直接内嵌原生交互式卡片：
- **宿主语义 Tokens**：完全使用 `--card`, `--background`, `--foreground`, `--muted-foreground`, `--border` 等动态变量，自适应暗黑/浅色模式；
- **排版原则**：
  - 必须紧凑（高度收敛在 250px~360px 区间），信息密度高；
  - `a8-judge` 报表：采用 2x2 网格呈现 4 个核心维度状态（`0 违规` 绿色微徽章与 Google Decisions API 置信度），带有 `<details>` 变动溯源清单；
  - `a8-improve` 复盘卡片：无外框贴边嵌入式 Master-Detail 布局（`<= 450px` 紧凑定高），顶部展示量化收益徽章，左侧为可勾选的防线等级/规则清理清单，右侧支持「现状痛点→提升效果（含作用域就地拍板）」与「变更补丁 Diff」双视图切换，底部随勾选与拍板联动生成并一键复制精确确认指令。

---

## 6. 目录与资产布局 (Directory Structure)

```text
E:\a8-devtools\plugins\a8-agent-mind/
├── plugin.json                     # Antigravity 插件核心元定义
├── config.json                     # Google Decisions API (gemini-decision-1) 配置
├── scripts/
│   └── scan_docs_sync.mjs          # 每晚 20:00 定时梳理前置增量扫描与静态健康体检
├── decisions/                      # 全局结构化 Decision 规范 (*.decision.json，无损分批送审)
├── templates/                      # work-record 模板与 nightly-evergreen-docs-sync 定时任务模板
├── design.md                       # 【核心设计与架构规范】（本文件）
├── readme.md                       # 跨仓库安装与使用指南
├── repos.md                        # 宿主机全局仓库地图索引
├── repos/                          # 宿主机各仓库详情卡片与跨仓协作关系
├── sidecars/
│   └── panel/                      # 插件内嵌看板 (Node main.mjs，默认回退端口 18766，Antigravity 托管动态端口 + 网关透传)
│                                   # 单一路径复用 modules/devtools/ui 经典 IIFE 单包构建产物并托管宿主 /preload.js
│                                   # 静态资源免 Origin 拦截；/api/ 控制面兼容 Origin: null 与 plugin:// 等本地协议（宿主机完整工作台由 :18765 托管）
├── reviews/                        # DSH 每次架构终审按项目子目录隔离归档 (reviews/<repo>/*.md，已纳入 .gitignore)
├── agents/
│   ├── arch-judge.md               # 专职语义裁决 Subagent（全工具自主调查）
│   ├── docs-sync.md                # 夜间慢轨 / 手工触发常青真源全量梳理 Subagent
│   └── dsh-reviewer.md             # 插件自完整 DSH 资深架构终审 Subagent
├── skills/
│   ├── a8-workflow/                # 【能力0：全阶段自主工程工作流总控与 5 份场景指南】(自动触发 / /a8-workflow)
│   │   ├── SKILL.md                # 接单门禁、5 场景指南路由、子代理隔离与 A8 交卷收口
│   │   ├── guides/                 # analyze / bug-fix / perf / feature / long-task
│   │   └── references/             # pstack-source-map.md (85 项来源映射与升级台账)
│   ├── a8-prompt/                  # 【事前打磨：提示词专家级深化与重写】(/a8-prompt，仅改写Prompt并停步)
│   │   └── SKILL.md                # 轻量贴合仓内地图答专家 4 问，做深不做大，重写即停
│   ├── a8-judge/                   # 【能力1：AI 自主择机架构红线裁决 (a8-judge / /a8-judge)】
│   │   ├── SKILL.md                # 元特征路由 + Google Decisions API 裁决规约
│   │   ├── schemas/
│   │   │   └── verdict.json        # ArchitectureVerdict 严格 JSON Schema
│   │   └── scripts/
│   │       ├── judge_router.py     # 纯通用语法元特征路由器
│   │       └── decisions_client.py # Google Gemini Decisions API 客户端
│   ├── a8-dsh-review/              # 【能力2：DSH 有界终审 Loop (/a8-dsh-review)】
│   │   ├── SKILL.md                # 2~3 轮上限 + YAGNI (F×S < 10) 熔断与会话回传+报告归档协议
│   │   └── scripts/
│   │       └── review.ps1          # 双流分离、跨仓会话自动映射与 reviews/*.md 归档脚本
│   ├── a8-improve/                 # 【能力3：经验沉淀与规则库清理 (/a8-improve)】
│   │   ├── SKILL.md                # 五维信号、作用域拆分、失效/重复清理与防膨胀规约
│   │   └── templates/
│   │       └── improve_card.html   # Generative UI 紧凑复盘卡片模板
│   ├── a8-ui-verify/               # 【能力4：独立自动化 UI 验证 (/a8-ui-verify)】
│   │   └── SKILL.md                # scripts/tests/ui-verify/ 与 logs/ui-verify/ 验证协议
│   ├── a8-ui-design/               # 【能力5：UI 设计感与工业美学规范】
│   └── a8-commit/                  # 【能力6：标准化 Git 提交与推送 (/a8-commit)】
│       └── SKILL.md                # 敏感/无关文件拦截、原子拆分、中文两档模板、无署名与默认 push（支持 nopush/onlycommit）
└── rules/
    └── mind-rules.md               # 【全局核心】架构设计哲学、文档与双层仓库地图自动治理总则
```

---

## 7. 新会话接管与演进指引 (Context Continuity Guide)

在全新会话中接管本插件开发时，请遵循以下流程：

1. **读取本文件 (`design.md`) 与 [rules/mind-rules.md](rules/mind-rules.md)**：理解当前的 4 个核心检查维度、Google Decisions API 集成方式与执行契约；
2. **规则演进与维护**：
   - 通用架构红线、文档与双层仓库地图自动治理总则统一在 [rules/mind-rules.md](rules/mind-rules.md) 维护（`judge_router.py` 自动扫描 `rules/*.md` 加载）；
3. **测试路由与裁决链路**：
   - 运行 `py -3 skills/a8-judge/scripts/judge_router.py <target_workspace>` 验证特征提取是否精准无误；
   - 需要联调真实 Google Decisions API (`gemini-decision-1`) 时通过 `py -3 skills/a8-judge/scripts/decisions_client.py <target_workspace> <activated_categories>` 验证；
4. **插件同步与生效**：
   - Windows 平台已通过 `bindflt` 直通映射至 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind`，在源码目录的所有改动会立即实时生效。
