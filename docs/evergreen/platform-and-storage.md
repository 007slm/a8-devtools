# 平台架构、CowFS 存储引擎与桌面角标（常青文档）

> **所属域**：平台基础架构、写时复制存储引擎与 Explorer 角标扩展（专有术语见 [项目术语表](../glossary.md)）  
> **适用源码**：`Cargo.toml`、`modules/cowfs/`、`modules/cowlink_overlay/`  
> **相关记录（渐进式披露）**：
> - [多模块 Cargo Workspace 演进决策](../records/20261022-ADR-架构演进-a8-devtools多模块工作台与cowfs集成.md)
> - [自完整差异存储与虚拟化架构规范](../records/20261022-SPEC-存储引擎-自完整差异存储与虚拟化架构.md)
> - [纯直通透明映射与 Shell Overlay 角标架构](../records/20261113-ADR-存储与桌面集成-纯直通透明映射与ShellOverlay角标架构.md)

---

## 1. 工作区边界与单向分层契约

根目录 `Cargo.toml` 统一托管 3 个 Rust 工作区成员（`resolver = "2"`）：

| 成员模块 | 定位与职责 | 依赖与隔离红线 |
| :--- | :--- | :--- |
| `modules/cowfs` | 纯系统级内核库（`libcowfs`）与独立命令行工具（`cowfs.exe`） | **严禁**引入 Tauri、RFD 等任何 GUI/窗口框架；独立运行测试与 CLI 分发 |
| `modules/cowlink_overlay` | 零侵入 Explorer Shell 图标角标 COM DLL（`cowlink_overlay.dll`） | 仅依赖 `windows`、`serde_json` 等基础库，只读工作区 `meta.json` 状态 |
| `modules/devtools` | Tauri 2.0 桌面工作台应用（`a8-devtools.exe`） | 作为消费层调用 `cowfs` 公开模块接口，严禁反向污染底层内核 |

---

## 2. CowFS 自完整差异存储规范（`.cowdiff`）

```text
<source_repo>/
├── src/                               # 只读原始源码（零污染）
└── .cowdiff/                          # 变体存储容器（支持单源多工作区）
    └── <folder_slug>_<8位hex>/        # WorkspaceMeta::compute_path_hash(target_dir)
        ├── meta.json                  # 自完整元数据（source_dir/diff_dir/target_dir/mode/active/pid）
        └── diff/                      # Upper Layer 物理增量与 .cow_deleted.<name> 删除标记文件
```

### 2.1 路径哈希与元数据唯一事实源
- **`compute_path_hash(target_dir)`**（`modules/cowfs/src/config.rs`）：路径转小写并统一斜杠为 `/` 后计算 64 位摘要截取低 32 位生成 8 位 Hex，拼接为 `<folder_slug>_<8_char_hash>`（如 `client_dev_4a91c0e3`）。
- **双写与唯一事实源优先级**：
  - 本机快速索引镜像于 `%LOCALAPPDATA%\cowlink\workspaces\<pathHash>\meta.json`，供 GUI/CLI 秒级列举；
  - 源目录 `.cowdiff\<pathHash>\meta.json` 为**自完整最高事实源**（发生分歧以源内为准）；跨机拷贝源仓库时调用 `scan_source_cowdiff` 自动发现并导入本机全局索引；差异数据与源目录同盘同速，C 盘零占用。

### 2.2 路径解析状态机与驱动不变量（`LayerState` / `DirectoryMerger`）
- **路径解析结果（`PathResolution`）**：`Whiteout`（自身或祖先目录已被删除标记隐藏）、`Upper(PathBuf)`（差异层已修改/新增）、`Lower(PathBuf)`（原始源目录只读存在）、`NotFound`。
- **核心不变量**：
  1. **零重入死锁隔离（Zero Re-entrancy）**：物理存储层（Lower 与 `.cowdiff` Upper）**绝对不能**位于虚拟挂载点（`target_dir`）内部；WinFsp 用户态进程通过普通 Win32 API 读写源内 `.cowdiff`，彻底绕开挂载点重入。
  2. **根级静默遮蔽**：在路径解析层（`LayerState::resolve`）与目录合并遍历层（`DirectoryMerger::read_directory`）对 `.cowdiff` 与 `.cowlink` 执行根级静默过滤，工作区内的 IDE、Git 与构建工具永远不可见自身增量。
  3. **删除标记语义（Whiteout）**：在工作区删除原始文件时，不在只读源目录物理删除，而在 Upper 对应父目录生成 `.cow_deleted.<filename>` 删除标记；遍历目录时优先提取删除标记并隐藏 Lower 同名项。
  4. **原子写时复制（Copy-Up）**：写操作触发 Copy-Up 时采用细粒度锁与原子落盘（`modules/cowfs/src/cow/copy_up.rs`），不阻塞无关文件并发读取。

---

## 3. 纯直通映射（`bindflt`）与 Explorer 角标扩展（`cowlink_overlay.dll`）

### 3.1 透明直通契约与已退役旧方案
- **现行路径**：`cowfs link --direct` 统一走 `bindflt::client_bind` 内核直通，不再经由 WinFsp 用户态中转。
- **物理透明性不变量**：映射目录对上层 IDE/构建工具保持 100% 透明（实测 `FindFirstFileW` 属性为纯粹 `0x00000010` 目录属性、`dwReserved0=0x00000000`、不存在虚拟 `desktop.ini`）。
- **已退役方案**：彻底删除 `desktop_ini.rs`、`mount_direct` 与目录 `FILE_ATTRIBUTE_READONLY` 伪装逻辑，严禁回退使用伪装文件诱导 Explorer 图标。

### 3.2 `IShellIconOverlayIdentifier` 角标机制（`modules/cowlink_overlay/src/lib.rs`）
- **HKLM 前置抢占**：Windows Explorer 仅读取 `HKLM\Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers` 且按字典序最多加载前 15 个槽位。组件固定注册键名 `"       A8CowFsOverlay"`（7 个前导空格，CLSID `{55F87E2C-255B-4C2E-893A-A7E004B50341}`）以确保排在系统序列前列。
- **低开销匹配与缓存**：`IsMemberOf` 先对非目录请求（`dwattrib != 0 && (dwattrib & 0x10) == 0`）直接返回 `S_FALSE`，再通过 **1.5 秒 TTL 内存缓存**比对 `%LOCALAPPDATA%\cowlink\workspaces\*\meta.json` 中 `active == true` 的 `target_dir`。
- **内嵌角标与启动自注册**：通过 `include_bytes!` 内嵌 `overlay-badge.ico`（优先读取 DLL 同目录，缺失时释放至 `%LOCALAPPDATA%\cowlink\overlay-badge.ico`）；`ensure_overlay_registered` 在 `a8-devtools.exe` 启动线程与 `cowfs service-setup` / `cowfs link` 中检查 `HKLM` 注册键，缺失时通过 `regsvr32.exe /s`（非管理员通过 `ShellExecuteExW("runas")` 提权一次）完成注册。

---

## 4. 非目标与重新评估条件（Reconsider When）

- **非目标**：不支持将 `.cowdiff` 放回虚拟挂载点内部；不支持通过 `desktop.ini` 或系统只读属性伪装目录图标；不支持把 `modules/devtools` 的 UI 依赖反向引入 `modules/cowfs`。
- **Reconsider when**：当 Windows 未来版本彻底废弃 `IShellIconOverlayIdentifier` 或云盘同步软件占满全部前导空格槽位导致角标失效时，再评估迁移至 `Cloud Files API` 占位符状态图标或独立 Shell Namespace 扩展。
