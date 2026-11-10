---
name: arch-judge
description: "通用语义架构红线裁判技能。基于 Jev 架构与两阶段调查模式，利用正交分类动态路由，对当前 Git Diff 及代码变更进行深层因果链审查与严格 Schema 结构化裁决。彻底摆脱传统 ArchUnit 的死板枚举与高误判。"
---

# Semantic Architecture Judge (语义架构裁判技能)

本技能提供跨项目通用的语义架构审查能力。采用 **两阶段调查模式（Two-Phase Investigation）** 结合 **TypeSafe AI Jev 极速结构化决策契约**，确保架构审查既有深层因果链事实支撑，又有毫秒级、0 废话的强类型裁决。

## 核心设计哲学

1. **告别死板枚举与机械匹配 (No AST Regex Guessing)**：
   不搞类名包含 `Compat` 等形式主义关键字匹配；基于代码改动的真实物理意图、调用拓扑与设计生命周期进行因果推理。
2. **两阶段审查流水线 (Two-Phase Pipeline)**：
   - **阶段一：架构调查与证据切片 (Thinking ON)**：只读工具探索，逆向追踪被修改代码的调用方、生命周期与 ADR 审批凭据，形成客观事实证据；
   - **阶段二：Jev 结构化裁决 (Thinking OFF / Strict Schema)**：对照 4 大正交维度进行布尔判定并输出标准 `ArchitectureVerdict`，直接指导构建门禁。
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
python <plugin_dir>/skills/arch-judge/scripts/judge_router.py <workspace_dir>
```
获取激活的 `activated_categories` 与跳过的维度，避免不必要的上下文浪费。

### 步骤 2：第一阶段——架构调查与事实确权 (Thinking ON)
针对激活维度的可疑点，使用只读工具展开纵深调查：
- 被修改的方法是否还有历史下游系统在调用？
- 删除或保留的接口，在 `docs/` 或提交信息中是否存在明确的 ADR 批准记录？
- 驱动或 SDK 是否悄悄引入了服务端的重型类库？

### 步骤 3：第二阶段——Jev 结构化定音 (Thinking OFF / Strict Schema)
将调查事实对照标准 Schema 进行判定。严格按照 `schemas/verdict.json` 输出 JSON 报告：
- 若所有激活维度均合规，返回 `PASSED`；
- 若存在确凿红线破坏，返回 `VIOLATED`，并在 `violations` 中明确指出：
  - `rule_id`: 违规红线标识符
  - `file_path`: 物理文件路径与行号
  - `violation_reason`: 具体因果物理事实证据（非推测）
  - `actionable_fix`: 明确、可直接执行的代码级修正或删除指引。
- 若存在无法求证的极端假想，按照 YAGNI 原则标记为观察项，严禁私自加复杂度。
