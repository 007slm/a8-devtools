# a8-devtools 真实验证地图

> 本验证地图规定 `a8-devtools` 各模块改动后必须跑通的真实运行表面、端到端物理判据与 Mock 与本地环境盲区（共享术语见 [项目术语表](glossary.md)）。
> **总则**：严禁仅凭 `cargo check`、Vite 开发模式或 Mock 测试绿灯宣布完成；必须落到真实 Rust 端口、IIFE 构建产物、WinFsp/BindFlt 文件系统操作及仓库不变量门禁，并核验第一现场输出。

---

## 1. 改动模块 → 必跑验证面路由表

| 改动模块 / 路径 | 必跑验证面 | 仅靠哪些测试绿灯不算数（禁止假绿） |
| :--- | :--- | :--- |
| **`modules/cowfs/`** (`libcowfs`、`cowfs.exe`) | **D1 + D2** | 仅跑 `tests/unit_test.rs` 临时目录单测，未验证 WinFsp 真实挂载 Copy-Up 与 `bindflt` `--direct` 目录物理属性 |
| **`modules/cowlink_overlay/`** (`cowlink_overlay.dll`) | **D1 + D2 + D6** | 仅跑 `cargo check`，未检查 HKLM 前导 7 空格注册表项、内嵌角标释放与 `release.mjs` 对 Explorer 文件锁的热改名避让 |
| **`modules/devtools/` Rust 宿主** (`main.rs`、`sidecar.rs`、`agent_mind.rs`、`net_speed.rs`、`taskbar_window.rs`、`settings.rs`) | **D1 + D3 + D4** | 仅跑 `cargo test`，未启动实机校验单实例唤醒、零黑窗、`:18765` Origin `403` 拦截、UIA 网速条及注册表开机自启 |
| **`modules/devtools/web/` 与 `modules/devtools/ui/`** | **D1 + D3** | 仅在 `vite` 开发服预览通过，未执行 `npm run build` 核验 `ui/index.html` 经典 IIFE 剥离与三端实机加载零白屏 |
| **`plugins/a8-agent-mind/`** (`sidecars/panel/main.mjs`、`agents/`、`skills/`、`scripts/`、`decisions/`) | **D1 + D5** | 改完 Agent/技能/Sidecar 后未跑 `check_plugin_agents.py`、`scan_docs_sync.mjs`、`judge_router.py` 与 `:18766` Token/Origin 实测 |
| **`scripts/lints/` 与 `scripts/release.mjs`** | **D1 + D6** | 仅改单一检查脚本未跑全套 4 项门禁，或未通过 `release.mjs` 核验 `dist/` 产物完整性与 `SHA256SUMS.txt` |

---

## 2. 6 大真实验证面执行卡（D1 ~ D6）

