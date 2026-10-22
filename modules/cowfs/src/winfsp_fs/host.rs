use super::context::CowFsContext;
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
        let mut volume_params = VolumeParams::new();
        volume_params
            .filesystem_name(OsStr::new("NTFS"))
            .case_preserved_names(true)
            .case_sensitive_search(false)
            .unicode_on_disk(true)
            .sector_size(4096)
            .sectors_per_allocation_unit(1);

        let context = CowFsContext::new(lower_dir, upper_dir);
        let mut host = FileSystemHost::<CowFsContext, winfsp::host::FineGuard>::new(volume_params, context)?;

        let target_str: &'static OsStr = Box::leak(mount_target.as_os_str().to_os_string().into_boxed_os_str());
        host.mount(MountPoint::MountPoint(target_str))?;
        host.start()?;

        Ok(host)
    }
}
