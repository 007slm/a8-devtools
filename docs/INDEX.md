# a8-devtools 全量长期文档与归档索引 (docs/INDEX.md)

> 本文件收录 `a8-devtools` 仓库全量长期技术文档（含 `SPEC`、`ADR`、`BUG` 复盘及历史档案），供按需查阅；根目录 [`AGENTS.md`](../AGENTS.md) 仅保留核心架构基准简表，严格控制单文件 `< 20,000 B` 防触及 Antigravity `24 KB` 截断红线。

---

## 1. 全量技术文档清单

| 文档路径 | 类型 | 所属模块 | 状态 | 用途说明与关联源码 |
| :--- | :--- | :--- | :--- | :--- |
| [20261116-SPEC-工作台与插件看板-提交前GitDiff人工代码审核工作台设计.md](20261116-SPEC-工作台与插件看板-提交前GitDiff人工代码审核工作台设计.md) | SPEC | 工作台与插件看板 | 实施已生效 | 规约独立一级入口「代码审核」的三端同源 `get_repo_git_diff` 控制面契约、未追踪文件合成与截断边界，以及参考 Plannotator 的行级/跨行 Diff 批注与剪贴板反馈回传闭环（[`modules/devtools/`](../modules/devtools/)、[`plugins/a8-agent-mind/sidecars/panel/`](../plugins/a8-agent-mind/sidecars/panel/)）。 |
| [20261115-SPEC-工作台与插件看板-Grok每日AI提案面板与Antigravity联动契约.md](20261115-SPEC-工作台与插件看板-Grok每日AI提案面板与Antigravity联动契约.md) | SPEC | 工作台与插件看板 | 实施已生效 | 规约 `logs/grok-proposals/<YYYY-MM-DD>.md` 提案 Frontmatter 契约、提案 4 态流转（`status` 接口与唤醒自动流转 `in_progress`）、三端同源「每日提案」视图控制面接口，以及零黑窗 `language_server.exe agentapi` 创建会话 + Win32 置前唤醒 Antigravity 联动闭环（[`modules/devtools/`](../modules/devtools/)、[`plugins/a8-agent-mind/sidecars/panel/`](../plugins/a8-agent-mind/sidecars/panel/)）。 |
| [20261114-BUG-工作台与插件看板-三端同源Dashboard白屏根因与防踩坑指南.md](20261114-BUG-工作台与插件看板-三端同源Dashboard白屏根因与防踩坑指南.md) | BUG | 工作台与插件看板 | 已修复并实测 | 沉淀三端同源（桌面端 + Rust `:18765` + 插件 Sidecar）Dashboard 4 大白屏根因（`type="module"`/`crossorigin` + `Origin: null`/`plugin://` 403 静态资源拦截、`preload.js` 缺失、Vite `base: './'`、HeroUI v3 复合契约与 `RootErrorBoundary`）及经典 IIFE 构建/校验 Checklist。 |
| [20261113-ADR-存储与桌面集成-纯直通透明映射与ShellOverlay角标架构.md](20261113-ADR-存储与桌面集成-纯直通透明映射与ShellOverlay角标架构.md) | ADR | 存储与桌面集成 | 实施已生效 | 记录废弃 `desktop.ini`/`READONLY` 伪装与 `mount_direct`，切换为纯 `bindflt` 透明直通 + `IShellIconOverlayIdentifier` 内嵌角标与 `HKLM` 启动自注册架构（[`modules/cowfs/`](../modules/cowfs/)、[`modules/cowlink_overlay/`](../modules/cowlink_overlay/)）。 |
| [20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md](20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md) | SPEC | 插件与治理 | 实施已生效 | 规约基于 Google Gemini Decisions API 的 `a8-agent-mind` 三层治理漏斗（`Lint > Decision > Rule`）、无截断多批次裁决、`Stop` Hook 自动沉淀与 `docs/` 门禁、Harness 可观测遥测、Antigravity `24KB/20k tokens` 上下文监控、`DSH` 极速终审闭环、`/a8-improve` 及 `/a8-ui-verify`（[`plugins/a8-agent-mind/`](../plugins/a8-agent-mind/)）。 |
| [20261108-SPEC-工作台模块-Windows任务栏托盘与实时网速监控引擎.md](20261108-SPEC-工作台模块-Windows任务栏托盘与实时网速监控引擎.md) | SPEC | 工作台模块 | 实施已生效 | 规约 Win32 IP Helper 无锁网速采集、任务栏原生实时网速悬浮条 (双缓冲 GDI、全透明大字号、Win11 XAML UIA 事件驱动动态避让、全屏隐藏)、`Local\A8DevTools_SingleInstance_Mutex` 单实例互斥与托盘唤醒闭环、进程内 `:18765` 看板线程及全局设置中心（[`modules/devtools/`](../modules/devtools/)）。 |
| [20261022-SPEC-存储引擎-自完整差异存储与虚拟化架构.md](20261022-SPEC-存储引擎-自完整差异存储与虚拟化架构.md) | SPEC | 存储引擎 | 实施已生效 | 规约源内 `.cowdiff/{pathHash}/` 自完整布局、C 盘零占用、驱动重入死锁防御与根级遮蔽机制（[`modules/cowfs/`](../modules/cowfs/)）。 |
| [20261022-ADR-架构演进-a8-devtools多模块工作台与cowfs集成.md](20261022-ADR-架构演进-a8-devtools多模块工作台与cowfs集成.md) | ADR | 平台底座 | 实施已生效 | 记录从单一 cowlink 演进为 a8-devtools 多模块工作区（对标 a8-turbo 结构）的战略决策（[`Cargo.toml`](../Cargo.toml)、[`modules/`](../modules/)）。 |
