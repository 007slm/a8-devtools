mod bindflt;
mod cli;
mod config;
mod cow;
mod doctor;
mod winfsp_fs;

use clap::Parser;
use cli::{Cli, Commands};
use config::WorkspaceMeta;
use cow::whiteout::parse_whiteout_name;
use doctor::SystemDoctor;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Doctor => {
            let report = SystemDoctor::diagnose();
            SystemDoctor::print_report(&report);
        }

        Commands::ServiceSetup => {
            println!("正在安装并启动 CowFsBindService 内核桥接服务...");
            bindflt::setup_service_as_admin()?;
            if let Ok(exe_path) = std::env::current_exe() {
                bindflt::ensure_overlay_registered(&exe_path);
            }
            println!("√ CowFsBindService 已启动并就绪。");
        }

        Commands::ServiceRun => {
            bindflt::run_service()?;
        }

        Commands::Link {
            source,
            target,
            diff_dir,
            direct,
        } => {
            let canonical_source_raw = fs::canonicalize(&source).map_err(|e| {
                format!(
                    "基础源目录无法访问或不存在: {} ({})",
                    source.display(),
                    e
                )
            })?;
            let canonical_source = bindflt::strip_unc_prefix(&canonical_source_raw);

            if !canonical_source.is_dir() {
                return Err(format!("源路径不是一个有效目录: {}", canonical_source.display()).into());
            }

            let target_clean = bindflt::strip_unc_prefix(&target);

            // 检查是否已有历史工作区登记
            let existing_meta = WorkspaceMeta::load_global(&target_clean).ok();
            if let Some(ref old_meta) = existing_meta {
                if let Some(old_pid) = old_meta.pid {
                    if old_pid != std::process::id() && old_meta.is_alive() {
                        terminate_pid(old_pid);
                        std::thread::sleep(Duration::from_millis(150));
                    }
                }
            }

            // 1. 确保 BindFlt 内核桥接服务就绪（未安装则触发一次性管理员安装）
            let exe_path = std::env::current_exe()?;
            bindflt::ensure_service_installed_and_running(&exe_path)?;
            bindflt::ensure_overlay_registered(&exe_path);

            // 先清理可能残留的旧绑定或重解析点
            let _ = bindflt::client_unbind(&target_clean);
            if bindflt::has_reparse_point(&target_clean) {
                let _ = fs::remove_dir(&target_clean);
            } else if target_clean.exists() {
                let is_empty = fs::read_dir(&target_clean)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(false);
                if !is_empty {
                    return Err(format!(
                        "目标工作区已存在且不为空: {}。内核 BindFlt 零拷贝挂载要求目标路径尚未创建或为空目录。",
                        target_clean.display()
                    )
                    .into());
                }
            }

            let actual_diff_dir = if direct {
                canonical_source.clone()
            } else {
                let report = SystemDoctor::diagnose();
                if !report.winfsp_driver_running {
                    return Err("WinFsp 内核驱动未运行！请以管理员权限启动 WinFsp 服务。".into());
                }
                match diff_dir {
                    Some(p) => {
                        if !p.exists() {
                            fs::create_dir_all(&p)?;
                        }
                        bindflt::strip_unc_prefix(&fs::canonicalize(&p)?)
                    }
                    None => {
                        let default_diff =
                            WorkspaceMeta::diff_dir_for(&canonical_source, &target_clean);
                        if !default_diff.exists() {
                            fs::create_dir_all(&default_diff)?;
                        }
                        default_diff
                    }
                }
            };

            let mode_str = if direct { "direct_mirror" } else { "driver" };

            println!("============================================================");
            if direct {
                println!("   启动 cowfs 零拷贝内核直通 (BindFlt 原生标准目录透传)   ");
            } else {
                println!("   启动 cowfs 写时复制内核工作区 (WinFsp + BindFlt 双引擎)  ");
            }
            println!("============================================================");
            println!("基础源目录 (物理代码库): {}", canonical_source.display());
            println!("目标工作区 (标准物理目录): {}", target_clean.display());
            if direct {
                println!("运行模式:              BindFlt 内核直通 (0 复制, 0 轮询, 无 ReparsePoint)");
            } else {
                println!("增量差异目录:          {}", actual_diff_dir.display());
            }
            println!("------------------------------------------------------------");

            let mut meta = WorkspaceMeta::new(
                &canonical_source,
                &actual_diff_dir,
                &target_clean,
                mode_str,
            );
            if let Some(old) = existing_meta {
                meta.created_at = old.created_at;
            }
            meta.pid = Some(std::process::id());
            meta.active = true;
            meta.save_global()?;

            if direct {
                println!("正在下发 BindFlt 内核直通绑定指令...");
                bindflt::client_bind(&target_clean, &canonical_source)?;
                notify_shell_folder_updated(&target_clean);

                println!(
                    "√ 内核直通挂载成功！工作区已就绪: {}",
                    target_clean.display()
                );
                println!("提示: Windows 内核 bindflt.sys 正在执行零拷贝透传，标准目录属性无 ReparsePoint。");
                std::thread::park();
            } else {
                let internal_mount = WorkspaceMeta::internal_mount_dir(&target_clean);
                if internal_mount.exists() || bindflt::has_reparse_point(&internal_mount) {
                    let _ = fs::remove_dir(&internal_mount);
                }
                fs::create_dir_all(&internal_mount)?;

                println!("正在通过 BindFlt 将虚拟卷无感映射至目标标准目录...");
                bindflt::client_bind(&target_clean, &internal_mount)?;

                let _ = fs::remove_dir(&internal_mount);
                println!(
                    "正在通过 WinFsp 挂载内部 CoW 卷: {}...",
                    internal_mount.display()
                );
                let _host = match winfsp_fs::CowFsHost::mount(
                    canonical_source,
                    actual_diff_dir,
                    &internal_mount,
                ) {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = bindflt::client_unbind(&target_clean);
                        return Err(format!("WinFsp 挂载内部 CoW 卷失败: {}", e).into());
                    }
                };

                notify_shell_folder_updated(&target_clean);

                println!(
                    "√ 写时复制内核工作区挂载成功: {}",
                    target_clean.display()
                );
                println!(
                    "提示: 外部视图为标准 NTFS 目录 (无 ReparsePoint)，写操作实时隔离至差异层。"
                );
                std::thread::park();
            }
        }

        Commands::Unlink { target } => {
            let target_clean = bindflt::strip_unc_prefix(&target);
            println!("正在卸载解除内核映射: {}...", target_clean.display());

            let mut meta = WorkspaceMeta::load_global(&target_clean)?;

            if let Some(pid) = meta.pid {
                terminate_pid(pid);
                std::thread::sleep(Duration::from_millis(150));
            }

            let internal_mount = WorkspaceMeta::internal_mount_dir(&target_clean);
            if internal_mount.exists() || bindflt::has_reparse_point(&internal_mount) {
                let _ = fs::remove_dir(&internal_mount);
            }

            let _ = bindflt::client_unbind(&target_clean);

            if target_clean.exists() {
                let _ = fs::remove_dir(&target_clean);
            }
            notify_shell_folder_updated(&target_clean);

            meta.active = false;
            meta.pid = None;
            let _ = meta.save_global();

            println!("√ 工作区已成功卸载，内核绑定与驱动服务已清理，差异层数据已安全持久化。");
        }

        Commands::Status { target } => {
            let target_clean = bindflt::strip_unc_prefix(&target);
            let meta = WorkspaceMeta::load_global(&target_clean)?;

            println!("============================================================");
            println!("              工作区状态概览 (cowlink status)                 ");
            println!("============================================================");
            println!("基础源目录: {}", meta.source_dir.display());
            println!(
                "工作区模式: {}",
                if meta.mode == "direct_mirror" {
                    "BindFlt 内核零拷贝直通"
                } else {
                    "WinFsp + BindFlt 写时复制"
                }
            );
            println!("激活状态:   {}", if meta.active && meta.is_alive() { "激活中 (内核在线)" } else { "已卸载 (离线)" });
            println!("差异存储:   {}", meta.diff_dir.display());
            println!("------------------------------------------------------------");

            let mut modified = Vec::new();
            let mut whiteouts = Vec::new();
            if meta.mode != "direct_mirror" {
                scan_diff_dir(&meta.diff_dir, Path::new(""), &mut modified, &mut whiteouts)?;
            }

            println!("已修改/新增的文件 ({} 项):", modified.len());
            for m in modified {
                println!("  [+] {}", m.display());
            }

            println!("\n已标记删除的文件/目录 ({} 项):", whiteouts.len());
            for w in whiteouts {
                println!("  [-] {}", w.display());
            }
            println!("============================================================");
        }
    }

    Ok(())
}

