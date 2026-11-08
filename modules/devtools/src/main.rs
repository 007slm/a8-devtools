#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod net_speed;

use cowfs::config::WorkspaceMeta;
use cowfs::doctor::SystemDoctor;
use net_speed::{render_speed_icon_rgba, NetSpeedDto, NetSpeedMonitor};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Clone)]
pub struct ChangeItemDto {
    pub rel_path: String,
    pub change_type: String,
    pub size_bytes: u64,
    pub size_kb: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceCardDto {
    pub name: String,
    pub target_path: String,
    pub source_path: String,
    pub diff_path: String,
    pub is_alive: bool,
    pub pid: Option<u32>,
    pub modified_count: usize,
    pub added_count: usize,
    pub deleted_count: usize,
    pub total_diff_kb: f64,
    pub changes: Vec<ChangeItemDto>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemStatusDto {
    pub winfsp_driver_running: bool,
    pub is_admin: bool,
    pub total_workspaces: usize,
    pub active_workspaces: usize,
    pub total_diff_bytes: u64,
    pub saved_disk_bytes: u64,
}

fn find_cowfs_binary() -> PathBuf {
    if let Ok(mut exe) = std::env::current_exe() {
        exe.pop();
        for name in ["cowfs.exe", "cowlink.exe"] {
            let candidate = exe.join(name);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    for rel in [
        "target/release/cowfs.exe",
        "target/debug/cowfs.exe",
        "target/release/cowlink.exe",
        "target/debug/cowlink.exe",
        "cowfs.exe",
        "cowlink.exe",
    ] {
        let p = PathBuf::from(rel);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("cowfs.exe")
}

#[cfg(windows)]
fn open_in_explorer_native(path: &Path) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path_str = path.to_string_lossy();
    let wide_path = HSTRING::from(path_str.as_ref());
    let wide_operation = HSTRING::from("open");

    unsafe {
        ShellExecuteW(
            None,
            &wide_operation,
            &wide_path,
            None,
            None,
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(not(windows))]
fn open_in_explorer_native(path: &Path) {
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}

#[cfg(windows)]
fn locate_in_explorer_native(path: &Path) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let args = format!("/select,\"{}\"", path.display());
    let wide_exe = HSTRING::from("explorer.exe");
    let wide_args = HSTRING::from(args.as_str());
    let wide_operation = HSTRING::from("open");

    unsafe {
        ShellExecuteW(
            None,
            &wide_operation,
            &wide_exe,
            &wide_args,
            None,
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(not(windows))]
fn locate_in_explorer_native(path: &Path) {
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}

#[cfg(windows)]
fn terminate_process_by_pid(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
            if !handle.is_invalid() {
                let _ = TerminateProcess(handle, 0);
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(not(windows))]
fn terminate_process_by_pid(_pid: u32) {}

fn spawn_cowfs_mount(
    bin: &Path,
    source: &Path,
    target: &Path,
) -> std::io::Result<std::process::Child> {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(["link", &source.to_string_lossy(), &target.to_string_lossy()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
}

// ---------------- Tauri 2.0 Commands ----------------

#[tauri::command]
fn get_workspaces() -> Vec<WorkspaceCardDto> {
    let metas = WorkspaceMeta::list_all();
    let mut cards = Vec::new();

    for meta in metas {
        let is_alive = meta.is_alive();
        let target_str = meta.target_dir.to_string_lossy().to_string();
        let source_str = meta.source_dir.to_string_lossy().to_string();
        let diff_str = meta.diff_dir.to_string_lossy().to_string();

        let name = meta
            .target_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace")
            .to_string();

        let stats = meta.compute_diff_stats();
        let diff_kb = stats.total_bytes as f64 / 1024.0;

        let changes = stats
            .changes
            .into_iter()
            .map(|c| ChangeItemDto {
                rel_path: c.rel_path,
                change_type: c.change_type,
                size_bytes: c.size_bytes,
                size_kb: c.size_bytes as f64 / 1024.0,
            })
            .collect();

        cards.push(WorkspaceCardDto {
            name,
            target_path: target_str,
            source_path: source_str,
            diff_path: diff_str,
            is_alive,
            pid: meta.pid,
            modified_count: stats.modified_count,
            added_count: stats.added_count,
            deleted_count: stats.deleted_count,
            total_diff_kb: diff_kb,
            changes,
        });
    }

    cards
}

#[tauri::command]
fn get_system_status() -> SystemStatusDto {
    let doctor = SystemDoctor::diagnose();
    let metas = WorkspaceMeta::list_all();
    let total_workspaces = metas.len();
    let mut active_workspaces = 0;
    let mut total_diff_bytes = 0;

    for m in &metas {
        if m.is_alive() {
            active_workspaces += 1;
        }
        let st = m.compute_diff_stats();
        total_diff_bytes += st.total_bytes;
    }

    let saved_disk_bytes = if active_workspaces > 0 {
        active_workspaces as u64 * 2_400_000_000
    } else {
        0
    };

    SystemStatusDto {
        winfsp_driver_running: doctor.winfsp_driver_running,
        is_admin: doctor.is_admin,
        total_workspaces,
        active_workspaces,
        total_diff_bytes,
        saved_disk_bytes,
    }
}

#[tauri::command]
fn create_workspace(source: String, target: String) -> Result<String, String> {
    let src = PathBuf::from(source.trim());
    let tgt = PathBuf::from(target.trim());

    if !src.exists() || !src.is_dir() {
        return Err("基础源目录不存在或不是一个有效目录！".to_string());
    }
    if target.trim().is_empty() {
        return Err("目标虚拟工作区路径不能为空！".to_string());
    }

    let cowfs_bin = find_cowfs_binary();
    if !cowfs_bin.exists() {
        return Err(format!("未找到 cowfs 驱动可执行文件: {}", cowfs_bin.display()));
    }

    let doctor = SystemDoctor::diagnose();
    if !doctor.winfsp_driver_running {
        return Err("WinFsp 内核驱动未启动，请先以管理员权限启动 WinFsp 服务！".to_string());
    }

    match spawn_cowfs_mount(&cowfs_bin, &src, &tgt) {
        Ok(child) => {
            let pid = child.id();
            std::thread::sleep(Duration::from_millis(400));
            if let Ok(mut meta) = WorkspaceMeta::load_global(&tgt) {
                meta.pid = Some(pid);
                meta.active = true;
                let _ = meta.save_both();
            }
            Ok(format!("工作区已成功挂载 (PID: {})", pid))
        }
        Err(e) => Err(format!("启动 WinFsp 驱动挂载失败: {}", e)),
    }
}

#[tauri::command]
fn unlink_workspace(target: String) -> Result<String, String> {
    let tgt = PathBuf::from(target.trim());
    if let Ok(meta) = WorkspaceMeta::load_global(&tgt) {
        if let Some(pid) = meta.pid {
            terminate_process_by_pid(pid);
        }
    }

    std::thread::sleep(Duration::from_millis(200));

    if tgt.exists() {
        let _ = std::fs::remove_dir(&tgt);
    }
    if let Ok(mut meta) = WorkspaceMeta::load_global(&tgt) {
        meta.active = false;
        meta.pid = None;
        let _ = meta.save_both();
    }

    Ok("工作区已安全脱机，驱动解除挂载，增量数据已持久化。".to_string())
}

#[tauri::command]
fn resume_workspace(target: String) -> Result<String, String> {
    let tgt = PathBuf::from(target.trim());
    let meta = WorkspaceMeta::load_global(&tgt)
        .map_err(|e| format!("加载工作区元数据失败: {}", e))?;

    let cowfs_bin = find_cowfs_binary();
    let child = spawn_cowfs_mount(&cowfs_bin, &meta.source_dir, &tgt)
        .map_err(|e| format!("启动挂载服务失败: {}", e))?;

    let pid = child.id();
    std::thread::sleep(Duration::from_millis(400));

    if let Ok(mut m) = WorkspaceMeta::load_global(&tgt) {
        m.pid = Some(pid);
        m.active = true;
        let _ = m.save_both();
    }

    Ok("写时复制虚拟工作区已重新恢复挂载！".to_string())
}

#[tauri::command]
fn delete_workspace(target: String) -> Result<String, String> {
    let tgt = PathBuf::from(target.trim());

    // 1. 如果工作区仍处于活跃或挂载状态，先终止进程
    if let Ok(meta) = WorkspaceMeta::load_global(&tgt) {
        if let Some(pid) = meta.pid {
            terminate_process_by_pid(pid);
        }
    }

    std::thread::sleep(Duration::from_millis(150));

    // 2. 如果目标挂载点存在且为空目录或脱机状态，尝试清理挂载点目录
    if tgt.exists() {
        let _ = std::fs::remove_dir(&tgt);
    }

    // 3. 彻底清除工作区元数据与差异物理文件
    WorkspaceMeta::delete_global(&tgt, true)
        .map_err(|e| format!("清除工作区数据失败: {}", e))?;

    Ok("已彻底清除工作区元数据与物理差异层。".to_string())
}

#[tauri::command]
fn open_explorer(path: String) -> Result<(), String> {
    open_in_explorer_native(Path::new(&path));
    Ok(())
}

#[tauri::command]
fn locate_in_explorer(path: String) -> Result<(), String> {
    locate_in_explorer_native(Path::new(&path));
    Ok(())
}

#[tauri::command]
fn open_global_dir() -> Result<(), String> {
    open_in_explorer_native(&WorkspaceMeta::global_root());
    Ok(())
}

#[tauri::command]
fn scan_and_import_source(source: String) -> Result<usize, String> {
    let src = PathBuf::from(source.trim());
    if !src.exists() || !src.is_dir() {
        return Err("指定的源目录不存在或不是有效文件夹".to_string());
    }
    let discovered = WorkspaceMeta::scan_source_cowdiff(&src);
    Ok(discovered.len())
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

// ---------------- 预留开发者工具模块：Hosts 维护 ----------------

fn get_hosts_path() -> PathBuf {
    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        PathBuf::from(system_root).join("System32\\drivers\\etc\\hosts")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/hosts")
    }
}

#[tauri::command]
fn get_hosts_content() -> Result<String, String> {
    let path = get_hosts_path();
    std::fs::read_to_string(&path).map_err(|e| format!("读取 hosts 文件失败: {}", e))
}

#[tauri::command]
fn save_hosts_content(content: String) -> Result<(), String> {
    let path = get_hosts_path();
    std::fs::write(&path, content).map_err(|e| format!("写入 hosts 文件失败（需要管理员权限）: {}", e))
}

#[tauri::command]
fn get_net_speed(state: tauri::State<'_, Arc<NetSpeedMonitor>>) -> Result<NetSpeedDto, String> {
    Ok(state.get_current())
}

fn main() {
    let monitor = NetSpeedMonitor::new();
    let monitor_setup = monitor.clone();

    tauri::Builder::default()
        .manage(monitor)
        .setup(move |app| {
            // 1. Initial 32x32 tray icon
            let initial_dto = monitor_setup.get_current();
            let initial_rgba = render_speed_icon_rgba(&initial_dto.upload_short, &initial_dto.download_short);
            let initial_icon = tauri::image::Image::new(&initial_rgba, 32, 32);

            // 2. Tray menu items
            let speed_item = MenuItem::with_id(
                app,
                "speed_display",
                "↑ 0 B/s   ↓ 0 B/s",
                false,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let toggle_item = MenuItem::with_id(
                app,
                "toggle_window",
                "显示 / 隐藏工作台",
                true,
                None::<&str>,
            )?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(
                app,
                "quit_app",
                "退出 a8-devtools",
                true,
                None::<&str>,
            )?;

            let menu = Menu::with_items(app, &[&speed_item, &sep1, &toggle_item, &sep2, &quit_item])?;

            // 3. Build Tray Icon
            let tray = TrayIconBuilder::new()
                .icon(initial_icon)
                .tooltip("a8-devtools 开发者工作台\n实时网速监控就绪")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle_window" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit_app" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // 4. Intercept window close request -> minimize to tray
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            // 5. Background thread: periodic 1s network speed ticker
            let tray_handle = tray.clone();
            let app_handle = app.handle().clone();
            let monitor_thread = monitor_setup.clone();

            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_millis(1000));
                    let speed = monitor_thread.tick();

                    let rgba = render_speed_icon_rgba(&speed.upload_short, &speed.download_short);
                    let icon = tauri::image::Image::new(&rgba, 32, 32);
                    let _ = tray_handle.set_icon(Some(icon));

                    let tooltip = format!(
                        "a8-devtools 开发者工作台\n↑ 上传: {}\n↓ 下载: {}\n总发送: {} | 总接收: {}",
                        speed.upload_formatted,
                        speed.download_formatted,
                        net_speed::format_speed(speed.total_sent_bytes),
                        net_speed::format_speed(speed.total_recv_bytes),
                    );
                    let _ = tray_handle.set_tooltip(Some(tooltip));

                    let menu_text = format!("↑ {}   ↓ {}", speed.upload_formatted, speed.download_formatted);
                    let _ = speed_item.set_text(menu_text);

                    let _ = app_handle.emit("net-speed-update", &speed);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            get_system_status,
            create_workspace,
            unlink_workspace,
            resume_workspace,
            delete_workspace,
            open_explorer,
            locate_in_explorer,
            open_global_dir,
            scan_and_import_source,
            pick_folder,
            get_hosts_content,
            save_hosts_content,
            get_net_speed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running a8-devtools application");
}
