#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_mind;
mod net_speed;
mod settings;
mod sidecar;
mod taskbar_window;

use cowfs::config::WorkspaceMeta;
use cowfs::doctor::SystemDoctor;
use net_speed::{NetSpeedDto, NetSpeedMonitor};
use taskbar_window::TaskbarSpeedBar;
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
    pub mode: String,
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
    pub bindflt_service_running: bool,
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

fn clean_path_for_explorer(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let stripped = if s.starts_with(r"\\?\") {
        &s[4..]
    } else {
        &s
    };
    PathBuf::from(stripped)
}

#[cfg(windows)]
pub(crate) fn open_in_explorer_native(path: &Path) {
    let clean = clean_path_for_explorer(path);
    let target = if clean.exists() {
        clean
    } else if let Some(parent) = clean.parent() {
        if parent.exists() {
            parent.to_path_buf()
        } else {
            clean
        }
    } else {
        clean
    };

    let _ = std::process::Command::new("explorer")
        .arg(&target)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
pub(crate) fn open_in_explorer_native(path: &Path) {
    let clean = clean_path_for_explorer(path);
    let _ = std::process::Command::new("xdg-open").arg(&clean).spawn();
}

#[cfg(windows)]
fn locate_in_explorer_native(path: &Path) {
    let clean = clean_path_for_explorer(path);
    let arg = if clean.exists() {
        format!("/select,\"{}\"", clean.display())
    } else if let Some(parent) = clean.parent() {
        if parent.exists() {
            format!("/select,\"{}\"", parent.display())
        } else {
            clean.display().to_string()
        }
    } else {
        clean.display().to_string()
    };

    let _ = std::process::Command::new("explorer")
        .arg(&arg)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
fn locate_in_explorer_native(path: &Path) {
    let clean = clean_path_for_explorer(path);
    let _ = std::process::Command::new("xdg-open").arg(&clean).spawn();
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
    direct: bool,
) -> std::io::Result<std::process::Child> {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("link")
        .arg(source)
        .arg(target);
    if direct {
        cmd.arg("--direct");
    }
    cmd.stdin(std::process::Stdio::null())
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
            mode: meta.mode,
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

fn compute_source_size_bounded(root: &Path) -> u64 {
    fn walk(dir: &Path, total: &mut u64, count: &mut usize) {
        if *count >= 25_000 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if *count >= 25_000 {
                break;
            }
            let name = entry.file_name();
            if name == ".cowdiff" {
                continue;
            }
            *count += 1;
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                walk(&entry.path(), total, count);
            } else {
                *total += meta.len();
            }
        }
    }
    let mut total = 0u64;
    let mut count = 0usize;
    walk(root, &mut total, &mut count);
    total
}

#[tauri::command]
fn get_system_status() -> SystemStatusDto {
    let doctor = SystemDoctor::diagnose();
    let metas = WorkspaceMeta::list_all();
    let total_workspaces = metas.len();
    let mut active_workspaces = 0;
    let mut total_diff_bytes = 0;
    let mut saved_disk_bytes = 0;

    for m in &metas {
        let alive = m.is_alive();
        let st = m.compute_diff_stats();
        total_diff_bytes += st.total_bytes;
        if alive {
            active_workspaces += 1;
            let src_bytes = compute_source_size_bounded(&m.source_dir);
            saved_disk_bytes += src_bytes.saturating_sub(st.total_bytes);
        }
    }

    SystemStatusDto {
        winfsp_driver_running: doctor.winfsp_driver_running,
        bindflt_service_running: doctor.bindflt_service_running,
        is_admin: doctor.is_admin,
        total_workspaces,
        active_workspaces,
        total_diff_bytes,
        saved_disk_bytes,
    }
}

#[tauri::command]
fn setup_kernel_environment() -> Result<String, String> {
    let cowfs_bin = find_cowfs_binary();
    cowfs::bindflt::ensure_service_installed_and_running(&cowfs_bin)?;
    Ok("内核服务 (CowFsBindService & WinFsp) 已安装并启动就绪！".to_string())
}

#[tauri::command]
fn create_workspace(source: String, target: String, direct: Option<bool>) -> Result<String, String> {
    let src = PathBuf::from(source.trim());
    let tgt = cowfs::bindflt::strip_unc_prefix(Path::new(target.trim()));
    let is_direct = direct.unwrap_or(false);

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

    cowfs::bindflt::ensure_service_installed_and_running(&cowfs_bin)?;
    if !is_direct {
        let doctor = SystemDoctor::diagnose();
        if !doctor.winfsp_driver_running {
            return Err("WinFsp 内核驱动未启动，请确认 WinFsp 服务状态！".to_string());
        }
    }

    match spawn_cowfs_mount(&cowfs_bin, &src, &tgt, is_direct) {
        Ok(mut child) => {
            let pid = child.id();
            std::thread::sleep(Duration::from_millis(500));
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("内核挂载进程提前退出 (code: {:?})，请检查目标目录是否非空或内核服务状态。", status.code()));
            }
            if let Ok(mut meta) = WorkspaceMeta::load_global(&tgt) {
                meta.pid = Some(pid);
                meta.active = true;
                let _ = meta.save_both();
            }
            Ok(format!("内核工作区已成功挂载 (PID: {})", pid))
        }
        Err(e) => Err(format!("启动内核挂载进程失败: {}", e)),
    }
}

