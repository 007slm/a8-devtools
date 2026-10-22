use super::state::{LayerState, PathResolution};
use super::whiteout::remove_whiteout_if_exists;
use dashmap::DashMap;
use parking_lot::Mutex;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct CopyUpEngine {
    state: LayerState,
    in_flight_locks: DashMap<PathBuf, Arc<Mutex<()>>>,
}

impl CopyUpEngine {
    pub fn new(state: LayerState) -> Self {
        Self {
            state,
            in_flight_locks: DashMap::new(),
        }
    }

    pub fn state(&self) -> &LayerState {
        &self.state
    }

    /// Obtains a fine-grained lock for a given relative path to guarantee single-flight copy-up.
    fn get_path_lock(&self, rel_path: &Path) -> Arc<Mutex<()>> {
        self.in_flight_locks
            .entry(rel_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Triggers an atomic Copy-Up of `rel_path` from Lower to Upper.
    /// If the path is already in Upper, this is a no-op returning the existing Upper path.
    pub fn copy_up(&self, rel_path: &Path) -> io::Result<PathBuf> {
        if rel_path.as_os_str().is_empty() {
            return Ok(self.state.upper_dir.clone());
        }

        let _guard = self.get_path_lock(rel_path);
        let _lock = _guard.lock();

        let resolution = self.state.resolve(rel_path);
        match resolution {
            PathResolution::Upper(upper_path) => Ok(upper_path),
            PathResolution::Lower(lower_path) => {
                let upper_target = self.state.upper_dir.join(rel_path);

                // 1. Ensure parent directory hierarchy exists in Upper
                if let Some(parent) = upper_target.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent)?;
                    }
                }

                // 2. Remove any lingering whiteout markers
                if let Some(name) = rel_path.file_name() {
                    if let Some(parent) = upper_target.parent() {
                        let _ = remove_whiteout_if_exists(parent, &name.to_string_lossy());
                    }
                }

                // 3. Perform atomic copy depending on directory or file
                if lower_path.is_dir() {
                    fs::create_dir_all(&upper_target)?;
                } else {
                    // Copy file content atomically via temp file in same directory
                    let parent = upper_target.parent().unwrap();
                    let temp_target = parent.join(format!(
                        ".tmp_copyup_{}_{}",
                        std::process::id(),
                        fastrand()
                    ));

                    fs::copy(&lower_path, &temp_target)?;

                    // Preserve timestamps and metadata if possible
                    if let Ok(metadata) = fs::metadata(&lower_path) {
                        let perms = metadata.permissions();
                        let _ = fs::set_permissions(&temp_target, perms);
                    }

                    // Rename temp file into upper_target (atomic on same filesystem)
                    fs::rename(&temp_target, &upper_target)?;
                }

                Ok(upper_target)
            }
            PathResolution::Whiteout | PathResolution::NotFound => Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Source path '{}' does not exist in Lower layer", rel_path.display()),
            )),
        }
    }

    /// Prepares Upper for creating a new file or directory at `rel_path`.
    pub fn prepare_for_create(&self, rel_path: &Path, is_dir: bool) -> io::Result<PathBuf> {
        let upper_target = self.state.upper_dir.join(rel_path);

        if let Some(parent) = upper_target.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
        }

        // Clean up any whiteout marker in parent
        if let Some(name) = rel_path.file_name() {
            if let Some(parent) = upper_target.parent() {
                let _ = remove_whiteout_if_exists(parent, &name.to_string_lossy());
            }
        }

        if is_dir && !upper_target.exists() {
            fs::create_dir_all(&upper_target)?;
        }

        Ok(upper_target)
    }

    /// Deletes `rel_path`.
    /// - If exists in Upper: removed from Upper.
    /// - If exists in Lower: whiteout marker created in Upper.
    pub fn delete_path(&self, rel_path: &Path) -> io::Result<()> {
        let file_name = match rel_path.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Cannot delete root path",
                ));
            }
        };

        let upper_target = self.state.upper_dir.join(rel_path);
        let lower_target = self.state.lower_dir.join(rel_path);

        let parent_rel = rel_path.parent().unwrap_or(Path::new(""));
        let upper_parent = self.state.upper_dir.join(parent_rel);

        let exists_in_upper = upper_target.exists();
        let exists_in_lower = lower_target.exists();

        if !exists_in_upper && !exists_in_lower {
            return Err(io::Error::new(io::ErrorKind::NotFound, "Path not found"));
        }

        // 1. Remove from Upper if physically present
        if exists_in_upper {
            if upper_target.is_dir() {
                fs::remove_dir_all(&upper_target)?;
            } else {
                fs::remove_file(&upper_target)?;
            }
        }

        // 2. If it existed in Lower, we must persist a whiteout marker
        if exists_in_lower {
            super::whiteout::create_whiteout(&upper_parent, &file_name)?;
        }

        Ok(())
    }
}

fn fastrand() -> u64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
}
