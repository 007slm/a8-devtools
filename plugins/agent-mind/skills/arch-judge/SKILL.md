---
name: arch-judge
description: "通用语义架构红线裁判技能。基于语法元特征自适应路由（judge_router.py）与 Google Gemini Decisions API（gemini-decision-1 零输出 Token 概率校准裁决），对当前 Git Diff 及代码变更进行 4 大正交维度毫秒级结构化裁决。依据 mind-rules.md 由 AI 在触及架构红线的代码变更交卷前自主择机调用一次（无需人工触发），亦支持用户通过 /judge 显式发起。"
---

# Semantic Architecture Judge (语义架构裁判技能)

本技能提供跨仓库通用的语义架构审查能力。结合 **语法元特征自适应路由 (`judge_router.py`)** 与 **Google Gemini Decisions API (`gemini-decision-1` 零输出 Token 概率校准定音)**，确保架构审查既有精准事实支撑，又有毫秒级、0 废话的强类型裁决。

## 触发机制：AI 自主择机终审（无需人工调用）
- **常规自主闭环（遵循 `mind-rules.md`）**：凡涉及代码、接口契约、模块依赖、并发锁或核心生命周期变更且触及 4 大正交维度之一时，AI 应在代码修改与本地编译通过后、正式交卷汇报前**自主择机主动执行一次本技能**（或调度只读 `arch-judge` 子代理）完成红线自检，不依赖用户手动调用；
- **自主免检边界**：纯文档、注释、仓库地图（`AGENTS.md` / `repos.md`）同步或无关轻量文案/样式调整，AI 自主跳过本检查；
- **显式指令覆盖**：当用户输入 `/judge` 或 `@arch-judge` 时，无论变更大小立即强制执行完整裁决。

## 核心设计哲学

1. **告别死板枚举与机械匹配 (No AST Regex Guessing)**：
   不搞类名包含 `Compat` 等形式主义关键字匹配；基于代码改动的真实物理意图、调用拓扑与设计生命周期进行语义判断。
2. **语法元特征自适应路由 + Google Gemini Decisions API 零输出 Token 定音**：
   先由 `judge_router.py` 毫秒级识别变更触及的正交维度，再由 `decisions_client.py` 调用 Google Gemini Decisions API (`gemini-decision-1`) 直接输出校准先验概率与布尔判定，必要时结合只读上下文核查调用链与 ADR 凭据。
3. **4 大正交维度动态路由 (Orthogonal Categories)**：
   - `lifecycle_and_evolution`: 演化契约、零擅自向后兼容、旧模型破坏权剥离；
   - `topology_and_boundaries`: 客户端 SDK 纯净隔离、模块单向分层；
   - `concurrency_and_performance`: 热路径无方法锁、杜绝幽灵轮询反查；
   - `implementation_hygiene`: 单一解析路径、错误保留物理第一现场、日志门面规范。

---

## 执行协议与指引

### 步骤 1：捕获变动与正交分类自适应路由
运行插件内置路由工具分析当前变更：
```bash
py -3 <plugin_dir>/skills/arch-judge/scripts/judge_router.py <workspace_dir>
```
获取激活的 `activated_categories` 与跳过的维度，避免不必要的上下文浪费。

### 步骤 2：调用 Google Gemini Decisions API 执行校准概率裁决并核实物理现场
针对激活维度，调用插件内置的 Google Gemini Decisions API (`gemini-decision-1`) 客户端执行零输出 Token 概率校准定音：
```bash
py -3 <plugin_dir>/skills/arch-judge/scripts/decisions_client.py <workspace_dir> <activated_categories>
```
（支持 `<workspace_dir>` 目录自动提取 Git Diff、单文件路径或 `--stdin`；工作区无变更且需审上一次提交时可追加 `--last-commit`。）

脚本自动读取插件配置 `config.json` 并展开 `${GEMINI_API_KEY}` 环境变量，同时动态加载 `rules/*.md` 增量规则判据；再结合以下只读上下文查证要点给出裁决报告：
- 被修改的方法是否还有历史下游系统在调用？
- 删除或保留的接口，在 `docs/` 或提交信息中是否存在明确的 ADR 批准记录？
- 驱动或 SDK 是否悄悄引入了服务端的重型类库？

结果处理原则：
- 若所有激活维度均合规且置信度达标，返回 `PASSED`，输出 calibrated probabilities；
- 若存在确凿红线破坏，返回 `VIOLATED`，核实物理文件路径、行号与因果事实后输出 `actionable_fix`（可直接执行的代码级修正或删除指引）；
- 若存在 API 缺失、Diff 截断、置信度低于阈值或无法求证的推测边界，返回 `REQUIRES_APPROVAL` 请求人工确认，严禁私自加复杂度。
