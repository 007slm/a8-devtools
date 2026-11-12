# 项目详情卡片：a8-devtools (辅助工具)

- **物理绝对路径**：`E:\a8-devtools`
- **生态位定位**：`tooling`（开发者工作台基础设施）
- **职责边界**：面向 Windows 的现代高性能开发者效率底座平台。
- **核心模块**：
  1. `modules/cowfs`：WinFsp 写时复制文件系统（CowFS 差异存储，C盘零占用）；
  2. `modules/devtools`：Tauri 2.0 桌面工作台、Win32 原生任务栏实时网速悬浮条、注册表开机自启动设置中心；
  3. `plugins/agent-mind`：全局架构红线与大地图插件所在地（全局 Junction 映射）。
- **关键质量门禁**：
  - `cargo check --manifest-path Cargo.toml` 必须 100% 编译通过；
  - 严禁调用命令行探测关闭进程（零黑窗原则），必须使用原生 Win32 API。
- **与外部协作**：为 `a8-turbo` 提供 CowFS 虚拟化隔离环境支持与全局红线治理。
