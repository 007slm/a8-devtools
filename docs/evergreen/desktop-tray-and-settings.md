# 桌面工作台、任务栏网速条与系统设置（常青文档）

> **所属域**：`a8-devtools.exe` 原生桌面宿主、网速采集、任务栏悬浮条、单实例与设置中心（专有术语见 [项目术语表](../glossary.md)）  
> **适用源码**：`modules/devtools/src/main.rs`、`modules/devtools/src/net_speed.rs`、`modules/devtools/src/taskbar_window.rs`、`modules/devtools/src/screen_alert.rs`、`modules/devtools/src/settings.rs`、`modules/devtools/src/sidecar.rs`  
> **相关记录（渐进式披露）**：
> - [Windows 任务栏托盘与实时网速监控引擎规范](../records/20261108-SPEC-工作台模块-Windows任务栏托盘与实时网速监控引擎.md)
> - [远程共享进程监控与任务栏上沿红色流光带警示规范](../records/20261127-SPEC-工作台模块-远程共享进程监控与任务栏流光红带警示.md)

---

## 1. 全局原生 Win32 红线

- **零黑窗原则（Zero Console Flashing）**：探测/管理服务、进程、注册表、桌面唤醒及子命令调用**一律使用原生 Win32 API（`windows` crate）或 `creation_flags(0x08000000)`**，严禁调用 `cmd.exe`、`powershell.exe`、`sc.exe`、`taskkill.exe`。
- **单实例互斥与唤醒**：
  - 启动入口按当前 Win32 Desktop 隔离申请命名互斥锁 `Local\A8DevTools_SingleInstance_Mutex_<Desktop>`（避免隐藏/隔离桌面实例阻塞默认桌面 `Default`，同时处理 `ERROR_ALREADY_EXISTS` 与跨权限 `ERROR_ACCESS_DENIED`）；
  - 主实例独立维护 `HWND_MESSAGE` 隐藏消息窗口 `A8DevToolsWakeReceiver`（与任务栏网速条及 `Shell_TrayWnd` 生命周期完全解耦，已通过 `ChangeWindowMessageFilterEx` 放行 UIPI 跨特权消息 `WM_APP_WAKE_MAIN`）；次实例调用 `AllowSetForegroundWindow(ASFW_ANY)` 后经 `SendMessageTimeoutW` 发送唤醒消息并等待确认，主实例在主线程统一还原（含屏外居中与前台锁突破）并前置主窗口。
- **进程内 `:18765` 看板服务（`sidecar::ensure_running`）**：
  - 点击「浏览器独立打开」时在主进程内同步完成 `TcpListener::bind("127.0.0.1:18765")` 第一现场确权，由原子状态 `SIDECAR_RUNNING` 与 `SIDECAR_START_LOCK` 守护监听线程，不派生第二个 `a8-devtools.exe` 子进程，主进程退出端口自动回收。

---

## 2. 网速采集与 32×32 托盘动态位图（`net_speed.rs`）

- **低频硬件采样**：每 **5000ms** 调用一次 Win32 IP Helper `GetIfTable2` / `FreeMibTable`，过滤 Loopback(24) 与未连接接口，基于实际流逝时间 $\Delta t$ 无锁差值计算上/下行速率，输出 `NetSpeedDto`（`upload_bytes_per_sec`、`download_bytes_per_sec`、`upload_formatted`、`download_formatted`、`upload_short`、`download_short`、`total_sent_bytes`、`total_recv_bytes`）。
- **按需定向推送**：`net-speed-update` Tauri 事件**仅在主窗口可见时**推送至 WebView，窗口隐藏入托盘时完全切断 IPC 发送。
- **纯代码 32×32 托盘图标**：内置 3×5 微点阵字模在内存中绘制双行透明深底位图（上行琥珀橙 `▲`、下行天空蓝 `▼`），零字体文件依赖；Tauri 命令 `get_net_speed` 供前端冷启动首帧拉取。
- **托盘生命周期**：主窗口右上角关闭（`X`）拦截 `CloseRequested` 并隐入托盘常驻；左键单击或双击托盘图标统一还原并置前主窗口（避免双击触发“先开后关”瞬隐）；右键菜单提供只读实时速率、显隐切换（仅可见且未最小化时隐藏，最小化时优先还原）与安全退出。

---

## 3. 任务栏悬浮网速条（`TaskbarSpeedBar` · `taskbar_window.rs`）

