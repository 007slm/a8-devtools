use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "cowlink")]
#[command(version = "0.1.0")]
#[command(about = "面向 Windows 的写时复制 (Copy-on-Write) 虚拟工作区与快照工具", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// 将基础源目录链接挂载至目标工作区 (基于 WinFsp 驱动)
    Link {
        /// 基础源目录路径 (只读模板或直通源)
        source: PathBuf,
        /// 目标挂载点或工作区目录路径
        target: PathBuf,
        /// 可选：私有差异与修改文件的持久化目录 (默认自动在全局隐藏存储中分配)
        #[arg(long, value_name = "PATH")]
        diff_dir: Option<PathBuf>,
        /// 直通镜像模式：双向直连，不保留差异层，所有读写直接作用于源目录，向系统呈现纯正物理目录
        #[arg(long)]
        direct: bool,
    },

    /// 卸载解除工作区挂载 (自动结束驱动服务，持久化差异层)
    Unlink {
        /// 目标挂载点或工作区目录路径
        target: PathBuf,
    },

    /// 查看指定工作区的差异状态 (已修改、新增、已删除文件列表)
    Status {
        /// 目标工作区目录路径
        target: PathBuf,
    },

    /// 运行系统环境与 WinFsp / BindFlt 内核驱动就绪诊断
    Doctor,

    /// 安装并启动 CowFsBindService 内核桥接服务（需管理员权限）
    ServiceSetup,

    /// 运行 CowFsBindService Windows 后台服务（由 SCM 调度）
    ServiceRun,
}
