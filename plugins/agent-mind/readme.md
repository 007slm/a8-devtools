# Agent Mind (`agent-mind`)

> **面向自主智能体的工程良知与持续演进心智中枢**。融合**代码架构红线裁决 (`/judge`)**、**会话复盘与规则反哺 (`/improve`)** 及 **全局文档与架构大地图治理规范 (`doc.md`)**。

---

## 解决的核心痛点

1. **架构红线守门 (The Conscience)**：彻底告别 ArchUnit 的死板与高误判，基于代码变更物理意图与生命周期闭环进行两阶段因果链深层推理；
2. **规范统一分发 (The Blueprint)**：告别各子项目复制粘贴 `doc.md` 的版本偏离痛点，全局统一定义 `docs/` 命名、建档门槛与 `AGENTS.md` 索引地图；
3. **经验自主进化 (The Growth)**：任务收尾时一键提炼踩坑痛点与环境问题，生成规则补丁草案（Diff），经由人类确认后自愈生长；
4. **上下文防火墙 (Context Firewall)**：研发期测试静音，杜绝海量测试报错冲垮主会话；全量单测与 Lint 隔离在 Subagent 沙箱中用完即焚，彻底根除拆东墙补西墙的降智死循环。

---

## 插件结构

```text
agent-mind/
├── plugin.json                 # 插件元信息
├── design.md                   # 核心设计与演进架构规范
├── readme.md                   # 使用与维护指南
├── agents/
│   └── arch-judge.md           # 专职审查 Subagent（只读沙箱）
├── skills/
│   ├── arch-judge/             # 【能力1：冷酷架构裁决】(/judge)
│   ├── arch-improve/           # 【能力2：任务收尾复盘与规则反哺】(/improve)
│   └── ui-polish/              # 【能力3：企业级秩序与极简美学的 UI 设计原则】
└── rules/
    ├── manifest.json           # 4 大正交维度清单
    ├── redline.md              # 【全局核心】通用架构设计哲学与根本红线
    └── doc.md                  # 【全局核心】文档与系统大地图治理规范
```

---

## 安装与使用

### 1. 安装插件
本目录已通过软链接（Junction）实时挂载至 Antigravity 用户插件目录：
- Windows: `%USERPROFILE%\.gemini\config\plugins\agent-mind`
- Linux / macOS: `~/.gemini/config/plugins/agent-mind`

### 2. 在任意项目中触发

#### 场景 A：提交前架构审查（守门）
在对话框输入：
```text
/judge
```
或 `@arch-judge 审查`，只读 Subagent 启动两阶段推理审查。

#### 场景 B：任务收尾复盘与规则沉淀（反哺）
当任务完成、准备提交代码时，在当前会话输入：
```text
/improve
```
无需启动 Subagent，直接在当前会话生成紧凑型 Generative UI 交互卡片，呈现踩坑点与建议增补至 `AGENTS.md` / `rules/` 的规则补丁草案（Diff），人工确认后一键落盘。

#### 场景 C：日常开发自动遵循文档规约（立规）
插件已全局生效 `doc.md`，Agent 在各项目中将自动遵循：
- 新增独立文档需符合 `YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`；
- 遵循建档门槛，禁止为微小改动滥建文档；
- 同步更新项目根目录 `AGENTS.md` 索引地图。