#[tauri::command]
fn unlink_workspace(target: String) -> Result<String, String> {
    let tgt = cowfs::bindflt::strip_unc_prefix(Path::new(target.trim()));
    let _ = cowfs::bindflt::client_unbind(&tgt);

    if let Ok(mut meta) = WorkspaceMeta::load_global(&tgt) {
        if let Some(pid) = meta.pid {
            terminate_process_by_pid(pid);
        }

        std::thread::sleep(Duration::from_millis(150));

        let internal_mount = WorkspaceMeta::internal_mount_dir(&tgt);
        if internal_mount.exists() || cowfs::bindflt::has_reparse_point(&internal_mount) {
            let _ = std::fs::remove_dir(&internal_mount);
        }
        if tgt.exists() {
            let _ = std::fs::remove_dir(&tgt);
        }

        meta.active = false;
        meta.pid = None;
        let _ = meta.save_both();
    } else if tgt.exists() {
        let _ = std::fs::remove_dir(&tgt);
    }

    Ok("工作区已断开内核绑定，驱动已卸载，增量数据已持久化。".to_string())
}

#[tauri::command]
fn resume_workspace(target: String) -> Result<String, String> {
    let tgt = cowfs::bindflt::strip_unc_prefix(Path::new(target.trim()));
    let meta = WorkspaceMeta::load_global(&tgt)
        .map_err(|e| format!("加载工作区元数据失败: {}", e))?;

    let is_direct = meta.mode == "direct_mirror";
    let cowfs_bin = find_cowfs_binary();
    cowfs::bindflt::ensure_service_installed_and_running(&cowfs_bin)?;
    if !is_direct && !SystemDoctor::diagnose().winfsp_driver_running {
        return Err("WinFsp 内核驱动未启动，无法恢复写时复制挂载！".to_string());
    }

    let mut child = spawn_cowfs_mount(&cowfs_bin, &meta.source_dir, &tgt, is_direct)
        .map_err(|e| format!("启动挂载服务失败: {}", e))?;

    let pid = child.id();
    std::thread::sleep(Duration::from_millis(500));

    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!("恢复挂载失败，内核进程退出 (code: {:?})", status.code()));
    }

    if let Ok(mut m) = WorkspaceMeta::load_global(&tgt) {
        m.pid = Some(pid);
        m.active = true;
        let _ = m.save_both();
    }

    Ok("虚拟工作区已通过内核驱动重新挂载！".to_string())
}

