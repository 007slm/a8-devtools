---
name: a8-ui-verify
description: "面向用户主动触发的跨仓库 UI 自动化验证与验收技能。触发指令包括 /a8-ui-verify、/ui-verify、UI 验证、自动化界面测试。统一约定测试脚本目录 scripts/tests/ui-verify/ 与运行产物目录 logs/ui-verify/，确保零阻塞启动目标服务、真实浏览器交互断言、截图留证与可复现验收报告。"
---

# UI Automated Verification Workflow (`a8-ui-verify`)

本技能仅在**用户主动要求 UI 测试/界面验收**时触发，遵循“工程脚本归显式测试目录、运行截图与报告归忽略日志目录”的标准边界。

---

## 一、 标准化目录与职责边界

| 资产类型 | 统一物理路径 | 版本控制与职责 |
| :--- | :--- | :--- |
| **UI 自动化测试脚本** | `<repo>/scripts/tests/ui-verify/` | **入库托管**。存放跨端口/页面可复用的 Playwright / Node / E2E UI 验证入口（如已有历史专有套件如 `scripts/tests/ego-bex5-e2e/`，可在 `scripts/tests/ui-verify/` 中建立统一调度入口或说明索引） |
| **运行态报告与截图** | `<repo>/logs/ui-verify/<YYYYMMDD-HHmmss>-<target>/` | **不入库**（由 `.gitignore` 忽略 `logs/`）。存放每次验证的控制台日志、网络 4xx/5xx 摘要、关键截图及 `report.json` / `report.md` |
| **正式基线验收报告** | `<repo>/docs/YYYYMMDD-REPORT-<MODULE>-<SUBJECT>.md` | 仅当某次端到端验收具有长期里程碑/基线参考价值时归档到 `docs/` 并同步 `AGENTS.md` |

---

## 二、 四步标准执行闭环

### Step 1：先读目标仓库 `AGENTS.md` 定位服务与脚本入口
1. 读取目标仓库根目录 `AGENTS.md`，核对：
   - 前端/控制面端口、启动命令（例如是否需先启动后端或前端 DevServer）及登录凭证约定；
   - `<repo>/scripts/tests/ui-verify/` 下是否已有现成脚本或调度清单。
2. 严禁盲猜未验证的端口或测试账号；缺少运行前置条件时直接向用户确认。

### Step 2：服务就绪性检查与零挂死启动
1. 先探测目标端口是否已在线；
2. 如需由 Agent 拉起服务，必须严格遵守 `mind-rules.md` 后台常驻任务铁律：
   - Windows 下采用独立脱离方式启动（严禁前台阻塞会话）；
   - 执行 **PID 存活 + 端口/健康接口就绪 + 延迟 2 秒防闪退复检**三步物理断言；失败立即抓取日志第一现场止步。

### Step 3：双模执行 UI 验证（优先复用可重复脚本）
根据目标仓库与需求选择对应路径：
- **模式 A（脚本回归，优先）**：`<repo>/scripts/tests/ui-verify/` 已存在对应验证脚本时，直接执行入口脚本，并将报告/截图定向输出到 `<repo>/logs/ui-verify/<timestamp>-<target>/`；若需为稳定功能补齐回归覆盖，将新增脚本写入 `scripts/tests/ui-verify/`。
- **模式 B（无脚本探索验收）**：调用 `browser` 子代理执行可视化交互流程（路由跳转、表单提交、列表刷新、错误提示、控制台与网络异常检查），并在报告目录保留真实截图与操作证据（对重要稳定流程可进一步固化成 `scripts/tests/ui-verify/` 脚本）。

### Step 4：零残留收尾与结构化验收汇报
1. 按需要清理临时自启的调试进程（保留用户原有服务状态）；
2. 向用户汇报高密度实测结果：
   - **测试范围与执行入口**（精确到脚本路径与 URL，如实标明未跑的用例/模块）；
   - **通过/失败明细表**（每项断言结果、控制台/HTTP 错误拦截情况）；
   - **取证文件链接**（如 `<repo>/logs/ui-verify/<timestamp>-<target>/report.md` 与失败/关键截图）。
