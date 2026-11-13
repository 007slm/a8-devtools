use super::whiteout::{find_whiteout, parse_whiteout_name};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathResolution {
    /// The path or one of its parent directories has been deleted via a whiteout marker
    Whiteout,
    /// The path exists in the Upper (diff) directory (has been modified or created)
    Upper(PathBuf),
    /// The path exists in the Lower (base) directory and is untouched
    Lower(PathBuf),
    /// The path does not exist in either layer
    NotFound,
}

#[derive(Debug, Clone)]
pub struct LayerState {
    pub lower_dir: PathBuf,
    pub upper_dir: PathBuf,
}

impl LayerState {
    pub fn new(lower_dir: impl Into<PathBuf>, upper_dir: impl Into<PathBuf>) -> Self {
        Self {
            lower_dir: lower_dir.into(),
            upper_dir: upper_dir.into(),
        }
    }

    /// Normalizes a Windows path into a clean relative path (e.g. `\foo\bar` -> `foo/bar`).
    pub fn normalize_rel_path(raw: &str) -> PathBuf {
        let trimmed = raw.trim_matches(|c| c == '/' || c == '\\');
        if trimmed.is_empty() {
            return PathBuf::new();
        }
        let mut clean = PathBuf::new();
        for comp in trimmed.split(['/', '\\']) {
            if comp == "." || comp.is_empty() {
                continue;
            }
            if comp == ".." {
                clean.pop();
            } else {
                clean.push(comp);
            }
        }
        clean
    }

    /// Checks if any ancestor directory of `rel_path` in `upper_dir` has a whiteout marker.
    pub fn is_ancestor_whiteouted(&self, rel_path: &Path) -> bool {
        let mut current = PathBuf::new();
        for component in rel_path.parent().unwrap_or(Path::new("")).components() {
            let comp_str = component.as_os_str().to_string_lossy();
            let parent_upper = self.upper_dir.join(&current);
            if find_whiteout(&parent_upper, &comp_str).is_some() {
                return true;
            }
            current.push(component);
        }
        false
    }

    /// Resolves the current status and location of a relative path.
    pub fn resolve(&self, rel_path: &Path) -> PathResolution {
        // Root path is always valid
        if rel_path.as_os_str().is_empty() {
            return PathResolution::Upper(self.upper_dir.clone());
        }

        // 1. Check if an ancestor directory is whiteouted
        if self.is_ancestor_whiteouted(rel_path) {
            return PathResolution::Whiteout;
        }

        // 2. Check if the item itself is whiteouted in its parent's Upper dir
        let file_name = match rel_path.file_name() {
            Some(name) => name.to_string_lossy(),
            None => return PathResolution::NotFound,
        };

        let parent_rel = rel_path.parent().unwrap_or(Path::new(""));
        let upper_parent = self.upper_dir.join(parent_rel);

        if find_whiteout(&upper_parent, &file_name).is_some() {
            return PathResolution::Whiteout;
        }

        // 3. Check if file/directory physically exists in Upper
        let upper_target = self.upper_dir.join(rel_path);
        if upper_target.exists() {
            if rel_path.starts_with(".cowdiff") || rel_path.starts_with(".cowlink") {
                return PathResolution::NotFound;
            }
            // Also ensure we don't accidentally expose raw whiteout markers directly
            if parse_whiteout_name(&file_name).is_some() {
                return PathResolution::NotFound;
            }
            return PathResolution::Upper(upper_target);
        }

        // 4. Check if file/directory physically exists in Lower
        let lower_target = self.lower_dir.join(rel_path);
        if lower_target.exists() {
            if rel_path.starts_with(".cowdiff") || rel_path.starts_with(".cowlink") {
                return PathResolution::NotFound;
            }
            return PathResolution::Lower(lower_target);
        }
        if lower_target.exists() {
            return PathResolution::Lower(lower_target);
        }

        PathResolution::NotFound
    }
}