#[tauri::command]
fn delete_workspace(target: String) -> Result<String, String> {
    let tgt = cowfs::bindflt::strip_unc_prefix(Path::new(target.trim()));
    let _ = cowfs::bindflt::client_unbind(&tgt);

    if let Ok(meta) = WorkspaceMeta::load_global(&tgt) {
        if let Some(pid) = meta.pid {
            terminate_process_by_pid(pid);
        }
        std::thread::sleep(Duration::from_millis(150));
        let internal_mount = WorkspaceMeta::internal_mount_dir(&tgt);
        if internal_mount.exists() || cowfs::bindflt::has_reparse_point(&internal_mount) {
            let _ = std::fs::remove_dir(&internal_mount);
        }
    }
    if tgt.exists() {
        let _ = std::fs::remove_dir(&tgt);
    }

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

#[tauri::command]
fn get_app_settings(
    state: tauri::State<'_, Arc<parking_lot::RwLock<settings::AppSettings>>>,
) -> Result<settings::AppSettings, String> {
    Ok(state.read().clone())
}

#[tauri::command]
fn save_app_settings(
    new_settings: settings::AppSettings,
    state: tauri::State<'_, Arc<parking_lot::RwLock<settings::AppSettings>>>,
    bar_state: tauri::State<'_, Arc<TaskbarSpeedBar>>,
) -> Result<(), String> {
    settings::save_settings(new_settings.clone())?;
    bar_state.set_visible(new_settings.taskbar_speed_enabled);
    *state.write() = new_settings;
    Ok(())
}

#[tauri::command]
fn app_minimize(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn app_maximize(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn app_close(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn app_start_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "sidecar-board" {
        sidecar::run();
        return;
    }

    let initial_settings = settings::load_settings();
    let settings_state = Arc::new(parking_lot::RwLock::new(initial_settings));
    let settings_setup = settings_state.clone();

    let monitor = NetSpeedMonitor::new();
    let monitor_setup = monitor.clone();

    let app = tauri::Builder::default()
        .manage(monitor)
        .manage(settings_state)
        .setup(move |app| {
            // 1. Premium App Tray Icon (sharp, branded, fluent)
            let tray_icon = app
                .default_window_icon()
                .cloned()
                .or_else(|| tauri::image::Image::from_app_icon_resource(32).ok())
                .expect("valid app icon");

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
                .icon(tray_icon)
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

            // 5. Native Win32 Taskbar Speed Bar (Directly on Windows Taskbar)
            let taskbar_bar = TaskbarSpeedBar::start(app.handle().clone());
            if !settings_setup.read().taskbar_speed_enabled {
                taskbar_bar.set_visible(false);
            }
            app.manage(taskbar_bar.clone());

            // 6. Background thread: periodic network speed ticker
            let tray_handle = tray.clone();
            let app_handle = app.handle().clone();
            let monitor_thread = monitor_setup.clone();
            let taskbar_thread = taskbar_bar.clone();
            let settings_loop = settings_setup.clone();
            let speed_item_thread = speed_item.clone();

            std::thread::spawn(move || {
                loop {
                    let interval = settings_loop.read().sample_interval_secs.clamp(1, 60);
                    std::thread::sleep(Duration::from_secs(interval));

                    let speed = monitor_thread.tick();

                    // 1. Update taskbar speed bar if enabled
                    if settings_loop.read().taskbar_speed_enabled {
                        taskbar_thread.update_speed(&speed.upload_formatted, &speed.download_formatted);
                    }

                    // 2. Only emit IPC events to WebView when the main window is actually visible
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = app_handle.emit("net-speed-update", &speed);
                        }
                    }

                    // 3. Update tray menu item text & tooltip
                    let _ = speed_item_thread.set_text(format!(
                        "↑ {}   ↓ {}",
                        speed.upload_formatted, speed.download_formatted
                    ));
                    let tooltip = format!(
                        "a8-devtools 开发者工作台\n↑ 上传: {}\n↓ 下载: {}\n总发送: {} | 总接收: {}",
                        speed.upload_formatted,
                        speed.download_formatted,
                        net_speed::format_speed(speed.total_sent_bytes),
                        net_speed::format_speed(speed.total_recv_bytes),
                    );
                    let _ = tray_handle.set_tooltip(Some(tooltip));
                }
            });

            // 7. Auto-check/install CowFsBindService, Explorer icon overlay, and auto-resume active workspaces
            std::thread::spawn(|| {
                let cowfs_bin = find_cowfs_binary();
                if !cowfs::bindflt::is_service_ready() {
                    let _ = cowfs::bindflt::ensure_service_installed_and_running(&cowfs_bin);
                }
                cowfs::bindflt::ensure_overlay_registered(&cowfs_bin);
                for meta in WorkspaceMeta::list_all() {
                    if meta.active && !meta.is_alive() {
                        let target = meta.target_dir.to_string_lossy().to_string();
                        let _ = resume_workspace(target);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            get_system_status,
            setup_kernel_environment,
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
            get_app_settings,
            save_app_settings,
            app_minimize,
            app_maximize,
            app_close,
            app_start_drag,
            agent_mind::get_agent_mind_overview,
            agent_mind::read_agent_mind_file,
            agent_mind::save_agent_mind_file,
            agent_mind::create_agent_mind_rule,
            agent_mind::delete_agent_mind_file,
            agent_mind::open_agent_mind_dir,
            agent_mind::launch_agent_mind_sidecar,
        ]);

    let app_built = app
        .build(tauri::generate_context!())
        .expect("error while building a8-devtools application");

    app_built.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();
        }
    });
}
