# 提交前 Git Diff 人工代码审核工作台设计 (`SPEC`)

> **文档状态**：已实现并通过编译与单测 | **适用模块**：[`modules/devtools/`](file:///e:/a8-devtools/modules/devtools/), [`plugins/a8-agent-mind/sidecars/panel/`](file:///e:/a8-devtools/plugins/a8-agent-mind/sidecars/panel/)
> **建档缘由**：规约 `a8-devtools` 独立一级入口「代码审核（Commit Review）」的三端同源控制面协议、Git Diff 提取与截断边界，以及参考 Plannotator 的行级批注与剪贴板反馈回传闭环。

---

## 1. 领域正交定位：独立一级入口（非心智治理子页）

- **心智治理 (`AgentMindView`)** 聚焦长期规则、Google Decisions、Lint 门禁、DSH 终审归档与每日提案；
- **代码审核 (`CodeReviewTab`)** 聚焦提交 `git commit` 前的实时工作区/暂存区代码人工把关，作为独立一级模块挂载于：
  1. **桌面工作台 (`a8-devtools.exe`)**：左侧导航栏 `核心特性 -> 代码审核`（`activeTab = 'code-review'`）及命令面板；
  2. **独立 Web (`:18765`) 与 Antigravity Sidecar (`main.mjs`)**：顶栏独立双模块切换器（`心智治理` | `代码审核`，支持 `?tab=code-review` 直达）。

---

## 2. 控制面协议与安全/性能边界

| 能力 | Tauri Command (`agent_mind.rs`) | HTTP 路由 (`sidecar.rs` & `main.mjs`) | 入参 / 返参 |
| :--- | :--- | :--- | :--- |
| 拉取仓库 Git Diff | `get_repo_git_diff` | `POST /api/agent-mind/git/diff` | `{ repo_code, scope?: "all" \| "staged" \| "unstaged" }` -> `GitReviewDiffDto` |

核心实现约束：
1. **仓库白名单隔离**：`resolve_registered_repo_root` 仅允许读取 `repos.md` 已登记的仓库目录，拒绝任意磁盘路径注入。
2. **零黑窗与中文路径防转义**：Rust 端固定 `creation_flags(0x08000000)`，Node 端固定 `windowsHide: true`，并统一附带 `-c core.quotePath=false`。
3. **未追踪文件合成与边界保护**：
   - `scope` 为 `all` 或 `unstaged` 时，通过 `git ls-files --others --exclude-standard` 扫描未追踪文件；
   - 探测前 8 KB 是否包含 `\0` 字节识别二进制文件；纯文本文件合成为标准 `diff --git` Unified Diff 格式交由前端统一渲染；
   - 单文件 Diff 上限 `300 KB`，未追踪文件上限 `256 KB` / `2500` 行，超限按行边界截断并置 `truncated = true`。

---

## 3. 前端交互与结构化反馈契约

- **解析与双视图渲染（[`gitDiff.ts`](file:///e:/a8-devtools/modules/devtools/web/src/utils/gitDiff.ts)）**：
  - 默认采用 `Split`（左右对照 + `computeIntraLineDiff` 行内字符级高亮）与「单文件聚焦」模式（可切换 `Unified` 与 `全部文件`），单文件默认首屏渲染前 `350` 行并可按需展开全量、同时使用 `useMemo` 预计算与 `React.memo` 隔离输入重绘以保障大 Diff 流畅滚动；
  - 左侧可折叠文件树支持按路径检索、状态徽标（`M`/`A`/`D`/`R`/`U`）、`已审阅` 勾选与批注数量统计。
- **行级 / 跨行批注与剪贴板回传（[`CodeReviewTab.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/components/CodeReviewTab.tsx)）**：
  - 点击行号槽位即可打开内联批注框，`Shift + 点击` 支持框选多行范围（`L12-L18`），不干扰代码区正常拖选复制；
  - 支持 `设计问题` / `逻辑缺陷` / `修改建议` / `疑问确认` 分类标签、可选建议替换代码块及文件级批注，按 `a8_code_review_v1:<repoCode>` 缓存至 `localStorage`；
  - `formatReviewFeedbackMarkdown` 将批注汇总为确定性 Markdown（支持 `复制审阅反馈` 与 `复制放行 Commit`），用户回 Antigravity 对话框粘贴即可驱动修改或放行提交。

---

## 4. 交卷验证记录

- **前端**：`npm run build`（`tsc -b && vite build`）通过，产物 [index.html](file:///e:/a8-devtools/modules/devtools/ui/index.html) 无 `type="module"` 或 `crossorigin`。
- **Rust 工作区**：`cargo test --workspace` 全绿（`cowfs` 12 项 + `a8_devtools` 14 项含 `test_parse_git_diff_blocks_and_untracked_synthesis`）与 `cargo check --workspace` 通过。
- **仓库门禁**：`check_swallowed_exceptions.mjs`、`check_workspace_hygiene.mjs`、`check_plugin_agents.py` 全绿通过。
