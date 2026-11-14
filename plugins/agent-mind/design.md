# agent-mind 设计与演进架构规范 (design.md)

> **模块定位**：面向自主智能体的工程良知与持续演进心智中枢（Agent Mind）。基于 Google Antigravity SDK 与 **Google Gemini Decisions API (`gemini-decision-1`)**，融合**“全局文档与双层仓库地图随会话自动治理 (`mind-rules.md`)”**、**“AI 自主择机 Google Decisions API 语义架构红线终审 (`arch-judge`)”**、**“DeepSeek Harness 有界终审闭环 (`/dsh-review`)”**与**“用户主动触发的经验品味规则沉淀 (`/improve`)”**，构建职责正交、自动闭环的智能体心智中枢。

---

## 1. 核心设计哲学 (Core Architectural Principles)

### 1.1 智能体心智的三层模型 (The Tripartite Mind)
1. **理智与戒律 (Super-ego / AI 自主择机终审)**：遵循全局 `mind-rules.md`，当代码改动触及 4 大正交架构红线时，由 AI 在交卷前**自主择机调用一次 `arch-judge`**（无需人工触发，亦支持 `/judge` 显式发起），通过语法元特征自适应路由与 Google Gemini Decisions API 零输出 Token 概率校准裁决执行冷酷审查；
2. **认知与记忆仓库地图 (Memory / 随会话自动维护)**：由全局 `mind-rules.md` 强制驱动，在每次开发任务收尾前**随会话自动生成 `docs/` 长期文档并同步双层仓库地图**（单仓“仓库大地图 `AGENTS.md`” + 全局“仓库地图 `agent-mind/repos.md`”），并贯彻两级检索法则，无需人工调用 Skill；
3. **反思与神经生长 (Reflection / 用户主动触发)**：当会话出现人工纠偏或需要收紧/剪枝规则时，由**用户主动触发 `/improve`**，基于第一性原理抽取通用工程偏好并归并既有原理（或转化为机器检查补丁），经人工编号确认后落盘。

### 1.2 彻底抛弃 ArchUnit 等静态符号匹配
- **传统工具死穴**：依靠类名是否包含 `Compat`、是否有 `@Deprecated` 注解进行正则猜度。在真实复杂工程中，必然把正常协议驱动封装误判为违规、把 Protobuf 编译器自动生成的桩代码全部误报，却防不住改换名称的隐蔽违规。
- **语义裁决哲学**：架构红线是**高维的物理因果链与生命周期闭环**（如“是否破坏单一事实源”、“是否为了照顾旧系统私自保留双轨死代码”）。必须由具备上下文推理能力的 Judge 结合语义概率判定完成闭环。

### 1.3 Google Gemini Decisions API (`gemini-decision-1`) 零输出 Token 概率校准裁决
插件裁决引擎已全面切换至官方 **Google Gemini Decisions API (`gemini-decision-1`)**：
- **零输出 Token 结构化判定 (Zero Output Token)**：不生成开放式冗余文本，直接对 4 大正交维度输出布尔选项与校准概率分布 (`confidence` / `probabilities`)；
- **低延迟高确定性**：通过 `skills/arch-judge/scripts/decisions_client.py` 原生对接 `/v1beta/decisions`，毫秒级定音；
- **严格 Schema 约束**：裁决结果严格映射并校验为 `skills/arch-judge/schemas/verdict.json` 定义的 `ArchitectureVerdict`，杜绝格式幻觉。

### 1.4 语法元特征路由 + Decisions API 极速裁决流水线
既做到“只评相关维度、节省上下文”，又做到“事实核验准确、裁决毫秒定音”：
1. **步骤一：语法元特征自适应路由 (`judge_router.py`)**：
   - 分析当前 Git Diff 语法元特征，识别真正触及的正交关注点 (`activated_categories`)；
2. **步骤二：Decisions API 概率校准定音 + 只读现场核验**：
   - 调用 `decisions_client.py` 向 Google Gemini Decisions API (`gemini-decision-1`) 发起判定，并对违规维度结合只读工具追查调用方与 ADR 批准事实，定位精确文件路径、物理行号与修正动作。

---

## 2. 4 大正交关注点与通用元特征路由 (Zero Project Hardcoding)

为了防止“一锅端导致大模型注意力稀释丢检查项”，同时防止“逐条检查导致 Token 浪费与延迟暴增”，将全量规则划分为 4 个物理正交维度，并基于 **代码变更的语法元特征** 自动路由：

```text
                                  Git Diff 原始变动
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
【演化与生命周期契约】          【系统边界与拓扑隔离】          【并发安全与热路径性能】          【实现规范与单一路径】
• `@Deprecated`, `obsolete`    • `import`, `package`          • `synchronized`, `Lock`       • `catch`, `throw`
• 公开 API 签名增删            • 构建依赖 (`pom/json/mod`)    • `Thread`, `volatile`         • `System.out`, 日志门面
• 零擅自向后兼容死代码         • 客户端 SDK 纯净隔离          • 高频热路径无排他锁           • 错误物理第一现场保留
```