### D1：Rust 工作区编译、单测与全仓 4 项机械门禁
- **前置条件**：Rust 工具链（`Cargo.toml` Workspace 3 成员）、Node.js、Python 3（`py -3`）；PowerShell 命令前置 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;`。
- **启动与探活**：无需拉起 GUI 或常驻进程；先以 `git status` 确认待检范围。
- **执行命令**：
  ```powershell
  cargo check --workspace
  cargo test --workspace
  node scripts/lints/check_swallowed_exceptions.mjs
  node scripts/lints/check_workspace_hygiene.mjs
  node scripts/lints/check_work_records.mjs
  py -3 scripts/lints/check_plugin_agents.py
  ```
- **真通过物理判据**：`cargo check` 与 `cargo test --workspace` 退出码 `0`（覆盖 `cowfs` `unit_test.rs` 7 项、`whiteout`/`config`、`devtools` `main.rs`/`sidecar.rs`/`agent_mind.rs` 全部 Rust 单测，注意默认运行会跳过未装 WinFsp 或需按 D2 单独实测的挂载行为）；4 项仓库门禁全部输出 `[PASS]`，且 `AGENTS.md`、规则、`plugins/*/skills/*/SKILL.md`、`plugins/*/agents/*.md`、`plugins/*/design.md`、`docs/glossary.md`、`docs/verify.md` 物理体积均 `<= 20,000 B`，同时 `plugins/*/rules/*.md` 与 `.agents/rules/*.md` 通过 `RULE_ACTIVATION_CONTRACT` 激活契约校验。
- **第一现场日志路径**：终端输出、`target/debug/`、`scripts/lints/`。

### D2：WinFsp 写时复制、`bindflt` 直通与 Explorer 角标实机
- **前置条件**：Windows 已安装 WinFsp 2025（未装时用管理员运行 `scripts\install_driver.bat` 安装 `scripts\winfsp-2.1.25156.msi` 并启动 `winfsp` 服务）；测试 `cowfs service-setup` 需管理员权限。
- **启动与探活**：执行 `target\release\cowfs.exe doctor`（或 `cargo run -p cowfs -- doctor`），确认 WinFsp 与 BindFlt 内核驱动就绪。
- **执行命令**：
  ```powershell
  cargo test -p cowfs --test winfsp_test -- --nocapture
  cargo run -p cowfs -- link <源目录> <COW工作区>
  cargo run -p cowfs -- status <COW工作区>
  cargo run -p cowfs -- unlink <COW工作区>
  cargo run -p cowfs -- link --direct <源目录> <直通工作区>
  ```
- **真通过物理判据**：
  1. `test_winfsp_mount_probe` 通过：虚拟挂载点改写文件触发 Copy-Up 后，源目录 `lower` 原文件字节完全不变，差异层 `upper` 写入新内容；
  2. COW 工作区创建后，源目录 `<source>\.cowdiff\<folder_slug>_<8hex>\meta.json`（最高事实源）与 `%LOCALAPPDATA%\cowlink\workspaces\<pathHash>\meta.json` 同步落盘，且挂载点内 `ls`/IDE 不可见 `.cowdiff`、`.cowlink` 与 `.cow_deleted.*` Whiteout 删除标记；
  3. `--direct` 直通目录在 Win32 `FindFirstFileW` / 属性核验中呈现纯正目录属性（`0x00000010`、`dwReserved0 == 0`），不存在伪造 `desktop.ini`；
  4. 注册表 `HKLM\Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\       A8CowFsOverlay`（7 个前导空格，CLSID `{55F87E2C-255B-4C2E-893A-A7E004B50341}`）存在且 `%LOCALAPPDATA%\cowlink\overlay-badge.ico` 或 DLL 同目录图标就位。
- **第一现场日志路径**：`%LOCALAPPDATA%\cowlink\workspaces\*\meta.json`、`<源目录>\.cowdiff\*\meta.json`、`scripts\logs\driver_install.log`。

### D3：三端同源 IIFE 构建、防白屏与 Origin `403` 安全边界实机
- **前置条件**：`modules/devtools/web/` 已安装依赖（`npm ci`/`npm install`）；分别准备桌面端/进程内看板与插件 Sidecar。
- **启动与探活**：
  - 构建并静态查验产物：`cd modules/devtools/web; npm run build; cd ../../..`（必跑 `tsc -b && vite build`；本机 `oxlint` 原生绑定正常时可选加跑 `npm run lint`）；
  - 入口 1（桌面端）：`.\start.bat`（或 `cargo run -p devtools`）；
  - 入口 2（进程内 Web `:18765`，`sidecar.rs`）：桌面端点击「浏览器独立打开」后，探活 `http://127.0.0.1:18765/api/agent-mind/overview`；
  - 入口 3（插件 Sidecar `:18766`，`plugins/a8-agent-mind/sidecars/panel/main.mjs`）：`node plugins/a8-agent-mind/sidecars/panel/main.mjs`，确认输出 `Dashboard ready on http://127.0.0.1:18766`。
- **执行命令**（构建校验 + 本地接口边界实测）：
  ```powershell
  Get-Content modules/devtools/ui/index.html
  curl.exe -i -s http://127.0.0.1:18765/
  curl.exe -i -s -H "Origin: plugin://a8-agent-mind" http://127.0.0.1:18765/api/agent-mind/overview
  curl.exe -i -s -H "Origin: https://evil.example.com" http://127.0.0.1:18765/api/agent-mind/overview
  curl.exe -i -s -X POST -H "Content-Type: text/plain" -d "{}" http://127.0.0.1:18765/api/agent-mind/git/diff
  ```
- **真通过物理判据**：
  1. `modules/devtools/ui/index.html` 与 `ui/preload.js`、`ui/assets/index.js` 真实存在，HTML 中**绝对不含 `type="module"` 与 `crossorigin`**，仅使用 `./preload.js` 与 `<script defer src="./assets/index.js"></script>`（Vite `base: './'` + `format: 'iife'`）；
  2. 三端（桌面主窗、`:18765`、`:18766`）打开页面全部正常渲染，浏览器控制台 `0` 报错无白屏；`AgentMindView` 与 `CodeReviewTab` 对无 `.git` 仓库显式显示 `无 Git` 提示；`常青文档` 页签含 `术语表`、`验证地图` 与 `evergreen` 文档（含 `.html` 可视化指南 `iframe` 沙箱预览、深浅色同步与全屏切换）；
  3. 静态 `GET`/`HEAD` 资源与 `OPTIONS` 放行并返回 `Cache-Control: no-store` 与 `Access-Control-Allow-Origin: *`；`/api/` 对无 `Origin`、`Origin: null`、`plugin://`、`tauri://`、`127.0.0.1`/`localhost` 返回 `200`，对外部 Origin（如 `https://evil.example.com`）严格返回 **`403 Forbidden`**；非 JSON `POST` 返回 **`415`**；设置 `ANTIGRAVITY_SIDECAR_UI_TOKEN` 时访问 `/_sidecar/*` 缺少或错传 `X-Sidecar-Token` 返回 **`401`**；提案路径含 `..`/`\`/`:`/`~` 一律拦截报错。
- **第一现场日志路径**：`modules/devtools/ui/index.html`、浏览器 DevTools 控制台与 Network 面板、`plugins/a8-agent-mind/sidecars/panel/main.mjs` 标准输出。

### D4：桌面工作台 Win32 原生特性与零黑窗行为
- **前置条件**：已编译 `target/release/a8-devtools.exe`，处于 Windows 交互桌面会话。
- **启动与探活**：运行 `.\start.bat` 启动主程序，确认系统托盘出现双行位图图标且任务栏出现透明网速条。
- **实机验证步骤与命令**：
  1. **单实例互斥与跨特权唤醒**：点击主窗 `X` 隐入托盘后，再次双击或执行 `target\release\a8-devtools.exe`，观察现有主窗口瞬间被置前唤醒且进程列表中仅存 **1 个** `a8-devtools.exe`；
  2. **零黑窗与任务栏停靠**：分别在桌面端触发 Doctor 检查、Git Diff 代码审核、打开目录与推进提案，肉眼确认全程 **0 次命令行黑窗闪现**（均经 `CREATE_NO_WINDOW = 0x08000000`）；验证 Win11 任务栏网速条紧贴通知区左侧 `-6px`、拖拽超过 `2px` 锁定及右键复位、全屏播放视频/PPT 后 1 秒内自动隐身；
  3. **开机自启唯一事实源同步**：在设置页切换开机自启开关后核对磁盘文件与注册表：
     ```powershell
     Get-Content "$env:LOCALAPPDATA\cowlink\devtools_settings.json"
     Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "a8-devtools" -ErrorAction SilentlyContinue
     ```
- **真通过物理判据**：单实例锁生效；托盘 32×32 位图每 5000ms 更新，隐入托盘后停止向 WebView 发 `net-speed-update`；`devtools_settings.json` 的 `autostart` 与注册表键 `a8-devtools` 严格一致；托盘右键退出后 `:18765` 端口随主进程自动回收。
- **第一现场日志路径**：`%LOCALAPPDATA%\cowlink\devtools_settings.json`、`%USERPROFILE%\.gemini\antigravity\daemon\hub_*.json`。

### D5：A8 Agent Mind 插件轻量确定性 Stop Hook、前置审查闸门、夜间扫描与裁判路由闭环
- **前置条件**：Python 3（`py -3`）与 Node.js（`node`），仓库位于 Git 管理下。
- **启动与探活**：确认插件根目录存在 `hooks.json` 与 `hooks/stop_lint.py`（仅执行本地确定性静态 Lint，绝不调 LLM），提交前语义红线审查闸门由 `skills/a8-commit/SKILL.md` 驱动。
- **执行命令**：
  ```powershell
  py -3 scripts/lints/check_plugin_agents.py
  py -3 -m unittest plugins/a8-agent-mind/hooks/test_stop_lint.py
  node plugins/a8-agent-mind/scripts/scan_docs_sync.mjs
  py -3 plugins/a8-agent-mind/scripts/run_repo_lints.py .
  py -3 plugins/a8-agent-mind/skills/a8-judge/scripts/judge_router.py .
  ```
- **真通过物理判据**：
  1. `check_plugin_agents.py` 校验 `plugins/*/agents/*.md`（`arch-judge.md`、`docs-sync.md`、`dsh-reviewer.md`）全部显式声明 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`，防止运行时被静默降级为只读 9 工具集；
  2. `test_stop_lint.py` 全绿，且通过真实 `stdin` JSON 调用 `py -3 hooks/stop_lint.py` 验证：纯问答/只读回合、`continuationActive: true` 与全绿工作区均返回 `{}` 放行；存在 Lint 违规时返回 `{"decision": "continue", "reason": "..."}` 精确报错并写入 `stop_hook` 遥测；
  3. `scan_docs_sync.mjs` 输出合法 JSON，精准跳过 `role: test-bed` 靶场及无新增提交/工作区变动的仓库（`needs_review: false`），并正确报告 `broken_links`、`unmarked_superseded_records`、`in_flight_records` 与 `< 20KB` 体积警告；`--mark-done <repo>` 后复扫幂等返回 `needs_review: false`；
  4. `run_repo_lints.py` 输出 `"ok": true` 并写入 `%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\harness_metrics.jsonl`；`judge_router.py .` 输出合法路由 JSON 且 `relevant_docs` 仅含 `.md` 文档（自动跳过 `.html` 可视化指南）；
  5. 默认 `/a8-commit` 确认三段式审查（`judge_router.py` → 激活维度必跑 `decisions_client.py` → 告警或高危面必跑 `arch-judge`）强制执行；显式 `/a8-commit fast` 仅跳过第 3 步语义红线审查，Step 1 敏文件拦截与 Step 2 确定性门禁仍强检且汇总表如实注明。
- **第一现场日志路径**：`%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\harness_metrics.jsonl`、`%USERPROFILE%\.gemini\antigravity\plugin_data\a8-agent-mind\nightly_docs_sync_state.json`、`plugins/a8-agent-mind/reviews/`、`logs/grok-proposals/`。

### D6：便携发布打包流水线实机验收（`scripts/release.mjs`）
- **前置条件**：D1 全部通过；退出运行中的 `a8-devtools.exe`（或传 `--restart`）；若 `explorer.exe` 锁定 `cowlink_overlay.dll`，脚本会自动热改名为 `cowlink_overlay.dll.old.<ts>` 避让。
- **启动与探活**：先执行 `node scripts/release.mjs --dry-run` 核对计划步骤。
- **执行命令**：
  ```powershell
  .\release.bat --restart
  Get-Content dist\a8-devtools-v0.1.0-win-x64\SHA256SUMS.txt
  Get-FileHash dist\a8-devtools-v0.1.0-win-x64\a8-devtools.exe,dist\a8-devtools-v0.1.0-win-x64\cowfs.exe,dist\a8-devtools-v0.1.0-win-x64\cowlink_overlay.dll -Algorithm SHA256
  ```
- **真通过物理判据**：流水线依次通过 4 项静态门禁、前端 `npm run build`、`cargo test --workspace` 与 `cargo build --release --workspace`；`dist/a8-devtools-v0.1.0-win-x64/` 及同名 `.zip` 完整包含 `a8-devtools.exe`、`cowfs.exe`、`cowlink_overlay.dll`、`SHA256SUMS.txt` 与 `scripts/` 驱动安装包；`Get-FileHash` 与 `SHA256SUMS.txt` 逐字节一致，且新版 `a8-devtools.exe` 正常拉起。
- **第一现场日志路径**：`dist/a8-devtools-v0.1.0-win-x64/SHA256SUMS.txt`、`target/release/`。

---

## 3. Mock 与本地环境盲区

| 本地环境 / Mock | 真实生产目标 | 本地环境测不到的盲区（上线/交付前必核） |
| :--- | :--- | :--- |
| **临时目录单测** (`unit_test.rs`) | **WinFsp / BindFlt 驱动 + Explorer 进程** | 并发句柄竞态、长路径 `\\?\` 与杀毒软件过滤驱动冲突、非管理员下 `CowFsBindService` 未就绪，以及 `explorer.exe` 受 15 个全局 `ShellIconOverlayIdentifiers` 槽位挤占导致角标不显示 |
| **本地静态路由单测** (`judge_router.py`) | **线上 Gemini Decisions API + Antigravity 宿主** | 真实 API 超时/网络抖动时的 Fail-Closed 退避表现、`hub_*.json` 多实例并发选活与 `language_server.exe` 拉起会话，以及插件经 `bindflt` 挂载到 `%USERPROFILE%\.gemini\config\plugins\a8-agent-mind\` 后的真实加载路径 |
| **普通浏览器直开 `:18765`** | **Antigravity 辅助侧栏 WebView（Sidecar）** | IDE 自定义协议（`plugin://`/`vscode-webview://`/`Origin: null`）对 ES Module 与 `crossorigin` 的拦截、宿主注入 `sidecar_sdk/preload.js` 桥接及 `X-Sidecar-Token` 鉴权链路 |
| **单台 Win11 开发机** | **多显示器 / 干净未装环境的目标 Windows** | 裸机未装 WinFsp/VC++ 运行库时 `install_driver.bat` 的 UAC 提权安装体验，以及多屏混合 DPI 缩放与不同任务栏布局下 `TaskbarSpeedBar` 的停靠坐标精度 |
