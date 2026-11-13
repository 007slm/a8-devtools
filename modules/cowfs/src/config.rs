use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiffStats {
    pub modified_count: usize,
    pub added_count: usize,
    pub deleted_count: usize,
    pub total_bytes: u64,
    pub changes: Vec<FileChangeDetail>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeDetail {
    pub rel_path: String,
    pub change_type: String, // "修改", "新增", "删除"
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceMeta {
    pub version: u32,
    pub source_dir: PathBuf,
    pub diff_dir: PathBuf,
    pub target_dir: PathBuf,
    pub target_path_hash: String,
    pub mode: String,
    pub created_at: String,
    pub active: bool,
    #[serde(default)]
    pub pid: Option<u32>,
}

impl WorkspaceMeta {
    pub fn new(
        source_dir: impl Into<PathBuf>,
        diff_dir: impl Into<PathBuf>,
        target_dir: impl Into<PathBuf>,
        mode: impl Into<String>,
    ) -> Self {
        let src = source_dir.into();
        let tgt = target_dir.into();
        let path_hash = Self::compute_path_hash(&tgt);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            version: 1,
            source_dir: src,
            diff_dir: diff_dir.into(),
            target_dir: tgt,
            target_path_hash: path_hash,
            mode: mode.into(),
            created_at: format!("{}", now),
            active: true,
            pid: None,
        }
    }

    /// Generates a deterministic sanitized ID + hash for a given target path.
    /// Format: `<folder_slug>_<8_char_hash>`
    pub fn compute_path_hash(target_dir: &Path) -> String {
        let normalized = target_dir
            .to_string_lossy()
            .to_lowercase()
            .replace('\\', "/");
        let mut hasher = DefaultHasher::new();
        normalized.hash(&mut hasher);
        let hash_val = hasher.finish();
        let short_hash = format!("{:08x}", (hash_val & 0xFFFFFFFF));

        let slug: String = target_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("ws")
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let clean_slug = slug.trim_matches('_');
        if clean_slug.is_empty() {
            format!("ws_{}", short_hash)
        } else {
            format!("{}_{}", clean_slug, short_hash)
        }
    }

    /// Root directory for .cowdiff inside the source repository
    pub fn source_cowdiff_root(source_dir: &Path) -> PathBuf {
        source_dir.join(".cowdiff")
    }

    /// Dedicated workspace directory inside source: `source_dir/.cowdiff/{pathHash}`
    pub fn workspace_root_in_source(source_dir: &Path, target_dir: &Path) -> PathBuf {
        let hash = Self::compute_path_hash(target_dir);
        Self::source_cowdiff_root(source_dir).join(hash)
    }

    /// Dedicated diff storage: `source_dir/.cowdiff/{pathHash}/diff`
    pub fn diff_dir_for(source_dir: &Path, target_dir: &Path) -> PathBuf {
        Self::workspace_root_in_source(source_dir, target_dir).join("diff")
    }

    /// Self-contained local metadata: `source_dir/.cowdiff/{pathHash}/meta.json`
    pub fn local_meta_path(source_dir: &Path, target_dir: &Path) -> PathBuf {
        Self::workspace_root_in_source(source_dir, target_dir).join("meta.json")
    }

    /// Global data root: %LOCALAPPDATA%\cowlink
    pub fn global_root() -> PathBuf {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        base.join("cowlink")
    }

    /// Global meta directory: %LOCALAPPDATA%\cowlink\workspaces\<pathHash>
    pub fn global_meta_dir(target_dir: &Path) -> PathBuf {
        let id = Self::compute_path_hash(target_dir);
        Self::global_root().join("workspaces").join(id)
    }

    /// Global meta file path: %LOCALAPPDATA%\cowlink\workspaces\<pathHash>\meta.json
    pub fn global_meta_file_path(target_dir: &Path) -> PathBuf {
        Self::global_meta_dir(target_dir).join("meta.json")
    }

    /// Internal WinFsp backing mount directory: %LOCALAPPDATA%\cowlink\mounts\<pathHash>
    #[allow(dead_code)]
    pub fn internal_mount_dir(target_dir: &Path) -> PathBuf {
        let id = Self::compute_path_hash(target_dir);
        Self::global_root().join("mounts").join(id)
    }

    /// Saves metadata both locally in `source_dir/.cowdiff/{pathHash}/meta.json` (self-contained)
    /// and globally in `%LOCALAPPDATA%\cowlink\workspaces\<pathHash>\meta.json` (central registry).
    pub fn save_both(&self) -> io::Result<()> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // 1. Local self-contained save inside source_dir/.cowdiff/{pathHash}/ (only for copy-on-write with diffs)
        if self.mode != "direct_mirror" {
            let local_ws_dir = Self::workspace_root_in_source(&self.source_dir, &self.target_dir);
            if !local_ws_dir.exists() {
                fs::create_dir_all(&local_ws_dir)?;
            }
            let local_diff_dir = local_ws_dir.join("diff");
            if !local_diff_dir.exists() {
                fs::create_dir_all(&local_diff_dir)?;
            }
            let local_meta = local_ws_dir.join("meta.json");
            fs::write(local_meta, &content)?;
        }

        // 2. Global registry save in %LOCALAPPDATA%\cowlink\workspaces/{pathHash}/
        let global_dir = Self::global_meta_dir(&self.target_dir);
        if !global_dir.exists() {
            fs::create_dir_all(&global_dir)?;
        }
        let global_meta = Self::global_meta_file_path(&self.target_dir);
        fs::write(global_meta, content)?;

        Ok(())
    }

    /// Alias for save_both() for simple global saving
    pub fn save_global(&self) -> io::Result<()> {
        self.save_both()
    }

    /// Loads metadata strictly for `target_dir` by its deterministic path_hash.
    /// Returns physical truth from `source_dir/.cowdiff/{pathHash}/meta.json` when present.
    pub fn load_global(target_dir: &Path) -> io::Result<Self> {
        let meta_file = Self::global_meta_file_path(target_dir);
        if !meta_file.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("未找到工作区元数据: {}", target_dir.display()),
            ));
        }

        let content = fs::read_to_string(&meta_file)?;
        let global_meta: Self = serde_json::from_str(&content)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Check if source's local self-contained meta exists (source is truth)
        let local_meta = Self::local_meta_path(&global_meta.source_dir, &global_meta.target_dir);
        if local_meta.exists() {
            if let Ok(local_content) = fs::read_to_string(&local_meta) {
                if let Ok(lm) = serde_json::from_str::<Self>(&local_content) {
                    return Ok(lm);
                }
            }
        }

        Ok(global_meta)
    }

    /// Lists all workspaces that strictly conform to the self-contained specification.
    /// Workspaces with invalid schemas, orphaned registries, or missing source meta are filtered out.
    #[allow(dead_code)]
    pub fn list_all() -> Vec<Self> {
        let workspaces_root = Self::global_root().join("workspaces");
        if !workspaces_root.exists() {
            return Vec::new();
        }

        let mut results = Vec::new();
        if let Ok(entries) = fs::read_dir(workspaces_root) {
            for entry in entries.flatten() {
                let folder_name = entry.file_name().to_string_lossy().to_string();
                let meta_file = entry.path().join("meta.json");

                if !meta_file.exists() {
                    // Dirty legacy folder with no meta.json, drop it
                    let _ = fs::remove_dir_all(entry.path());
                    continue;
                }

                let content = match fs::read_to_string(&meta_file) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let global_meta: Self = match serde_json::from_str(&content) {
                    Ok(m) => m,
                    Err(_) => {
                        // Corrupted or obsolete schema, filter out and clean up
                        let _ = fs::remove_dir_all(entry.path());
                        continue;
                    }
                };

                // Hash conformity verification
                if global_meta.target_path_hash != folder_name {
                    let _ = fs::remove_dir_all(entry.path());
                    continue;
                }

                // Direct mirror mode: does not require .cowdiff, source directory itself is truth
                if global_meta.mode == "direct_mirror" {
                    if global_meta.source_dir.is_dir() {
                        results.push(global_meta);
                    } else {
                        let _ = fs::remove_dir_all(entry.path());
                    }
                    continue;
                }

                // Physical truth verification: source directory and its .cowdiff meta must exist
                let local_meta = Self::local_meta_path(&global_meta.source_dir, &global_meta.target_dir);
                if !local_meta.exists() {
                    // Source was moved or deleted; remove orphan index and skip
                    let _ = fs::remove_dir_all(entry.path());
                    continue;
                }

                // Load from source's self-contained meta
                if let Ok(local_content) = fs::read_to_string(&local_meta) {
                    if let Ok(lm) = serde_json::from_str::<Self>(&local_content) {
                        results.push(lm);
                        continue;
                    }
                }

                results.push(global_meta);
            }
        }

        // Sort descending by creation timestamp
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    }

    /// Scans a source directory's `.cowdiff` folder, discovers all self-contained workspaces,
    /// and registers them into the local machine's global index.
    #[allow(dead_code)]
    pub fn scan_source_cowdiff(source_dir: &Path) -> Vec<Self> {
        let cowdiff_root = Self::source_cowdiff_root(source_dir);
        let mut discovered = Vec::new();
        if !cowdiff_root.exists() {
            return discovered;
        }

        if let Ok(entries) = fs::read_dir(cowdiff_root) {
            for entry in entries.flatten() {
                let meta_file = entry.path().join("meta.json");
                if meta_file.exists() {
                    if let Ok(content) = fs::read_to_string(&meta_file) {
                        if let Ok(mut meta) = serde_json::from_str::<Self>(&content) {
                            meta.source_dir = source_dir.to_path_buf();
                            let _ = meta.save_both();
                            discovered.push(meta);
                        }
                    }
                }
            }
        }
        discovered
    }

    /// Recursively computes diff stats for this workspace
    #[allow(dead_code)]
    pub fn compute_diff_stats(&self) -> DiffStats {
        let mut stats = DiffStats::default();
        if self.mode == "direct_mirror" || !self.diff_dir.exists() {
            return stats;
        }

        fn walk(dir: &Path, base_diff: &Path, source_dir: &Path, stats: &mut DiffStats) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        walk(&path, base_diff, source_dir, stats);
                    } else if path.is_file() {
                        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        stats.total_bytes += size;

                        if let Ok(rel) = path.strip_prefix(base_diff) {
                            let rel_str = rel.to_string_lossy().to_string();
                            if let Some(deleted_name) = file_name.strip_prefix(".cow_deleted.") {
                                let parent = rel.parent().unwrap_or(Path::new(""));
                                let orig_rel = parent.join(deleted_name);
                                stats.deleted_count += 1;
                                stats.changes.push(FileChangeDetail {
                                    rel_path: orig_rel.to_string_lossy().to_string(),
                                    change_type: "删除".to_string(),
                                    size_bytes: 0,
                                });
                            } else {
                                let orig_file = source_dir.join(rel);
                                if orig_file.exists() {
                                    stats.modified_count += 1;
                                    stats.changes.push(FileChangeDetail {
                                        rel_path: rel_str,
                                        change_type: "修改".to_string(),
                                        size_bytes: size,
                                    });
                                } else {
                                    stats.added_count += 1;
                                    stats.changes.push(FileChangeDetail {
                                        rel_path: rel_str,
                                        change_type: "新增".to_string(),
                                        size_bytes: size,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        walk(&self.diff_dir, &self.diff_dir, &self.source_dir, &mut stats);
        stats
    }

    /// Strictly deletes metadata and diff directories according to standard path hash.
    #[allow(dead_code)]
    pub fn delete_global(target_dir: &Path, delete_diff: bool) -> io::Result<()> {
        let global_dir = Self::global_meta_dir(target_dir);

        // Retrieve source_dir before deletion if possible
        let source_dir = if global_dir.join("meta.json").exists() {
            fs::read_to_string(global_dir.join("meta.json"))
                .ok()
                .and_then(|c| serde_json::from_str::<Self>(&c).ok())
                .map(|m| m.source_dir)
        } else {
            None
        };

        // 1. Remove global registry entry
        if global_dir.exists() {
            let _ = fs::remove_dir_all(&global_dir);
        }

        // 2. Remove physical diff and self-contained workspace inside source/.cowdiff/{hash}
        if delete_diff {
            if let Some(src) = source_dir {
                let local_ws_root = Self::workspace_root_in_source(&src, target_dir);
                if local_ws_root.exists() {
                    let _ = fs::remove_dir_all(&local_ws_root);
                }
            }
        }

        Ok(())
    }

    /// Checks whether the associated process is running (Windows only)
    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        if let Some(pid) = self.pid {
            #[cfg(windows)]
            {
                use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
                use windows::Win32::System::Threading::{
                    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
                };
                unsafe {
                    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                        let mut exit_code: u32 = 0;
                        let alive = GetExitCodeProcess(handle, &mut exit_code).is_ok()
                            && exit_code == STILL_ACTIVE.0 as u32;
                        let _ = CloseHandle(handle);
                        return alive;
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let _ = pid;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_all_workspaces() {
        let list = WorkspaceMeta::list_all();
        println!(">>> Found {} workspaces in list_all", list.len());
        for ws in &list {
            println!("  WS: target={:?}, src={:?}, mode={}", ws.target_dir, ws.source_dir, ws.mode);
        }
    }
}

