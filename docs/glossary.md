# a8-devtools 项目术语表

> 本术语表由 `AGENTS.md`、常青文档（`docs/evergreen/`）与工作记录（`docs/records/`）共同使用。  
> **使用原则**：除业界通用技术词（如 `Git`、`Tauri`、`Win32`、`COM`、`HTTP`、`CORS`、`SVG`）和反引号包裹的真实代码名外，文档可直接引用下表术语；**不在下表中的概念，要么补充登记进本表并用一句话普通话讲清，要么在正文里直接用普通话写清楚**，禁止直接抛出未定义的简称或黑话。

| 术语 | 普通话含义 | 常见位置 / 源码锚点 |
| :--- | :--- | :--- |
| **CowFS / 写时复制（Copy-Up）** | 基于 WinFsp 的虚拟工作区文件系统；多个工作区只读共享同一份原始源码，仅在某个工作区修改文件时，才把该文件复制一份到独立差异目录，避免整仓拷贝。 | `modules/cowfs/`、`copy_up.rs` |
| **Lower / Upper 层** | Lower 层指原始源码目录（只读不改）；Upper 层指源目录内的 `.cowdiff/<pathHash>/diff/`，专门存放当前工作区新增或修改过的文件。 | `modules/cowfs/src/cow/state.rs` |
| **Whiteout（删除标记）** | 在工作区删除原始文件时，不真的删除原始源码文件，而是在差异层对应目录生成一个 `.cow_deleted.<文件名>` 标记文件，合并展示时隐藏该文件。 | `modules/cowfs/src/cow/whiteout.rs` |
| **重入死锁（Zero Re-entrancy）** | 如果差异目录放在虚拟挂载点里面，文件系统读写差异层时又会触发自己，造成无限递归卡死；因此 `.cowdiff` 必须放在挂载点外部，且在路径解析和目录遍历层根级隐藏。 | `LayerState::resolve`、`DirectoryMerger` |
| **bindflt（内核直通映射）** | Windows 内置的 Bind Filter 内核驱动；`cowfs link --direct` 直接调用它把目录映射到目标路径，不经用户态中转，目录属性与普通文件夹完全一致。 | `modules/cowfs/src/bindflt.rs` |
| **零黑窗（Zero Console Flashing）** | 禁止通过 `cmd.exe`、`powershell.exe`、`sc.exe`、`taskkill.exe` 等外部命令做后台探测或操作，一律用原生 Win32 API 或 `CREATE_NO_WINDOW`（`0x08000000`），避免弹出命令行黑窗口。 | `modules/devtools/src/` |
| **三端同源** | 桌面端主窗口（Tauri）、进程内本地网页看板（`127.0.0.1:18765`）与 Antigravity 插件侧栏（Sidecar）加载完全同一份前端构建产物（`modules/devtools/ui/`），绝不维护多套独立前端页面。 | `modules/devtools/web/`、`sidecar.rs`、`main.mjs` |
| **Sidecar（插件侧栏宿主）** | Antigravity 插件后台启动的本地 Node 服务进程，负责在 IDE 辅助侧栏中托管看板静态页面并转发本地控制面 API。 | `plugins/a8-agent-mind/sidecars/panel/main.mjs` |
| **A8 Agent Mind** | 本仓维护的全局智能体治理插件（`plugins/a8-agent-mind`），包含规则约束（`mind-rules.md`）、提示词深化（`/a8-prompt`）、工程工作流（`a8-workflow`）、快慢双轨文档治理（当前会话轻更新 + 每晚 20:00 `scan_docs_sync.mjs` / `docs-sync` 全量梳理）、架构初筛裁判（`a8-judge`）、深度终审（`dsh-reviewer`）与经验复盘（`/a8-improve`）。 | `plugins/a8-agent-mind/` |
| **DSH（DeepSeek Harness）** | 本机运行的深度代码终审引擎，由 `/a8-dsh-review` 触发，负责对跨文件改动执行多轮只读架构审查并归档报告。 | `plugins/a8-agent-mind/agents/dsh-reviewer.md` |
| **Decisions API** | Google Gemini 的结构化判定接口（`gemini-decision-1`），只返回布尔选项和置信度概率，用于 `a8-judge` 架构红线初筛和 `Stop` Hook 文档同步判定。 | `decisions_client.py`、`stop_reflect.py` |
| **常青文档 / 工作记录** | 双层文档体系：`docs/evergreen/` 按模块只保留当前生效的系统规范，高频主读；`docs/records/` 按日期保存重大决策（`ADR`）、规范（`SPEC`）与深层排障（`BUG`）的历史快照。 | `docs/evergreen/`、`docs/records/` |
| **验证地图（`docs/verify.md`）** | 仓库级真实验证路由手册：规定各模块改动后必须跑通的真实运行表面、端到端物理判据、Mock 与本地环境盲区，禁止仅凭编译通过或局部单测假绿宣布完成。 | `docs/verify.md`、`scripts/lints/` |
