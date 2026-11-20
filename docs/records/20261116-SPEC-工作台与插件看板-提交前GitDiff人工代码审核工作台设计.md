# SPEC：提交前 Git Diff 人工代码审核工作台设计

- **日期**：2026-11-16
- **状态**：已落地（当时有效）
- **域**：dashboard-and-workflows.md
- **取代**：无

---

## 1. 问题与目标

- **要解决的问题**：在执行 `git commit` 前人工把关 AI 修改的大量文件时，需要按仓库独立审阅工作区/暂存区变更，并在行级批注后结构化回传给 AI 闭环修复；若把该流程塞入「心智治理」会混淆职责。
- **设计目标**：开辟独立一级入口「代码审核（Commit Review）」，提供 Rust / Node 同源 `get_repo_git_diff` 接口、未追踪文件合成 Diff 及行级/跨行结构化批注工作台。

## 2. 核心设计与结论

1. **正交一级入口挂载**：桌面端左侧导航栏（`activeTab = 'code-review'`）与命令面板、独立 Web（`:18765`）及 Sidecar 顶栏双模块切换器（支持 `?tab=code-review`）共享同一 `CodeReviewTab` 组件，与 `AgentMindView` 职责正交。
2. **控制面协议与安全/截断边界**：
   - Tauri Command `get_repo_git_diff` ↔ HTTP `POST /api/agent-mind/git/diff`（入参 `{ repo_code, scope?: "all" | "staged" | "unstaged" }`，返参 `GitReviewDiffDto`）；
   - 通过 `resolve_registered_repo_root` 仅放行 `repos.md` 已登记仓库；Rust 端固定 `creation_flags(0x08000000)`、Node 端 `windowsHide: true` 且统一附带 `-c core.quotePath=false` 防黑窗与中文转义；
   - `all` / `unstaged` 模式下经 `git ls-files --others --exclude-standard` 扫描未追踪文件，探测前 8 KB `\0` 识别二进制后将纯文本合成为标准 Unified Diff；单文件 Diff 上限 `300 KB`，未追踪文件上限 `256 KB` / `2500` 行，超限置 `truncated = true`。
3. **双视图渲染与反馈回传**：
   - `gitDiff.ts` 支持 `Split`（行内字符级对比）与 `Unified` 视图、`useMemo` 预计算、`React.memo` 隔离及前 `350` 行首屏按需展开；
   - `CodeReviewTab.tsx` 支持点击或 `Shift + 点击` 行号框选行范围添加分类批注（`a8_code_review_v1:<repoCode>` 存 `localStorage`），并由 `formatReviewFeedbackMarkdown` 一键生成批注反馈或放行声明（后在 2026-11-20 ADR 中补充 `has_git` 无 Git 显式告警）。

## 3. 当时验证范围

- **2026-11-16 验证**：前端 `npm run build`（`tsc -b && vite build`）通过；`cargo test --workspace` 全绿（含 `test_parse_git_diff_blocks_and_untracked_synthesis`）与 `cargo check --workspace` 通过；仓库门禁 `check_swallowed_exceptions.mjs`、`check_workspace_hygiene.mjs`、`check_plugin_agents.py` 全绿。

## 4. 对常青文档的影响

- 本设计与接口边界已完整沉淀至 [dashboard-and-workflows.md](../evergreen/dashboard-and-workflows.md)。
