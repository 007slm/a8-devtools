use super::context::CowFsContext;
#[cfg(windows)]
use crate::cow::desktop_ini::{mark_folder_readonly, notify_shell_folder_updated};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use winfsp::host::{FileSystemHost, MountPoint, VolumeParams};
use winfsp::Result;

pub struct CowFsHost;

impl CowFsHost {
    /// Mounts the CoW filesystem using WinFsp at `mount_target` (e.g. `X:` or directory path).
    pub fn mount(
        lower_dir: PathBuf,
        upper_dir: PathBuf,
        mount_target: &Path,
    ) -> Result<FileSystemHost<CowFsContext, winfsp::host::FineGuard>> {
        Self::mount_with_context(CowFsContext::new(lower_dir, upper_dir), mount_target)
    }

    /// Mounts in Direct Passthrough Mirror mode (zero diff, bi-directional pass-through).
    pub fn mount_direct(
        source_dir: PathBuf,
        mount_target: &Path,
    ) -> Result<FileSystemHost<CowFsContext, winfsp::host::FineGuard>> {
        Self::mount_with_context(CowFsContext::new_direct(source_dir), mount_target)
    }

    fn mount_with_context(
        context: CowFsContext,
        mount_target: &Path,
    ) -> Result<FileSystemHost<CowFsContext, winfsp::host::FineGuard>> {
        #[cfg(windows)]
        {
            mark_folder_readonly(mount_target);
        }

        let mut volume_params = VolumeParams::new();
        volume_params
            .filesystem_name(OsStr::new("NTFS"))
            .case_preserved_names(true)
            .case_sensitive_search(false)
            .unicode_on_disk(true)
            .sector_size(4096)
            .sectors_per_allocation_unit(1);

        let mut host = FileSystemHost::<CowFsContext, winfsp::host::FineGuard>::new(volume_params, context)?;

        let target_str: &'static OsStr = Box::leak(mount_target.as_os_str().to_os_string().into_boxed_os_str());
        host.mount(MountPoint::MountPoint(target_str))?;
        host.start()?;

        #[cfg(windows)]
        {
            // WinFsp re-creates/resets the directory as ReparsePoint during mount,
            // which strips the FILE_ATTRIBUTE_READONLY. We MUST re-apply it after mounting,
            // otherwise Windows Explorer will skip reading desktop.ini!
            mark_folder_readonly(mount_target);
            notify_shell_folder_updated(mount_target);
        }

        Ok(host)
    }
}

