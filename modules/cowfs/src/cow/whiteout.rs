use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const WHITEOUT_PREFIX: &str = ".cow_deleted.";
pub const WHITEOUT_SUFFIX: &str = ".__cow_deleted__";
pub const WHITEOUT_DIR_SUFFIX: &str = ".__cow_deleted_dir__";

/// Checks if a file name represents a whiteout marker, returning the original filename if true.
pub fn parse_whiteout_name(file_name: &str) -> Option<String> {
    if let Some(stripped) = file_name.strip_prefix(WHITEOUT_PREFIX) {
        if !stripped.is_empty() {
            return Some(stripped.to_string());
        }
    }
    if let Some(stripped) = file_name.strip_suffix(WHITEOUT_SUFFIX) {
        if !stripped.is_empty() {
            return Some(stripped.to_string());
        }
    }
    if let Some(stripped) = file_name.strip_suffix(WHITEOUT_DIR_SUFFIX) {
        if !stripped.is_empty() {
            return Some(stripped.to_string());
        }
    }
    None
}

/// Creates a standard whiteout filename for an original filename.
pub fn make_whiteout_name(original_name: &str) -> String {
    format!("{}{}", WHITEOUT_PREFIX, original_name)
}

/// Checks whether a whiteout marker exists in the given directory for `original_name`.
pub fn find_whiteout(dir: &Path, original_name: &str) -> Option<PathBuf> {
    let p1 = dir.join(format!("{}{}", WHITEOUT_PREFIX, original_name));
    if p1.exists() {
        return Some(p1);
    }
    let p2 = dir.join(format!("{}{}", original_name, WHITEOUT_SUFFIX));
    if p2.exists() {
        return Some(p2);
    }
    let p3 = dir.join(format!("{}{}", original_name, WHITEOUT_DIR_SUFFIX));
    if p3.exists() {
        return Some(p3);
    }
    None
}

/// Creates a whiteout tombstone marker file for `original_name` in `dir`.
pub fn create_whiteout(dir: &Path, original_name: &str) -> io::Result<PathBuf> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    let marker_path = dir.join(make_whiteout_name(original_name));
    // Create an empty tombstone marker
    fs::File::create(&marker_path)?;
    Ok(marker_path)
}

/// Removes any whiteout tombstone markers for `original_name` in `dir` if present.
pub fn remove_whiteout_if_exists(dir: &Path, original_name: &str) -> io::Result<bool> {
    let mut removed = false;
    let candidates = [
        dir.join(format!("{}{}", WHITEOUT_PREFIX, original_name)),
        dir.join(format!("{}{}", original_name, WHITEOUT_SUFFIX)),
        dir.join(format!("{}{}", original_name, WHITEOUT_DIR_SUFFIX)),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            fs::remove_file(candidate)?;
            removed = true;
        }
    }

    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_whiteout_parsing() {
        assert_eq!(
            parse_whiteout_name(".cow_deleted.test.rs"),
            Some("test.rs".to_string())
        );
        assert_eq!(
            parse_whiteout_name("test.rs.__cow_deleted__"),
            Some("test.rs".to_string())
        );
        assert_eq!(
            parse_whiteout_name("legacy_dir.__cow_deleted_dir__"),
            Some("legacy_dir".to_string())
        );
        assert_eq!(parse_whiteout_name("normal_file.rs"), None);
        assert_eq!(parse_whiteout_name(".cow_deleted."), None);
    }
}