- **路由脚本**：`skills/arch-judge/scripts/judge_router.py`（纯 Python 标库，无任何三方依赖，无任何特定项目硬编码，执行耗时 < 50ms）。

---

## 3. 正交分工机制：AI 自主地图文档与红线终审 + `/dsh-review` + `/improve` 主动沉淀规则

为了避免混淆“日常必尽的自主治理义务”与“高谨慎度的人工规则演化”，系统将各项能力清晰解耦：

```text
                    【日常编码 / 任务收尾】
                              │
   自动履行 (mind-rules.md)   ├──► 1. 自动生成 docs/ 长期文档 & 同步仓库大地图 AGENTS.md / repos.md
                              │       （无需手动调用 Skill，随会话交卷自动完成）
                              │
                              ▼    2. 触及 4 大红线的代码变更交卷前，AI 自主择机调用一次：
        ┌────────────────────────────────────────────┐
        │         arch-judge (冷酷守门法官)          │  <-- 触发：AI 自主择机（亦支持 /judge 显式调用）
        │  • 运行方式：只读 Subagent                  │  <-- 权限：只读沙箱 / 上下文防火墙
        │  • 裁决引擎：judge_router + Decisions API   │  <-- 引擎：gemini-decision-1 (零输出 Token)
        └─────────────────────┬──────────────────────┘
                              │ (跨文件深层因果链与全生命周期终审)
                              ▼
        ┌────────────────────────────────────────────┐
        │     dsh-reviewer (DeepSeek Harness 终审)   │  <-- 触发：/dsh-review（有界 2~3 轮）
        │  • 运行方式：插件内建自完整 Subagent        │  <-- 协议：stdout/stderr 分离 + 禁 Shell
        │  • 熔断纪律：仅修 F×S ≥ 10，YAGNI 熔断边缘  │  <-- 交付：返还主会话 + reviews/*.md 归档
        └─────────────────────┬──────────────────────┘
                              │ (开发/调试中存在人工纠偏或需收紧规则)
                              ▼
        ┌────────────────────────────────────────────┐
        │    arch-improve (用户主动规则沉淀与剪枝)    │  <-- 触发：用户主动输入 /improve
        │  • 运行方式：当前主会话 (零子代理)          │  <-- 边界：专职规则/机器检查，不重复画地图
        │  • 防膨胀漏斗：五维信号 / Rewrite Stricter  │  <-- 质检：第一性原理归并 + 物理判据自测
        │  • 交互确认：Generative UI + 写入 1, 3     │  <-- 变体：/improve <sessions> / prune
        └────────────────────────────────────────────┘
```

#### 3.1 `arch-improve` 核心演化机制（专职规则沉淀与防膨胀）
- **职责纯洁性**：只由用户主动调用触发，专注于把真实纠偏固化为硬规则或机器检查（仓库文档与双层仓库地图同步由 `mind-rules.md` 随会话自动承担）；
- **五维纠偏信号捕获**：除显式批评外，强制回溯 `Silent edit`（外部静默修改）、`Repeated nudge`（连续微调终值）、`Revert / Rejection` 与 `Confirmed non-obvious choice`；
- **防膨胀过滤漏斗 (`Rewrite Stricter`)**：命中既有规则覆盖范围且仍犯错时，判定为旧规失效并收紧重写（补齐数值/API/绝对词），严禁堆砌第 2 条重复规则；可自动化拦截项优先升级至 `Make it a check`；
- **真实 Why 与审计锚点**：严禁编造原因（AI 推演必标 `*inferred*:` 并列入 `Needs your answer`），规则下方保留 `<!-- YYYY-MM-DD: "用户原话" -->` 时间戳注释；
- **第一性原理归因与防膨胀定尺**：拒绝按具体组件类别堆砌枚举，向上抽取跨场景通用工程偏好并优先归并进既有第一性原理（采用“原理主干 + 具体物理判据/典型反例”格式），提案前须通过“零上下文新 Agent 独立复现不重犯”自测；
- **全生命周期变体**：支持 `/improve <sessions>`（联合检索历史 `transcript.jsonl` 提取顽固问题）与 `/improve prune`（规则库去重、消解冲突、收紧模糊词汇）。

---

## 4. 上下文防火墙与防降智流水线 (Context Firewall & Anti-Degradation)

