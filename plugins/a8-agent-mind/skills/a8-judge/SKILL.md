---
name: a8-judge
description: "通用语义架构红线裁判技能。以 Git Diff 为变更指针，由只读 arch-judge 子代理主动分析目标仓库现状（AGENTS.md、docs/ 设计文档、完整源码与调用链），并辅以 judge_router.py 与 Google Gemini Decisions API 概率初筛雷达完成 4 大正交维度架构裁决。依据 mind-rules.md 由 AI 在触及架构红线的代码变更交卷前自主择机调度一次（无需人工触发），亦支持 /a8-judge。"
---

# Semantic Architecture Judge (`a8-judge`)

本技能提供跨仓库通用的语义架构审查能力。核心定位：**Git Diff 只是定位“改了什么”的入口指针；真正的终审裁判是具备全仓只读视野的 `arch-judge`（能够主动阅读 `AGENTS.md`、`docs/` 设计文档、完整代码文件与上下游调用链），而 `judge_router.py` 与 `decisions_client.py` 负责变更/文档路由与零输出 Token 先验概率初筛。**

## 触发机制：AI 自主择机终审（无需人工调用）
- **常规自主闭环（遵循 `mind-rules.md`）**：凡涉及代码、接口契约、模块依赖、并发锁或核心生命周期变更且触及 4 大正交维度之一时，AI 应在代码修改与本地编译通过后、正式交卷汇报前**自主择机主动调度一次 `arch-judge` 只读子代理**完成红线自检（仅局部机械初筛时可先跑脚本；一旦涉及设计意图或脚本初筛存疑，严禁跳过 `docs/` 与全仓核查直接下定论）；
- **自主免检边界**：纯文档、注释、仓库地图（`AGENTS.md` / `repos.md`）同步或无关轻量文案/样式调整，AI 自主跳过本检查；
- **显式指令覆盖**：当用户输入 `/a8-judge` 或 `@arch-judge` 时，无论变更大小立即强制执行完整裁决。

## 核心设计哲学

1. **Diff 只是指针，项目现状 + `docs/` 才是裁决依据**：
   - 不只盯着几行 Git Diff 下结论；`arch-judge` 必须先读 `AGENTS.md` 与命中的 `docs/*.md`（SPEC/ADR/BUG），理解为什么这样设计、哪些边界刻意保留、哪些旧逻辑应清缴；
   - **已在 `docs/` 中明确论证的设计权衡不得反复报错**；真正要抓的是“未闭环的隐蔽破坏链”或“代码与 `docs/` 约定矛盾”。
2. **变更与文档路由 (`judge_router.py`) + 概率初筛雷达 (`decisions_client.py`)**：
   - `judge_router.py` 毫秒级提取变更文件、触发规则与**推荐必读文档清单 `relevant_docs`**；
   - `decisions_client.py` 调用 `gemini-decision-1` 对局部 Diff（自动附带轻量 `Documented Design Context`）给出先验风险初筛，供 `arch-judge` 参考或快速定位嫌疑块，而非无条件一票否决。
3. **4 大正交维度动态路由 (Orthogonal Categories)**：
   - `lifecycle_and_evolution`: 演化契约、零擅自向后兼容、旧模型破坏权剥离；
   - `topology_and_boundaries`: 系统边界自闭环、底层纯库零重型框架侵入、模块单向分层；
   - `concurrency_and_performance`: 热路径无方法锁、杜绝幽灵轮询反查；
   - `implementation_hygiene`: 单一解析路径、错误保留物理第一现场、日志门面规范。

---

- **核心职责分明**：`arch-judge` 具备完整的 `run_command` / `read_file` / `search_web` 等工具自由（不设只读工具阉割限制），可自主运行路由脚本、检索调用链与通读 `docs/`；`judge_router.py` 与 `decisions_client.py` 仅作为辅助初筛工具。

## 执行协议与指引

### 步骤 1（首选路径）：调度具备完整工具自由的 `arch-judge` 子代理终审
调用 `invoke_subagent(TypeName="arch-judge", ...)`，让其自主完成：
1. 运行 `py -3 <plugin_dir>/skills/a8-judge/scripts/judge_router.py <workspace_dir>`（可带 `--paths`），拿到 `changed_files` 与 `relevant_docs`；
2. 通读 `AGENTS.md`、`relevant_docs` 指向的 `docs/*.md`、相关完整源码文件与调用链（自由使用 `read_file` / `run_command` 搜索求证）；
3. 自主运行 `decisions_client.py` 作为先验概率参考；若其与 `docs/` 或代码全貌存在认知偏差，以 `docs/` 与调用链物理事实为准独立裁决。

### 步骤 2（底层脚本参考）：路由与 Decisions API 初筛命令
```bash
py -3 <plugin_dir>/skills/a8-judge/scripts/judge_router.py <workspace_dir>
py -3 <plugin_dir>/skills/a8-judge/scripts/decisions_client.py <workspace_dir> <activated_categories>
```
（支持 `<workspace_dir>` 目录、单文件路径、`--stdin`、`--paths <path1,path2>` 及 `--last-commit`；自动从 `AGENTS.md` + `docs/` 注入有界 `Documented Design Context` 并按 hunk 无损分片，同时加载 `<plugin_dir>/decisions/*.decision.json`、`<workspace>/scripts/lints/*.decision.json` 与规则文件。）

结果处理原则：
- 若基于项目现状 + `docs/` 核查合规，返回 `PASSED`（列出实际核验的 `docs/` 与文件）；
- 若存在确凿红线破坏或违背 `docs/` 约定，返回 `VIOLATED` 与精确 `file_path` / `actionable_fix`；
- 若存在 API 缺失或无法从现状求证的待定边界，返回 `REQUIRES_APPROVAL` 请求人工拍板。