- **视觉与透明度**：`WS_POPUP` + `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE`，使用 `SetLayeredWindowAttributes` 纯黑 ColorKey 镂空实现 100% 透明背景；ClearType 渲染 `Microsoft YaHei UI` 16px Semibold（宽 136px，高随任务栏自适应）。
- **无跨进程 Owner（严防 `explorer.exe` 死锁）**：严禁将 `Shell_TrayWnd` 设为网速条的跨进程 Owner（否则 Windows 会隐式绑定输入队列，触发 `AppHangXProcB1` 导致 `explorer.exe` 挂死重启并连带销毁网速条）；改为无 Owner 顶层窗口，通过监听 `TaskbarCreated` 广播与 1s 定时器非全屏时温和维护 `HWND_TOPMOST` 保持在任务栏之上。
- **Win11 XAML 事件驱动动态停靠（零忙等轮询、消息泵零阻塞）**：
  - 所有跨进程 `IUIAutomation` 查询严格限制在独立 MTA 观察线程中执行（查询 `SystemTray.SystemTrayFrame`、`SystemTrayFrameGrid`、`NormalButton`、`OmniButton`、`ChevronButton`、`OverflowButton`，结果写入原子缓存 `CACHED_UIA_TRAY_LEFT`），窗口消息泵仅做纯 Win32 `GetWindowRect` 读取与停靠计算，绝不在 `WndProc` 中做同步 COM/UIA 调用；
  - 对 `SystemTray` 容器注册 `StructureChanged` 与 `BoundingRectangle` 事件监听，平时静止期 **0 次** 跨进程 UIA 调用；仅在事件或 `WM_DISPLAYCHANGE` / `WM_SETTINGCHANGE` / `WM_DPICHANGED` / `TaskbarCreated` 时执行 **180ms 防抖**重停靠；UIA 未就绪时回退 `SPI_GETWORKAREA` 安全位置。
  - **手动拖拽、开关与复位**：拖拽位移 `> 2px` 置位 `USER_DRAG_LOCKED` 尊重用户摆放；右键「复位到任务栏通知区左侧」解除锁定并重新贴靠；`USER_ENABLED` 原子守卫确保用户关闭网速条后不会被定时器自动拉起。
- **1 秒级全屏自动隐身**：独立纯内存定时器以 1s 粒度结合 `GetForegroundWindow` + `MonitorFromWindow` + `GetMonitorInfoW` 检测全屏视频/游戏/PPT，命中即 `SW_HIDE` 避让，退出全屏立即 `SW_SHOWNOACTIVATE` 恢复。

---

## 4. 远程 / 共享进程红光带警示（`ScreenAlertManager` · `screen_alert.rs`）

- **纯进程名轻量检测**：每 **2000ms** 经 Win32 `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)` 纯内存枚举进程名与 PID，不访问 GPU 也不读软件日志（默认监控 `wemeetapp.exe`、`SunloginClient.exe`、`ToDesk.exe`，大小写不敏感且自动补 `.exe` 归一化，可自定义）；命中明细（进程名 + PID 列表）实时推送并在主窗口顶栏与设置页展示；开关关闭时跳过快照扫描。
- **任务栏上沿流光红带与防捕获隐身**：
  - 独立消息线程与无 Owner 顶层窗口（`WS_POPUP` + `WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`），鼠标完全穿透且永不抢焦点；
  - 警示窗口调用 `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`，本机肉眼可见而远程共享画面不可见；
  - 紧贴主/副屏任务栏内侧边缘绘制 **24px** 红色流光带（6px 亮红核心 + 18px 柔光渐变），复用 DIB 缓冲以 ~30 FPS 渲染双光波横向流转效果；提供 `set_screen_alert_preview` 内存态预览命令，非警示态立即停掉动画定时器并隐藏窗口（闲置零占用）。

---

## 5. 全局设置与开机自启（`settings.rs`）

- **持久化路径**：`%LOCALAPPDATA%\cowlink\devtools_settings.json`（数据结构 `AppSettings`：`autostart`、`taskbar_speed_enabled`、`sample_interval_secs`、`fullscreen_hide`、`screen_alert_enabled`、`screen_alert_processes`）。
- **开机自启动唯一事实源**：通过 Win32 原生 API（`RegOpenKeyExW` / `RegSetValueExW` / `RegDeleteValueW`）直接读写 `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` 键 `a8-devtools`（值为带双引号包裹的 `"{current_exe_path}"`），每次读取以注册表实际存在与否为唯一事实源。

---

## 6. 非目标与重新评估条件

- **非目标**：不恢复 Win10 COM `IDeskBand` 注入；不在托盘静止期对 `IUIAutomation` 做高频定时轮询；不另起子进程托管 `:18765` Web 看板。
- **重新评估条件**：若微软在未来 Windows 更新中开放官方原生任务栏 Widget/Band API 且无须进程外坐标追踪时，可评估替换 `IUIAutomation` 停靠路径。
