use super::state::LayerState;
use super::whiteout::parse_whiteout_name;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct UnifiedDirEntry {
    pub name: String,
    pub is_dir: bool,
    pub physical_path: PathBuf,
    #[allow(dead_code)]
    pub from_upper: bool,
}

pub struct DirectoryMerger;

impl DirectoryMerger {
    /// Reads and merges directory entries from both Upper and Lower layers for `rel_path`.
    pub fn read_directory(state: &LayerState, rel_path: &Path) -> io::Result<Vec<UnifiedDirEntry>> {
        // Direct mode: directly read from the source directory, zero merger overhead
        if state.direct_mode {
            let target_dir = state.upper_dir.join(rel_path);
            let mut list = Vec::new();
            if target_dir.is_dir() {
                if let Ok(read_dir) = fs::read_dir(&target_dir) {
                    for entry in read_dir.flatten() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let file_type = entry.file_type().ok();
                        let is_dir = file_type.map_or(false, |ft| ft.is_dir());
                        list.push(UnifiedDirEntry {
                            name: file_name,
                            is_dir,
                            physical_path: entry.path(),
                            from_upper: true,
                        });
                    }
                }
            }
            return Ok(list);
        }

        let upper_dir = state.upper_dir.join(rel_path);
        let lower_dir = state.lower_dir.join(rel_path);

        let mut whiteouts: HashSet<String> = HashSet::new();
        let mut entries: HashMap<String, UnifiedDirEntry> = HashMap::new();

        // 1. Scan Upper directory
        if upper_dir.is_dir() {
            if let Ok(read_dir) = fs::read_dir(&upper_dir) {
                for entry in read_dir.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();

                    // Check if it's a whiteout marker
                    if let Some(original) = parse_whiteout_name(&file_name) {
                        whiteouts.insert(original.to_lowercase());
                        continue;
                    }

                    // Ignore internal metadata directory (.cowlink, .cowdiff) if at root
                    if rel_path.as_os_str().is_empty() && (file_name == ".cowlink" || file_name == ".cowdiff") {
                        continue;
                    }

                    let file_type = entry.file_type().ok();
                    let is_dir = file_type.map_or(false, |ft| ft.is_dir());

                    entries.insert(
                        file_name.to_lowercase(),
                        UnifiedDirEntry {
                            name: file_name,
                            is_dir,
                            physical_path: entry.path(),
                            from_upper: true,
                        },
                    );
                }
            }
        }

        // 2. Scan Lower directory
        if lower_dir.is_dir() {
            if let Ok(read_dir) = fs::read_dir(&lower_dir) {
                for entry in read_dir.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let key = file_name.to_lowercase();

                    // If deleted by whiteout or already shadowed by Upper, skip
                    if whiteouts.contains(&key) || entries.contains_key(&key) {
                        continue;
                    }

                    // Ignore internal metadata directory (.cowlink, .cowdiff) if at root
                    if rel_path.as_os_str().is_empty() && (key == ".cowlink" || key == ".cowdiff") {
                        continue;
                    }

                    let file_type = entry.file_type().ok();
                    let is_dir = file_type.map_or(false, |ft| ft.is_dir());

                    entries.insert(
                        key,
                        UnifiedDirEntry {
                            name: file_name,
                            is_dir,
                            physical_path: entry.path(),
                            from_upper: false,
                        },
                    );
                }
            }
        }

        let mut result: Vec<UnifiedDirEntry> = entries.into_values().collect();
        result.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(result)
    }
}
