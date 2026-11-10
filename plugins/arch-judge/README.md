# Semantic Architecture Judge (`arch-judge`)

基于 Google Antigravity SDK 与 TypeSafe AI Jev 架构理念打造的通用语义架构红线裁判插件。

---

## 解决的核心痛点
- **彻底告别 ArchUnit 的死板与高误判**：不依赖类名关键字与 AST 符号猜测，基于代码变更的物理意图与生命周期闭环进行深层因果推理；
- **防止注意力稀释与丢检查项**：将全量红线聚合成 4 大正交维度，结合 Git Diff 语法元特征自适应路由，无关维度毫秒级跳过；
- **两阶段执行流水线**：
  - **阶段一（调查官）**：深度探索 (Thinking ON) 追踪调用拓扑与 ADR 事实；
  - **阶段二（Jev 定音）**：关闭思考 (Thinking OFF) + 严格 Schema 约束，毫秒级输出确定性布尔结论。

---

## 插件结构
```text
arch-judge/
├── plugin.json                 # 插件元信息
├── agents/
│   └── arch-judge.md           # 专职审查 Subagent（只读沙箱）
├── skills/
│   └── arch-judge/
│       ├── SKILL.md            # 两阶段审查技能规范
│       ├── schemas/verdict.json# Jev 结构化决断 Schema
│       └── scripts/judge_router.py # 通用元特征路由提取器
└── rules/
    ├── AGENTS.md               # 通用黄金架构红线
    ├── manifest.json           # 4 大正交维度清单
    └── universal/              # 模块化规则源定义
```

---

## 安装与使用

### 1. 安装插件
将本目录复制或软链接至 Antigravity 用户插件目录：
- Windows: `%USERPROFILE%\.gemini\config\plugins\arch-judge`
- Linux / macOS: `~/.gemini/config/plugins/arch-judge`

### 2. 在任意项目中触发审查
在对话框输入：
```text
请执行架构红线审查 (/judge)
```
或者 Coding Agent 在提交前自动调用 `arch-judge` Subagent 审查工作区变更。
