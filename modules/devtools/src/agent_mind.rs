use cowfs::config::WorkspaceMeta;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{SocketAddr, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentMindFileEntryDto {
    pub rel_path: String,
    pub name: String,
    pub category: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified_ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HostProjectCardDto {
    pub code: String,
    pub physical_path: String,
    pub role: String,
    pub summary: String,
    pub detail_rel_path: String,
    pub detail_exists: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentMindOverviewDto {
    pub plugin_root: String,
    pub mounted_target: Option<String>,
    pub mount_alive: bool,
    pub sidecar_running: bool,
    pub sidecar_url: String,
    pub plugin_meta: Value,
    pub config_json: Value,
    pub rules_manifest: Value,
    pub projects: Vec<HostProjectCardDto>,
    pub files: Vec<AgentMindFileEntryDto>,
}

fn clean_display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s.to_string()
    }
}

fn detect_plugin_location() -> Result<(PathBuf, Option<String>, bool), String> {
    let mut mounted_target: Option<String> = None;
    let mut mount_alive = false;
    let mut candidates: Vec<PathBuf> = Vec::new();

    for meta in WorkspaceMeta::list_all() {
        let src_name = meta
            .source_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let tgt_name = meta
            .target_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if src_name.eq_ignore_ascii_case("agent-mind") || tgt_name.eq_ignore_ascii_case("agent-mind")
        {
            mounted_target = Some(clean_display_path(&meta.target_dir));
            mount_alive = meta.is_alive();
            if meta.source_dir.join("plugin.json").exists() {
                candidates.push(meta.source_dir.clone());
            }
            if meta.target_dir.join("plugin.json").exists() {
                candidates.push(meta.target_dir.clone());
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(dir) = cur {
                let candidate = dir.join("plugins").join("agent-mind");
                if candidate.join("plugin.json").exists() {
                    candidates.push(candidate);
                }
                cur = dir.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("plugins").join("agent-mind");
        if candidate.join("plugin.json").exists() {
            candidates.push(candidate);
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let fallback = PathBuf::from(profile)
            .join(".gemini")
            .join("config")
            .join("plugins")
            .join("agent-mind");
        if fallback.join("plugin.json").exists() {
            candidates.push(fallback);
        }
    }

    for c in candidates {
        if c.join("plugin.json").exists() {
            return Ok((c, mounted_target, mount_alive));
        }
    }

    Err("未在工作区镜像源、应用目录或 .gemini 插件目录中定位到 agent-mind/plugin.json".to_string())
}

fn resolve_safe_rel_path(root: &Path, rel_path: &str) -> Result<(String, PathBuf), String> {
    let normalized = rel_path.trim().replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    if trimmed.contains(':') || trimmed.contains('\0') {
        return Err("非法文件路径字符".to_string());
    }

    let mut clean_parts: Vec<&str> = Vec::new();
    for comp in Path::new(trimmed).components() {
        match comp {
            Component::Normal(s) => {
                let part = s.to_str().ok_or_else(|| "非法 UTF-8 路径".to_string())?;
                if part == ".git" || part == "node_modules" || part == "dist" {
                    return Err("禁止访问内部保留目录".to_string());
                }
                clean_parts.push(part);
            }
            _ => return Err("禁止使用相对父级目录或根路径跳转".to_string()),
        }
    }

    if clean_parts.is_empty() {
        return Err("无效的相对路径".to_string());
    }

    let clean_rel = clean_parts.join("/");
    let joined = root.join(clean_parts.iter().collect::<PathBuf>());

    let canon_root = std::fs::canonicalize(root)
        .map_err(|e| format!("无法规范化插件根目录: {}", e))?;

    if joined.exists() {
        let canon_target = std::fs::canonicalize(&joined)
            .map_err(|e| format!("无法规范化目标路径: {}", e))?;
        if !canon_target.starts_with(&canon_root) {
            return Err("安全拦截：目标路径越界插件目录".to_string());
        }
    } else if let Some(parent) = joined.parent() {
        let mut check_dir = parent.to_path_buf();
        while !check_dir.exists() {
            check_dir = match check_dir.parent() {
                Some(p) => p.to_path_buf(),
                None => return Err("无效的父目录路径".to_string()),
            };
        }
        let canon_parent = std::fs::canonicalize(&check_dir)
            .map_err(|e| format!("无法规范化父目录: {}", e))?;
        if !canon_parent.starts_with(&canon_root) {
            return Err("安全拦截：创建路径越界插件目录".to_string());
        }
    }

    Ok((clean_rel, joined))
}

fn read_json_or_empty(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|txt| serde_json::from_str::<Value>(&txt).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn collect_files_recursive(
    root: &Path,
    dir: &Path,
    category: &str,
    out: &mut Vec<AgentMindFileEntryDto>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') || file_name == "node_modules" || file_name == "dist" {
            continue;
        }
        if path.is_dir() {
            collect_files_recursive(root, &path, category, out);
        } else if path.is_file() {
            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(
                ext.as_str(),
                "md" | "json" | "html" | "py" | "mjs" | "ts" | "tsx" | "txt"
            ) {
                continue;
            }
            let meta = entry.metadata().ok();
            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_ts = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            out.push(AgentMindFileEntryDto {
                rel_path: rel_str,
                name: file_name,
                category: category.to_string(),
                extension: ext,
                size_bytes,
                modified_ts,
            });
        }
    }
}

fn strip_md_cell(raw: &str) -> String {
    let s = raw.trim();
    let s = s.trim_matches('*').trim_matches('`').trim();
    s.to_string()
}

fn extract_md_link_path(raw: &str) -> String {
    let s = raw.trim();
    if let (Some(l), Some(r)) = (s.find('('), s.rfind(')')) {
        if r > l + 1 {
            return s[l + 1..r].trim().replace('\\', "/");
        }
    }
    strip_md_cell(s)
}

fn parse_projects_index(root: &Path) -> Vec<HostProjectCardDto> {
    let mut cards = Vec::new();
    let path = root.join("projects.md");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return cards;
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') || trimmed.contains("---") {
            continue;
        }
        let cols: Vec<&str> = trimmed
            .trim_matches('|')
            .split('|')
            .map(|c| c.trim())
            .collect();
        if cols.len() < 5 {
            continue;
        }
        let code = strip_md_cell(cols[0]);
        if code.is_empty() || code.contains("项目代号") {
            continue;
        }
        let physical_path = strip_md_cell(cols[1]);
        let role = strip_md_cell(cols[2]);
        let summary = cols[3].trim().to_string();
        let detail_rel_path = extract_md_link_path(cols[4]);
        let detail_exists = if detail_rel_path.is_empty() {
            false
        } else {
            root.join(&detail_rel_path).exists()
        };

        cards.push(HostProjectCardDto {
            code,
            physical_path,
            role,
            summary,
            detail_rel_path,
            detail_exists,
        });
    }

    cards
}

fn sidecar_port() -> u16 {
    std::env::var("ANTIGRAVITY_SIDECAR_WEB_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(18765)
}

fn is_sidecar_alive(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
}

#[tauri::command]
pub fn get_agent_mind_overview() -> Result<AgentMindOverviewDto, String> {
    let (root, mounted_target, mount_alive) = detect_plugin_location()?;

    let plugin_meta = read_json_or_empty(&root.join("plugin.json"));
    let config_json = read_json_or_empty(&root.join("config.json"));
    let rules_manifest = read_json_or_empty(&root.join("rules").join("manifest.json"));
    let projects = parse_projects_index(&root);

    let mut files = Vec::new();
    for (dir_name, category) in [
        ("rules", "rules"),
        ("projects", "projects"),
        ("skills", "skills"),
        ("agents", "agents"),
    ] {
        let sub = root.join(dir_name);
        if sub.is_dir() {
            collect_files_recursive(&root, &sub, category, &mut files);
        }
    }

    for (top_file, category) in [
        ("projects.md", "projects"),
        ("design.md", "config"),
        ("plugin.json", "config"),
        ("config.json", "config"),
        ("readme.md", "config"),
    ] {
        let fp = root.join(top_file);
        if fp.is_file() {
            let meta = std::fs::metadata(&fp).ok();
            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_ts = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let ext = fp
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            files.push(AgentMindFileEntryDto {
                rel_path: top_file.to_string(),
                name: top_file.to_string(),
                category: category.to_string(),
                extension: ext,
                size_bytes,
                modified_ts,
            });
        }
    }

    files.sort_by(|a, b| a.category.cmp(&b.category).then_with(|| a.rel_path.cmp(&b.rel_path)));

    let port = sidecar_port();
    let sidecar_running = is_sidecar_alive(port);

    Ok(AgentMindOverviewDto {
        plugin_root: clean_display_path(&root),
        mounted_target,
        mount_alive,
        sidecar_running,
        sidecar_url: format!("http://127.0.0.1:{}", port),
        plugin_meta,
        config_json,
        rules_manifest,
        projects,
        files,
    })
}

#[tauri::command]
pub fn read_agent_mind_file(rel_path: String) -> Result<String, String> {
    let (root, _, _) = detect_plugin_location()?;
    let (_, target) = resolve_safe_rel_path(&root, &rel_path)?;
    if !target.is_file() {
        return Err(format!("文件不存在: {}", rel_path));
    }
    std::fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn save_agent_mind_file(rel_path: String, content: String) -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    let (_, target) = resolve_safe_rel_path(&root, &rel_path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&target, content.as_bytes()).map_err(|e| format!("保存文件失败: {}", e))
}

#[tauri::command]
pub fn create_agent_mind_rule(rel_path: String, content: String) -> Result<String, String> {
    let (root, _, _) = detect_plugin_location()?;
    let raw = rel_path.trim().replace('\\', "/");
    let normalized = if raw.contains('/') {
        raw
    } else {
        format!("rules/{}", raw)
    };
    let with_ext = if normalized.ends_with(".md") || normalized.ends_with(".json") {
        normalized
    } else {
        format!("{}.md", normalized)
    };

    let (clean_rel, target) = resolve_safe_rel_path(&root, &with_ext)?;
    if target.exists() {
        return Err(format!("文件已存在: {}", clean_rel));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&target, content.as_bytes()).map_err(|e| format!("创建规则失败: {}", e))?;
    Ok(clean_rel)
}

#[tauri::command]
pub fn delete_agent_mind_file(rel_path: String) -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    let (clean_rel, target) = resolve_safe_rel_path(&root, &rel_path)?;

    if matches!(
        clean_rel.as_str(),
        "plugin.json" | "config.json" | "projects.md" | "rules/AGENTS.md" | "rules/manifest.json"
    ) {
        return Err("核心基础文件受保护，禁止直接删除".to_string());
    }

    if !(clean_rel.starts_with("rules/") || clean_rel.starts_with("projects/")) {
        return Err("仅允许在 DevTools 中删除 rules/ 或 projects/ 下的扩展文件".to_string());
    }

    if !target.is_file() {
        return Err(format!("文件不存在: {}", clean_rel));
    }

    std::fs::remove_file(&target).map_err(|e| format!("删除文件失败: {}", e))
}

#[tauri::command]
pub fn open_agent_mind_dir() -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    crate::open_in_explorer_native(&root);
    Ok(())
}

#[tauri::command]
pub fn launch_agent_mind_sidecar() -> Result<String, String> {
    let port = sidecar_port();
    let url = format!("http://127.0.0.1:{}", port);

    if !is_sidecar_alive(port) {
        let exe = std::env::current_exe()
            .map_err(|e| format!("定位当前可执行文件失败: {}", e))?;
        let mut cmd = std::process::Command::new(exe);
        cmd.arg("sidecar-board")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.spawn()
            .map_err(|e| format!("启动 Sidecar 独立看板进程失败: {}", e))?;
        std::thread::sleep(Duration::from_millis(250));
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    Ok(url)
}
