# agent-mind 设计与演进架构规范 (design.md)

> **模块定位**：面向自主智能体的工程良知与持续演进心智中枢（Agent Mind）。基于 TypeSafe AI 的 Jev 架构理念与 Google Antigravity SDK，融合**“全局文档与架构地图治理”**、**“两阶段代码架构因果链裁决 (/judge)”**与**“收尾经验复盘与规则反哺 (/improve)”**，构建真正实现工程规范自主闭环的智能体心智中枢。

---

## 1. 核心设计哲学 (Core Architectural Principles)

### 1.1 智能体心智的三层模型 (The Tripartite Mind)
1. **理智与戒律 (Super-ego / 架构红线)**：通过 Jev 两阶段推理模型，对代码变动执行冷酷、毫秒级、0 幻觉的架构红线审查 (`/judge`)；
2. **认知与记忆大地图 (Memory / 架构蓝图)**：通过 `doc.md`，统一跨项目的文档命名格式 (`YYYYMMDD-<TYPE>-...`)、建档门槛与 `AGENTS.md` 索引地图；
3. **反思与神经生长 (Reflection / 规则反哺)**：在任务收尾时由人类触发 `/improve`，扫描第一现场踩坑报错，提炼规则补丁并经由人类确认落盘。

### 1.2 彻底抛弃 ArchUnit 等静态符号匹配
- **传统工具死穴**：依靠类名是否包含 `Compat`、是否有 `@Deprecated` 注解进行正则猜度。在真实复杂工程中，必然把正常协议驱动封装误判为违规、把 Protobuf 编译器自动生成的桩代码全部误报，却防不住改换名称的隐蔽违规。
- **语义裁决哲学**：架构红线是**高维的物理因果链与生命周期闭环**（如“是否破坏单一事实源”、“是否为了照顾旧系统私自保留双轨死代码”）。必须由具备上下文推理能力的 Judge 进行深入因果推断。

### 1.3 Jev-Style System One 决策模型
参考 TypeSafe AI 的 Jev 模型：
- **非自回归结构化分类 (Non-Autoregressive Classifier)**：不输出开放式小作文，专职做极速类型化裁决；
- **关闭深度思考 (Thinking Budget = 0)**：在终审定音阶段关闭 CoT 思维链，单次并行推断，保证响应毫秒级；
- **强制严格 Schema (Zero Hallucination)**：输出严格由 `schemas/verdict.json` 物理限定，0 格式解析错误。

### 1.4 两阶段审查流水线 (Two-Phase Pipeline)
既要“读得够深、事实确凿”，又要“定音极速、格式严谨”：
1. **阶段一：调查深思 (Thinking ON)**：
   - 使用只读工具（`read_file`、搜索引用），从 Git Diff 顺着依赖拓扑向上追溯调用方、横向比对项目文档（ADR）；
   - 输出客观事实证据链。
2. **阶段二：Jev 定音 (Thinking OFF / Strict Schema)**：
   - 汇集证据，对照 4 大正交维度输出结构化布尔判定与置信度。

---

## 2. 4 大正交关注点与通用元特征路由 (Zero Project Hardcoding)

为了防止“一锅端导致大模型注意力稀释丢检查项”，同时防止“逐条检查导致 Token 浪费与延迟暴增”，将全量规则划分为 4 个物理正交维度，并基于 **代码变更的语法元特征** 自动路由：

```
                                  Git Diff 原始变动
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
【演化与生命周期契约】          【系统边界与拓扑隔离】          【并发安全与热路径性能】          【实现规范与单一路径】
• `@Deprecated`, `obsolete`    • `import`, `package`          • `synchronized`, `Lock`       • `catch`, `throw`
• 公开 API 签名增删            • 构建依赖 (`pom/json/mod`)    • `Thread`, `volatile`         • `System.out`, 日志门面
• 零擅自向后兼容死代码         • 客户端 SDK 纯净隔离          • 高频热路径无排他锁           • 文档与架构索引同步
```

- **路由脚本**：`skills/arch-judge/scripts/judge_router.py`（纯 Python 标库，无任何三方依赖，无任何特定项目硬编码，执行耗时 < 50ms）。

---

## 3. 双子星架构：冷酷裁决 (/judge) 与 经验沉淀 (/improve)

为了避免传统工具将“守门审查”与“经验沉淀”混为一谈导致的注意力稀释，本插件采用**职责正交的双子星架构**：

