# SPEC：Windows 任务栏托盘、悬浮网速条与系统设置引擎

- **日期**：2026-11-08
- **状态**：已落地（当时有效）
- **域**：desktop-tray-and-settings.md
- **取代**：无

---

## 1. 问题与目标

- **要解决的问题**：Windows 10/11 托盘图标默认收纳进折叠抽屉且缺少原位实时网速可视化；高频探测网卡或轮询 XAML 托盘会带来 IRP 报文开销与卡顿；此外需要进程单实例互斥唤醒、无子进程泄漏的 Web 看板以及开机自启控制。
- **设计目标**：构建纯 Win32 原生低开销网速采集与托盘位图渲染引擎、Win11 UIA 事件驱动透明网速条、主进程单实例唤醒与持久化设置中心。

## 2. 核心设计与结论

1. **低频无锁网速采集与 32×32 托盘位图（`net_speed.rs`）**：
   - 基于 Win32 IP Helper API（`GetIfTable2` / `FreeMibTable`）筛选非 Loopback(24) 已连接网卡，按 **5000ms（每 5 秒 1 次）** 周期计算自适应速率（$\Delta t$），导出 `NetSpeedDto` 与 IPC 命令 `get_net_speed`，仅在主窗口可见时推送 `net-speed-update` 事件；
   - 自研 3×5 微点阵字模纯内存绘制 32×32 双行网速图标（上行琥珀橙 `▲`、下行天空蓝 `▼`），零系统字体依赖。
2. **Win11 任务栏原生透明网速条（`taskbar_window.rs`）**：
   - 使用 `WS_POPUP | WS_VISIBLE` + `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE` 与 `SetLayeredWindowAttributes` 纯黑 ColorKey 实现 100% 透明背景（`Microsoft YaHei UI` 16px Semibold，`136px` 宽），并设为 `Shell_TrayWnd` Owned Window 防被任务栏遮挡；
   - **事件驱动避让**：独立 MTA 线程对 `Shell_TrayWnd` 内 XAML `SystemTray` 容器注册 `IUIAutomation` 的 `StructureChanged` 与 `BoundingRectangle` 监听（静止期 0 次跨进程 UIA 调用），结合 `TrayNotifyWnd` 矩形与 180ms 防抖计算双锚点最左安全边界（`min(win32_left, uia_left) - 6px`）；用户拖拽超 `2px` 后置位 `USER_DRAG_LOCKED` 尊重自定义摆放；
   - 1 秒纯内存定时器结合 `GetForegroundWindow` / `GetMonitorInfoW` 检测全屏视频或游戏时 `SW_HIDE` 避让，退出全屏立即恢复。
3. **单实例互斥唤醒与进程内看板（`main.rs`, `sidecar.rs`）**：
   - 启动申请命名互斥锁 `Local\A8DevTools_SingleInstance_Mutex`（检查 `ERROR_ALREADY_EXISTS` / `ERROR_ACCESS_DENIED`），重复启动通过 `FindWindowW` 查找 `A8DevToolsTaskbarSpeedBar`（已通过 `ChangeWindowMessageFilterEx` 放行 `WM_TASKBAR_SHOW_MAIN`）唤醒前实例主窗口；
   - 浏览器独立打开 `:18765` 看板由 `sidecar::ensure_running` 在主进程内同步 `TcpListener::bind` 确权并守护，不派生孤儿进程。
4. **全局系统设置与自启动（`settings.rs`）**：
   - 通过原生 Win32 注册表 API 读写 `HKCU\...\Run` 键 `a8-devtools`，每次以注册表真实物理存在为真源；配置模型 `AppSettings` 持久化至 `%LOCALAPPDATA%\cowlink\devtools_settings.json`（含 `autostart`、`taskbar_speed_enabled`、`sample_interval_secs`、`fullscreen_hide`），主窗口设置项与任务栏网速条右键菜单双向同步。

## 3. 当时验证范围

- **2026-11-14 补全 UIA 停靠验证**：`cargo test --workspace` 9 项全绿、`cargo check --workspace` 0 警告；`target/release/a8-devtools.exe` 体积 ~9.2 MB、空闲内存 ~36 MB、CPU 占用低于 0.01%。

## 4. 对常青文档的影响

- 本规范全部实现契约与运行时不变量已完整沉淀至 [desktop-tray-and-settings.md](../evergreen/desktop-tray-and-settings.md)。
