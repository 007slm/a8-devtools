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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Doctor => {
            let report = SystemDoctor::diagnose();
            SystemDoctor::print_report(&report);
        }

        Commands::Link {
            source,
            target,
            diff_dir,
            direct,
        } => {
            let canonical_source = fs::canonicalize(&source).map_err(|e| {
                format!(
                    "基础源目录无法访问或不存在: {} ({})",
                    source.display(),
                    e
                )
            })?;

            if !canonical_source.is_dir() {
                return Err(format!("源路径不是一个有效目录: {}", canonical_source.display()).into());
            }

            // 检查 WinFsp 驱动环境
            let report = SystemDoctor::diagnose();
            if !report.winfsp_driver_running {
                return Err("WinFsp 驱动未运行！请先以管理员权限运行: net start WinFsp".into());
            }

            // 分配源目录内 .cowdiff 差异存储目录 (直通模式不占用差异目录)
            let actual_diff_dir = if direct {
                canonical_source.clone()
            } else {
                match diff_dir {
                    Some(p) => {
                        if !p.exists() {
                            fs::create_dir_all(&p)?;
                        }
                        fs::canonicalize(&p)?
                    }
                    None => {
                        let default_diff = WorkspaceMeta::diff_dir_for(&canonical_source, &target);
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
                println!("    启动 cowlink 直通镜像虚拟目录 (WinFsp 原生物理目录伪装)   ");
            } else {
                println!("       启动 cowlink 写时复制虚拟工作区 (WinFsp 内核驱动)    ");
            }
            println!("============================================================");
            println!("基础源目录 (物理代码库): {}", canonical_source.display());
            println!("目标工作区 (虚拟挂载点): {}", target.display());
            if direct {
                println!("运行模式:              直通镜像 (双向实时同步, 0 差异层)");
            } else {
                println!("增量差异目录:          {}", actual_diff_dir.display());
            }
            println!("------------------------------------------------------------");

            let mut meta = WorkspaceMeta::new(
                &canonical_source,
                &actual_diff_dir,
                &target,
                mode_str,
            );
            meta.pid = Some(std::process::id());
            meta.active = true;
            meta.save_global()?;

            if target.exists() {
                let is_empty = fs::read_dir(&target).map(|mut d| d.next().is_none()).unwrap_or(false);
                if is_empty {
                    let _ = fs::remove_dir(&target);
                } else {
                    return Err(format!(
                        "目标工作区已存在且不为空: {}。WinFsp 驱动挂载要求目标路径为空或尚未创建。",
                        target.display()
                    ).into());
                }
            }

            println!("正在通过 WinFsp 驱动加载虚拟文件系统...");
            let _host = if direct {
                winfsp_fs::CowFsHost::mount_direct(canonical_source, &target)?
            } else {
                winfsp_fs::CowFsHost::mount(
                    canonical_source,
                    actual_diff_dir,
                    &target,
                )?
            };

            println!("√ 挂载成功！工作区已就绪: {}", target.display());
            if direct {
                println!("提示: 直通模式已生效。任何读写均直接穿透源目录，系统将视其为原生标准 NTFS 物理目录。");
            } else {
                println!("提示: 工作区为纯净代码视图，所有写操作将自动触发写时复制，按 Ctrl+C 可停止挂载服务。");
            }
            std::thread::park();
        }

        Commands::Unlink { target } => {
            println!("正在卸载解除工作区挂载: {}...", target.display());

            let mut meta = WorkspaceMeta::load_global(&target)?;

            if let Some(pid) = meta.pid {
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
            }

            if target.exists() {
                let _ = fs::remove_dir(&target);
            }

            meta.active = false;
            meta.pid = None;
            let _ = meta.save_global();

            println!("√ 工作区已成功卸载，驱动服务已终止，差异层数据已安全持久化。");
        }

        Commands::Status { target } => {
            let meta = WorkspaceMeta::load_global(&target)?;

            println!("============================================================");
            println!("              工作区状态概览 (cowlink status)                 ");
            println!("============================================================");
            println!("基础源目录: {}", meta.source_dir.display());
            println!("工作区模式: WinFsp 内核驱动");
            println!("激活状态:   {}", if meta.active { "激活中 (挂载中)" } else { "已卸载 (离线)" });
            println!("差异存储:   {}", meta.diff_dir.display());
            println!("------------------------------------------------------------");

            let mut modified = Vec::new();
            let mut whiteouts = Vec::new();
            scan_diff_dir(&meta.diff_dir, Path::new(""), &mut modified, &mut whiteouts)?;

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