```
                    【日常编码 / 任务推进】
                              │
             代码修改完成     ▼
        ┌───────────────────────────────┐
        │     arch-judge (冷酷法官)     │  <-- 阶段：提交前守门
        │  • 运行方式：只读 Subagent    │  <-- 权限：只读沙箱
        │  • 心智模型：Jev System One   │  <-- 决策：布尔判定、严格 Schema
        │  • 触发指令：/judge           │
        └──────────────┬────────────────┘
                       │ (审查通过 / 任务准备收尾)
                       ▼
        ┌───────────────────────────────┐
        │    arch-improve (复盘沉淀)    │  <-- 阶段：会话收尾 (Wrap-up)
        │  • 运行方式：当前主会话 (零子代理)│ <-- 优势：持有完整踩坑第一现场
        │  • 输出载体：Generative UI    │  <-- 交互：紧凑卡片 + 规则补丁 Diff
        │  • 触发指令：/improve         │  <-- 确认：人机协同确认后落盘
        └───────────────────────────────┘
```

---

## 4. 上下文防火墙与防降智流水线 (Context Firewall & Anti-Degradation)

- **痛点根治**：频繁在主会话中运行全量测试套件或静态分析，会导致成百上千行 Traceback 报错与编译器日志直接砸碎上下文，模型注意力陷入“消灭眼前报错”的目标漂移，催生大量拆东墙补西墙的防御性废代码。
- **两阶段解耦机制**：
  1. **开发主干期测试静音 (Dev Silence)**：编码与调优阶段专注业务主干逻辑、状态机自洽与视觉交互，严禁在主会话反复刷屏跑全量单测；
  2. **验证收尾期沙箱隔离 (Subagent as Context Firewall)**：需要全量单测或重型静态分析时，统统交由只读 Subagent（如 `arch-judge`）在独立子进程中执行。数千行脏日志在沙箱中“用完即焚”，主会话仅接收结构化的高密度诊断骨架（失败用例、物理行号与因果核心），保证主会话上下文终身纯净。

---

## 5. Generative UI 紧凑型现代报表设计 (Compact & Precision UI)

插件支持在 Antigravity 对话中通过 `<agent-embed>` 直接内嵌原生交互式卡片：
- **宿主语义 Tokens**：完全使用 `--card`, `--background`, `--foreground`, `--muted-foreground`, `--border` 等动态变量，自适应暗黑/浅色模式；
- **排版原则**：
  - 必须紧凑（高度收敛在 250px~360px 区间），信息密度高；
  - `arch-judge` 报表：采用 2x2 网格呈现 4 大正交维度状态（`0 违规` 绿色微徽章），带有 `<details>` 变动溯源清单；
  - `arch-improve` 复盘卡片：顶部呈现任务核心交付亮点，中部呈现工作流/环境痛点，底部呈现标准 `git diff` 格式的规则补丁草案，直观展示建议合入的 `AGENTS.md` / `rules/` 内容。

---

## 5. 目录与资产布局 (Directory Structure)

```text
E:\a8-devtools\plugins\agent-mind/
├── plugin.json                 # Antigravity 插件核心元定义
├── design.md                   # 【核心设计与架构规范】（本文件）
├── readme.md                   # 跨项目安装与使用指南
├── agents/
│   └── arch-judge.md           # 专职审查 Subagent（只读权限沙箱）
├── skills/
│   ├── arch-judge/             # 【能力1：冷酷架构裁决】
│   │   ├── SKILL.md            # 两阶段调查模式与 Jev 裁决技能规约
│   │   ├── schemas/
│   │   │   └── verdict.json    # Jev 结构化决断严格 JSON Schema
│   │   └── scripts/
│   │       └── judge_router.py # 纯通用语法元特征路由器
│   └── arch-improve/           # 【能力2：任务收尾复盘与规则反哺】
│       ├── SKILL.md            # 主会话执行规约与规则提炼指令
│       └── templates/
│           └── retro_card.html # Generative UI 紧凑复盘卡片模板
└── rules/
    ├── manifest.json           # 4 大正交维度元清单
    ├── redline.md              # 【全局核心】通用架构设计哲学与根本红线
    └── doc.md                  # 【全局核心】文档与系统大地图治理规范
```

---

## 6. 新会话接管与演进指引 (Context Continuity Guide)

在全新会话中接管本插件开发时，请遵循以下流程：

1. **读取本文件 (`design.md`) 与 `rules/manifest.json`**：理解当前的 4 大正交维度与执行契约；
2. **规则演进与维护**：
   - 通用架构红线统一在 [rules/redline.md](rules/redline.md) 维护；
   - 文档与大地图管理规约统一在 [rules/doc.md](rules/doc.md) 维护；
   - 彻底告别多层嵌套与冗余杂质；
   - 在 `rules/manifest.json` 的 `universal_rules` 列表中追加引用；
3. **测试路由器**：
   - 运行 `python skills/arch-judge/scripts/judge_router.py <target_workspace>` 验证特征提取是否精准无误；
4. **插件同步与生效**：
   - Windows 平台已通过 Junction 联结至 `%USERPROFILE%\.gemini\config\plugins\agent-mind`，在源码目录的所有改动会立即实时生效。