/// Notifies Windows Shell that a workspace folder's state/overlay has changed.
fn notify_shell_folder_updated(path: &Path) {
    #[cfg(windows)]
    {
        use widestring::U16CString;
        use windows::Win32::UI::Shell::{
            SHChangeNotify, SHCNE_UPDATEDIR, SHCNE_UPDATEITEM, SHCNF_PATHW,
        };

        if let Ok(wide) = U16CString::from_os_str(path.as_os_str()) {
            unsafe {
                SHChangeNotify(
                    SHCNE_UPDATEITEM,
                    SHCNF_PATHW,
                    Some(wide.as_ptr() as _),
                    None,
                );
                if let Some(parent) = path.parent() {
                    if let Ok(parent_wide) = U16CString::from_os_str(parent.as_os_str()) {
                        SHChangeNotify(
                            SHCNE_UPDATEDIR,
                            SHCNF_PATHW,
                            Some(parent_wide.as_ptr() as _),
                            None,
                        );
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

fn terminate_pid(pid: u32) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };
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
    {
        let _ = pid;
    }
}

fn scan_diff_dir(
    diff_root: &Path,
    rel: &Path,
    modified: &mut Vec<PathBuf>,
    whiteouts: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
    let current = diff_root.join(rel);
    if !current.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(&current)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        let item_rel = rel.join(&name);
        if let Some(orig) = parse_whiteout_name(&name) {
            whiteouts.push(rel.join(orig));
        } else if entry.path().is_dir() {
            scan_diff_dir(diff_root, &item_rel, modified, whiteouts)?;
        } else {
            modified.push(item_rel);
        }
    }
    Ok(())
}