- **痛点根治**：频繁在主会话中运行全量测试套件或静态分析，会导致成百上千行 Traceback 报错与编译器日志直接砸碎上下文，模型注意力陷入“消灭眼前报错”的目标漂移，催生大量拆东墙补西墙的防御性废代码。
- **开发 / 校验隔离机制**：
  1. **开发主干期测试静音 (Dev Silence)**：编码与调优阶段专注业务主干逻辑、状态机自洽与视觉交互，严禁在主会话反复刷屏跑全量单测；
  2. **验证收尾期沙箱隔离 (Subagent as Context Firewall)**：需要全量单测或重型静态分析时，统统交由只读 Subagent（如 `arch-judge`）在独立子进程中执行。数千行脏日志在沙箱中“用完即焚”，主会话仅接收结构化的高密度诊断骨架（失败用例、物理行号与因果核心），保证主会话上下文终身纯净。

---

## 5. Generative UI 紧凑型现代报表设计 (Compact & Precision UI)

插件支持在 Antigravity 对话中通过 `<agent-embed>` 直接内嵌原生交互式卡片：
- **宿主语义 Tokens**：完全使用 `--card`, `--background`, `--foreground`, `--muted-foreground`, `--border` 等动态变量，自适应暗黑/浅色模式；
- **排版原则**：
  - 必须紧凑（高度收敛在 250px~360px 区间），信息密度高；
  - `arch-judge` 报表：采用 2x2 网格呈现 4 大正交维度状态（`0 违规` 绿色微徽章与 Google Decisions API 置信度），带有 `<details>` 变动溯源清单；
  - `arch-improve` 复盘卡片：顶部呈现模式标签（`Wrap-up / Prune`）与任务主题，中部双栏呈现“五维纠偏信号捕获”和“规则动作与目标文件（新增/收紧重写/机器检查/跳过）”，底部预览标准 `git diff` 规则/检查补丁（含 `<!-- YYYY-MM-DD: "..." -->` 原话锚点），并引导按编号（如 `写入全部` / `写入 1, 3`）精确落盘。

---

## 6. 目录与资产布局 (Directory Structure)

```text
E:\a8-devtools\plugins\agent-mind/
├── plugin.json                     # Antigravity 插件核心元定义
├── config.json                     # Google Decisions API (gemini-decision-1) 配置
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
│   ├── arch-judge.md               # 专职语义裁决 Subagent（只读权限沙箱）
│   └── dsh-reviewer.md             # 插件自完整 DSH 资深架构终审 Subagent
├── skills/
│   ├── arch-judge/                 # 【能力1：AI 自主择机架构红线裁决 (arch-judge / /judge)】
│   │   ├── SKILL.md                # 元特征路由 + Google Decisions API 裁决规约
│   │   ├── schemas/
│   │   │   └── verdict.json        # ArchitectureVerdict 严格 JSON Schema
│   │   └── scripts/
│   │       ├── judge_router.py     # 纯通用语法元特征路由器
│   │       └── decisions_client.py # Google Gemini Decisions API 客户端
│   ├── dsh-review/                 # 【能力2：DSH 有界终审 Loop (/dsh-review)】
│   │   ├── SKILL.md                # 2~3 轮上限 + YAGNI (F×S < 10) 熔断与双通道交付协议
│   │   └── scripts/
│   │       └── review.ps1          # 双流分离、跨仓会话自动映射与 reviews/*.md 归档脚本
│   ├── arch-improve/               # 【能力3：用户主动触发规则沉淀与剪枝 (/improve)】
│   │   ├── SKILL.md                # 五维信号、第一性原理归并与防膨胀规约
│   │   └── templates/
│   │       └── retro_card.html     # Generative UI 紧凑复盘卡片模板
│   └── ui-polish/                  # 【能力4：UI 设计审美原则】
└── rules/
    └── mind-rules.md               # 【全局核心】架构设计哲学、文档与双层仓库地图自动治理总则
```

---

## 7. 新会话接管与演进指引 (Context Continuity Guide)

在全新会话中接管本插件开发时，请遵循以下流程：

1. **读取本文件 (`design.md`) 与 [rules/mind-rules.md](rules/mind-rules.md)**：理解当前的 4 大正交维度、Google Decisions API 集成方式与执行契约；
2. **规则演进与维护**：
   - 通用架构红线、文档与双层仓库地图自动治理总则统一在 [rules/mind-rules.md](rules/mind-rules.md) 维护（`judge_router.py` 自动扫描 `rules/*.md` 加载）；
3. **测试路由与裁决链路**：
   - 运行 `py -3 skills/arch-judge/scripts/judge_router.py <target_workspace>` 验证特征提取是否精准无误；
   - 需要联调真实 Google Decisions API (`gemini-decision-1`) 时通过 `py -3 skills/arch-judge/scripts/decisions_client.py <target_workspace> <activated_categories>` 验证；
4. **插件同步与生效**：
   - Windows 平台已通过 `bindflt` 直通映射至 `%USERPROFILE%\.gemini\config\plugins\agent-mind`，在源码目录的所有改动会立即实时生效。
