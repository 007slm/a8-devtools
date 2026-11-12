use std::path::Path;

/// Resolves the optimal icon path for desktop.ini IconResource.
pub fn resolve_icon_resource() -> String {
    // 1. Check dedicated workspace folder icon first, then app icon
    let candidates = [
        r"E:\a8-devtools\modules\devtools\icons\folder-workspace.ico",
        r"E:\a8-devtools\modules\devtools\icons\icon.ico",
        r"E:\a8-devtools\target\release\a8-devtools.exe",
        r"E:\a8-devtools\target\debug\a8-devtools.exe",
    ];
    for p in &candidates {
        if Path::new(p).exists() {
            return format!("{},0", p);
        }
    }

    // 2. Fallback relative to current running executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let folder_ico = dir.join("folder-workspace.ico");
            if folder_ico.exists() {
                return format!("{},0", folder_ico.to_string_lossy());
            }
            let direct_ico = dir.join("icon.ico");
            if direct_ico.exists() {
                return format!("{},0", direct_ico.to_string_lossy());
            }
        }
        return format!("{},0", exe.to_string_lossy());
    }

    // 3. Absolute default
    r"E:\a8-devtools\modules\devtools\icons\folder-workspace.ico,0".to_string()
}

/// Synthesizes the desktop.ini content in memory.
/// Preserves any existing config from the underlying source directory (Strategy 1).
pub fn synthesize_desktop_ini(existing: Option<&str>, icon_resource: &str) -> String {
    let icon_line = format!("IconResource={}", icon_resource);

    match existing {
        Some(content) => {
            let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
            let mut shell_info_idx = None;
            let mut next_section_idx = None;
            let mut icon_resource_idx = None;

            for (idx, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if trimmed.eq_ignore_ascii_case("[.shellclassinfo]") {
                    shell_info_idx = Some(idx);
                } else if shell_info_idx.is_some() && next_section_idx.is_none() {
                    if trimmed.starts_with('[') && trimmed.ends_with(']') {
                        next_section_idx = Some(idx);
                    } else if trimmed.to_ascii_lowercase().starts_with("iconresource=") {
                        icon_resource_idx = Some(idx);
                    }
                }
            }

            if let Some(idx) = icon_resource_idx {
                // Replace existing IconResource
                lines[idx] = icon_line;
            } else if let Some(sec_idx) = shell_info_idx {
                // Section [.ShellClassInfo] exists, insert right after it
                lines.insert(sec_idx + 1, icon_line);
            } else {
                // No [.ShellClassInfo], append it
                if !lines.is_empty() && !lines.last().map_or(false, |l| l.trim().is_empty()) {
                    lines.push(String::new());
                }
                lines.push("[.ShellClassInfo]".to_string());
                lines.push(icon_line);
                lines.push("[ViewState]".to_string());
                lines.push("Mode=".to_string());
                lines.push("Vid=".to_string());
                lines.push("FolderType=Generic".to_string());
            }

            lines.join("\r\n") + "\r\n"
        }
        None => {
            format!(
                "[.ShellClassInfo]\r\n{}\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Generic\r\n",
                icon_line
            )
        }
    }
}

/// Marks a folder with the READONLY attribute on Windows host NTFS so Explorer recognizes desktop.ini.
#[cfg(windows)]
pub fn mark_folder_readonly(path: &Path) {
    use widestring::U16CString;
    use windows::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_READONLY,
        FILE_FLAGS_AND_ATTRIBUTES, INVALID_FILE_ATTRIBUTES,
    };

    if let Ok(wide) = U16CString::from_os_str(path.as_os_str()) {
        unsafe {
            let attrs = GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()));
            if attrs != INVALID_FILE_ATTRIBUTES {
                let _ = SetFileAttributesW(
                    windows::core::PCWSTR(wide.as_ptr()),
                    FILE_FLAGS_AND_ATTRIBUTES(attrs | FILE_ATTRIBUTE_READONLY.0),
                );
            }
        }
    }
}

/// Notifies Windows Shell that folder attributes/icons have been updated.
#[cfg(windows)]
pub fn notify_shell_folder_updated(path: &Path) {
    use widestring::U16CString;
    use windows::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNE_UPDATEDIR, SHCNE_UPDATEITEM, SHCNF_IDLIST,
        SHCNF_PATHW,
    };

    if let Ok(wide) = U16CString::from_os_str(path.as_os_str()) {
        unsafe {
            // 1. Update the folder item itself
            SHChangeNotify(
                SHCNE_UPDATEITEM,
                SHCNF_PATHW,
                Some(wide.as_ptr() as _),
                None,
            );

            // 2. Update parent directory view
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

            // 3. Invalidate shell icon cache
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthesize_when_empty() {
        let res = synthesize_desktop_ini(None, "C:\\test\\icon.ico,0");
        assert!(res.contains("[.ShellClassInfo]"));
        assert!(res.contains("IconResource=C:\\test\\icon.ico,0"));
        assert!(res.contains("FolderType=Generic"));
    }

    #[test]
    fn test_synthesize_when_existing_without_shell_info() {
        let existing = "[LocalizedFileNames]\r\nreadme.txt=说明.txt";
        let res = synthesize_desktop_ini(Some(existing), "C:\\test\\icon.ico,0");
        assert!(res.contains("[LocalizedFileNames]"));
        assert!(res.contains("readme.txt=说明.txt"));
        assert!(res.contains("[.ShellClassInfo]"));
        assert!(res.contains("IconResource=C:\\test\\icon.ico,0"));
    }

    #[test]
    fn test_synthesize_when_existing_with_infotip() {
        let existing = "[.ShellClassInfo]\r\nInfoTip=Custom project folder\r\n[ViewState]\r\nMode=1";
        let res = synthesize_desktop_ini(Some(existing), "C:\\test\\icon.ico,0");
        assert!(res.contains("InfoTip=Custom project folder"));
        assert!(res.contains("IconResource=C:\\test\\icon.ico,0"));
        assert!(res.contains("Mode=1"));
    }

    #[test]
    fn test_synthesize_when_existing_with_old_icon() {
        let existing = "[.ShellClassInfo]\r\nIconResource=old.ico,0\r\nInfoTip=Custom folder";
        let res = synthesize_desktop_ini(Some(existing), "C:\\test\\icon.ico,0");
        assert!(!res.contains("old.ico"));
        assert!(res.contains("IconResource=C:\\test\\icon.ico,0"));
        assert!(res.contains("InfoTip=Custom folder"));
    }
}
