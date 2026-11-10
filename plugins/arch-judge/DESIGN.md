# arch-judge 设计与演进架构规范 (DESIGN.md)

> **模块定位**：面向全生命周期软件架构治理的通用 Antigravity 插件。基于 TypeSafe AI 的 Jev 架构理念与 Google Antigravity SDK，提供两阶段代码拓扑调查、正交分类自适应路由与严格 Schema 结构化裁决，配合 Generative UI 输出顶级高颜值紧凑型交互报表。

---

## 1. 核心设计哲学 (Core Architectural Principles)

### 1.1 彻底抛弃 ArchUnit 等静态符号匹配
- **传统工具死穴**：依靠类名是否包含 `Compat`、是否有 `@Deprecated` 注解进行正则猜度。在真实复杂工程中，必然把正常协议驱动封装误判为违规、把 Protobuf 编译器自动生成的桩代码全部误报，却防不住改换名称的隐蔽违规。
- **语义裁决哲学**：架构红线是**高维的物理因果链与生命周期闭环**（如“是否破坏单一事实源”、“是否为了照顾旧系统私自保留双轨死代码”）。必须由具备上下文推理能力的 Judge 进行深入因果推断。

### 1.2 Jev-Style System One 决策模型
参考 TypeSafe AI 的 Jev 模型：
- **非自回归结构化分类 (Non-Autoregressive Classifier)**：不输出开放式小作文，专职做极速类型化裁决；
- **关闭深度思考 (Thinking Budget = 0)**：在终审定音阶段关闭 CoT 思维链，单次并行推断，保证响应毫秒级；
- **强制严格 Schema (Zero Hallucination)**：输出严格由 `schemas/verdict.json` 物理限定，0 格式解析错误。

### 1.3 两阶段审查流水线 (Two-Phase Pipeline)
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
• 零擅自向后兼容死代码         • 客户端 SDK 纯净隔离          • 高频热路径无排他锁           • 错误第一现场保留
```

- **路由脚本**：`skills/arch-judge/scripts/judge_router.py`（纯 Python 标库，无任何三方依赖，无任何特定项目硬编码，执行耗时 < 50ms）。

---

## 3. Generative UI 紧凑型现代报表设计 (Compact & Precision UI)

插件支持在 Antigravity 对话中通过 `<agent-embed>` 直接内嵌原生交互式卡片：
- **宿主语义 Tokens**：完全使用 `--card`, `--background`, `--foreground`, `--muted-foreground`, `--border` 等动态变量，自适应暗黑/浅色模式；
- **排版原则**：
  - 必须紧凑（高度收敛在 250px~320px 区间），信息密度高；
  - 采用 2x2 网格呈现 4 大正交维度状态（`0 违规` 绿色微徽章）；
  - 带有原生 `<details>` 变动溯源清单抽屉，可点击展开查看被审查文件的因果细节；
  - 置信度指标环（100% / 1.0）。

---

## 4. 目录与资产布局 (Directory Structure)

```text
E:\a8-devtools\plugins\arch-judge/
├── plugin.json                 # Antigravity 插件核心元定义
├── DESIGN.md                   # 【核心设计与架构规范】（本文件）
├── README.md                   # 跨项目安装与使用指南
├── agents/
│   └── arch-judge.md           # 专职审查 Subagent（只读权限沙箱）
├── skills/
│   └── arch-judge/
│       ├── SKILL.md            # 两阶段调查模式与 Jev 裁决技能规约
│       ├── schemas/
│       │   └── verdict.json    # Jev 结构化决断严格 JSON Schema
│       └── scripts/
│           └── judge_router.py # 纯通用语法元特征路由器
└── rules/
    ├── AGENTS.md               # 随插件全局生效的通用黄金架构红线
    ├── manifest.json           # 4 大正交维度元清单
    └── universal/              # 模块化规则源定义（带自声明 triggers）
        ├── NO_UNAPPROVED_BACKWARD_COMPAT.md
        ├── PURE_CLIENT_ISOLATION.md
        ├── HOT_PATH_NO_BLOCKING_LOCKS.md
        └── ERROR_TRANSPARENCY_NO_SWALLOW.md
```

---

## 5. 新会话接管与演进指引 (Context Continuity Guide)

在全新会话中接管本插件开发时，请遵循以下流程：

1. **读取本文件 (`DESIGN.md`) 与 `rules/manifest.json`**：理解当前的 4 大正交维度与执行契约；
2. **新增通用红线**：
   - 在 `rules/universal/` 下新建 `RULE_NAME.md`；
   - 顶部书写 YAML frontmatter，声明 `id`, `name`, `category`, 以及 `triggers`（包含语法标记 `syntax_tokens` 与文件通配 `file_patterns`）；
   - 在 `rules/manifest.json` 的 `universal_rules` 列表中追加引用；
3. **测试路由器**：
   - 运行 `python skills/arch-judge/scripts/judge_router.py <target_workspace>` 验证特征提取是否精准无误；
4. **插件同步与生效**：
   - Windows 平台已通过 Junction 联结至 `%USERPROFILE%\.gemini\config\plugins\arch-judge`，在源码目录的所有改动会立即实时生效。
