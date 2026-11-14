use cowfs::config::WorkspaceMeta;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

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
pub struct DshReviewRecordDto {
    pub id: String,
    pub rel_path: String,
    pub timestamp: String,
    pub modified_ts: u64,
    pub repo: String,
    pub workspace: String,
    pub round: u32,
    pub verdict: String,
    pub title: String,
    pub session_id: String,
    pub duration_sec: f64,
    pub summary: String,
    pub size_bytes: u64,
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
    pub projects: Vec<HostProjectCardDto>,
    pub reviews: Vec<DshReviewRecordDto>,
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

fn path_to_rel_string(rel: &Path) -> Result<String, String> {
    let mut out: Vec<String> = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(s) => {
                let part = s
                    .to_str()
                    .ok_or_else(|| "非法 UTF-8 规范路径".to_string())?;
                out.push(part.to_string());
            }
            _ => return Err("安全拦截：规范相对路径包含非法组件".to_string()),
        }
    }
    if out.is_empty() {
        return Err("无效的规范相对路径".to_string());
    }
    Ok(out.join("/"))
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
                if part.eq_ignore_ascii_case(".git")
                    || part.eq_ignore_ascii_case("node_modules")
                    || part.eq_ignore_ascii_case("dist")
                {
                    return Err("禁止访问内部保留目录".to_string());
                }
                if part.contains('~') || part.ends_with('.') || part.ends_with(' ') {
                    return Err("安全拦截：禁止使用短文件名别名或尾随点空格路径".to_string());
                }
                clean_parts.push(part);
            }
            _ => return Err("禁止使用相对父级目录或根路径跳转".to_string()),
        }
    }

    if clean_parts.is_empty() {
        return Err("无效的相对路径".to_string());
    }

    let joined = root.join(clean_parts.iter().collect::<PathBuf>());
    let canon_root = std::fs::canonicalize(root)
        .map_err(|e| format!("无法规范化插件根目录: {}", e))?;

    if joined.exists() {
        let canon_target = std::fs::canonicalize(&joined)
            .map_err(|e| format!("无法规范化目标路径: {}", e))?;
        if !canon_target.starts_with(&canon_root) {
            return Err("安全拦截：目标路径越界插件目录".to_string());
        }
        let canon_rel_path = canon_target
            .strip_prefix(&canon_root)
            .map_err(|e| format!("无法计算规范相对路径: {}", e))?;
        let canon_rel = path_to_rel_string(canon_rel_path)?;
        return Ok((canon_rel, joined));
    }

    // 目标尚未存在：定位最近已存在祖先并拼接未创建尾部片段，确保目录大小写与物理磁盘一致
    let mut check_dir = joined.clone();
    let mut tail: Vec<String> = Vec::new();
    while !check_dir.exists() {
        let name = check_dir
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "无效的文件或目录名称".to_string())?
            .to_string();
        tail.push(name);
        check_dir = match check_dir.parent() {
            Some(p) => p.to_path_buf(),
            None => return Err("无效的父目录路径".to_string()),
        };
    }
    let canon_ancestor = std::fs::canonicalize(&check_dir)
        .map_err(|e| format!("无法规范化父目录: {}", e))?;
    if !canon_ancestor.starts_with(&canon_root) {
        return Err("安全拦截：创建路径越界插件目录".to_string());
    }
    let ancestor_rel = canon_ancestor
        .strip_prefix(&canon_root)
        .map_err(|e| format!("无法提取父目录相对路径: {}", e))?;
    let mut parts: Vec<String> = Vec::new();
    for comp in ancestor_rel.components() {
        if let Component::Normal(s) = comp {
            parts.push(
                s.to_str()
                    .ok_or_else(|| "非法 UTF-8 路径".to_string())?
                    .to_string(),
            );
        }
    }
    tail.reverse();
    parts.extend(tail);
    let canon_rel = parts.join("/");
    if canon_rel.is_empty() {
        return Err("无效的相对路径".to_string());
    }

    Ok((canon_rel, joined))
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
    let path = root.join("repos.md");
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
        if code.is_empty() || code.contains("仓库代号") || code.contains("项目代号") {
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

fn infer_verdict_from_body(body: &str) -> String {
    if body.contains("【不通过")
        || body.contains("不通过 (HOLD)")
        || body.contains("不通过 (VIOLATED)")
        || body.contains("VIOLATED")
    {
        return "VIOLATED".to_string();
    }
    if body.contains("需人工拍板") || body.contains("REQUIRES_APPROVAL") {
        return "REQUIRES_APPROVAL".to_string();
    }
    if body.contains("终审通过") || body.contains("准予 Commit") || body.contains("PASSED") {
        return "PASSED".to_string();
    }
    "REQUIRES_APPROVAL".to_string()
}

fn extract_body_title_and_summary(body: &str, fallback_id: &str) -> (String, String) {
    let mut title = String::new();
    let mut summary = String::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if title.is_empty() && trimmed.starts_with('#') {
            title = trimmed.trim_start_matches('#').trim().to_string();
            continue;
        }
        if summary.is_empty()
            && !trimmed.starts_with('#')
            && !trimmed.starts_with('|')
            && !trimmed.starts_with("```")
        {
            let plain = trimmed.trim_start_matches(['-', '*', '>', ' ']).trim();
            if !plain.is_empty() {
                summary = plain.chars().take(180).collect();
            }
        }
        if !title.is_empty() && !summary.is_empty() {
            break;
        }
    }
    if title.is_empty() {
        title = fallback_id.to_string();
    }
    if summary.is_empty() {
        summary = "DSH 架构审查归档报告".to_string();
    }
    (title, summary)
}

fn parse_review_frontmatter(raw: &str) -> (std::collections::HashMap<String, String>, &str) {
    let mut map = std::collections::HashMap::new();
    let trimmed_start = raw.trim_start_matches('\u{feff}');
    if let Some(after_open) = trimmed_start
        .strip_prefix("---\r\n")
        .or_else(|| trimmed_start.strip_prefix("---\n"))
    {
        if let Some(end_idx) = after_open
            .find("\r\n---\r\n")
            .or_else(|| after_open.find("\n---\n"))
            .or_else(|| after_open.find("\r\n---"))
            .or_else(|| after_open.find("\n---"))
        {
            let yaml_block = &after_open[..end_idx];
            let rest = &after_open[end_idx..];
            let body = rest
                .trim_start_matches("\r\n---")
                .trim_start_matches("\n---")
                .trim_start_matches('\r')
                .trim_start_matches('\n');
            for line in yaml_block.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim().to_ascii_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !key.is_empty() {
                        map.insert(key, val);
                    }
                }
            }
            return (map, body);
        }
    }
    (map, raw)
}

fn collect_review_md_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_review_md_files(&path, out);
        } else if path.is_file() {
            let is_md = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if is_md {
                out.push(path);
            }
        }
    }
}

pub(crate) fn parse_reviews_dir(root: &Path) -> Vec<DshReviewRecordDto> {
    let reviews_dir = root.join("reviews");
    if !reviews_dir.is_dir() {
        return Vec::new();
    }

    let mut md_paths = Vec::new();
    collect_review_md_files(&reviews_dir, &mut md_paths);

    let mut records = Vec::new();
    for path in md_paths {
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(rel_from_root) = path.strip_prefix(root) else {
            continue;
        };
        let rel_path = rel_from_root.to_string_lossy().replace('\\', "/");
        let inferred_repo = path
            .strip_prefix(&reviews_dir)
            .ok()
            .and_then(|sub| {
                let mut comps = sub.components();
                let first = comps.next()?;
                // 若还有第二段说明位于 reviews/<repo>/<file>.md 子目录下
                if comps.next().is_some() {
                    Some(first.as_os_str().to_string_lossy().to_string())
                } else {
                    None
                }
            });

        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let meta = std::fs::metadata(&path).ok();
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(raw.len() as u64);
        let modified_ts = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(file_name)
            .to_string();
        let (fm, body) = parse_review_frontmatter(&raw);
        let (fallback_title, fallback_summary) = extract_body_title_and_summary(body, &stem);

        let id = fm
            .get("id")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or_else(|| stem.clone());
        let timestamp = fm.get("timestamp").cloned().unwrap_or_default();
        let repo = fm
            .get("repo")
            .filter(|v| !v.is_empty())
            .cloned()
            .or(inferred_repo)
            .unwrap_or_else(|| "unknown".to_string());
        let workspace = fm.get("workspace").cloned().unwrap_or_default();
        let round = fm
            .get("round")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(1);
        let verdict = fm
            .get("verdict")
            .filter(|v| !v.is_empty())
            .map(|v| v.to_ascii_uppercase())
            .unwrap_or_else(|| infer_verdict_from_body(body));
        let title = fm
            .get("title")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(fallback_title);
        let session_id = fm.get("session_id").cloned().unwrap_or_default();
        let duration_sec = fm
            .get("duration_sec")
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0);
        let summary = fm
            .get("summary")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(fallback_summary);

        records.push(DshReviewRecordDto {
            id,
            rel_path,
            timestamp,
            modified_ts,
            repo,
            workspace,
            round,
            verdict,
            title,
            session_id,
            duration_sec,
            summary,
            size_bytes,
        });
    }

    records.sort_by(|a, b| {
        b.timestamp
            .cmp(&a.timestamp)
            .then_with(|| b.modified_ts.cmp(&a.modified_ts))
            .then_with(|| b.id.cmp(&a.id))
    });
    records
}

fn sidecar_port() -> u16 {
    std::env::var("ANTIGRAVITY_SIDECAR_WEB_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(18765)
}

fn mask_config_secrets(mut val: Value) -> Value {
    if let Some(obj) = val.as_object_mut() {
        if let Some(raw_key) = obj.get("api_key").and_then(|v| v.as_str()) {
            let trimmed = raw_key.trim();
            if !trimmed.is_empty() && !(trimmed.starts_with("${") && trimmed.ends_with('}')) {
                obj.insert("api_key".to_string(), Value::String("***MASKED***".to_string()));
            }
        }
    }
    val
}

fn is_config_rel_path(rel: &str) -> bool {
    rel.eq_ignore_ascii_case("config.json")
}

fn is_protected_rel_path(rel: &str) -> bool {
    [
        "plugin.json",
        "config.json",
        "repos.md",
        "rules/mind-rules.md",
        "repos/relations.md",
    ]
    .iter()
    .any(|p| rel.eq_ignore_ascii_case(p))
}

fn is_allowed_writable_rel_path(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    lower.starts_with("rules/")
        || lower.starts_with("repos/")
        || matches!(lower.as_str(), "repos.md" | "config.json")
}

#[tauri::command]
pub fn get_agent_mind_overview() -> Result<AgentMindOverviewDto, String> {
    let (root, mounted_target, mount_alive) = detect_plugin_location()?;

    let plugin_meta = read_json_or_empty(&root.join("plugin.json"));
    let config_json = mask_config_secrets(read_json_or_empty(&root.join("config.json")));
    let projects = parse_projects_index(&root);
    let reviews = parse_reviews_dir(&root);

    let mut files = Vec::new();
    for (dir_name, category) in [
        ("rules", "rules"),
        ("repos", "projects"),
        ("reviews", "reviews"),
        ("skills", "skills"),
        ("agents", "agents"),
    ] {
        let sub = root.join(dir_name);
        if sub.is_dir() {
            collect_files_recursive(&root, &sub, category, &mut files);
        }
    }

    for (top_file, category) in [
        ("repos.md", "projects"),
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
    let sidecar_running = crate::sidecar::is_running();

    Ok(AgentMindOverviewDto {
        plugin_root: clean_display_path(&root),
        mounted_target,
        mount_alive,
        sidecar_running,
        sidecar_url: format!("http://127.0.0.1:{}", port),
        plugin_meta,
        config_json,
        projects,
        reviews,
        files,
    })
}

fn read_file_in_root(root: &Path, rel_path: &str) -> Result<String, String> {
    let (clean_rel, target) = resolve_safe_rel_path(root, rel_path)?;
    if !target.is_file() {
        return Err(format!("文件不存在: {}", rel_path));
    }
    let raw = std::fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {}", e))?;
    if is_config_rel_path(&clean_rel) {
        let parsed = serde_json::from_str::<Value>(&raw)
            .map_err(|e| format!("config.json 格式损坏，已拒绝返回原文以保护密钥安全: {}", e))?;
        let masked = mask_config_secrets(parsed);
        let pretty = serde_json::to_string_pretty(&masked)
            .map_err(|e| format!("序列化脱敏配置失败: {}", e))?;
        return Ok(format!("{}\n", pretty));
    }
    Ok(raw)
}

#[tauri::command]
pub fn read_agent_mind_file(rel_path: String) -> Result<String, String> {
    let (root, _, _) = detect_plugin_location()?;
    read_file_in_root(&root, &rel_path)
}

fn save_file_in_root(root: &Path, rel_path: &str, content: String) -> Result<(), String> {
    let (clean_rel, target) = resolve_safe_rel_path(root, rel_path)?;
    if !is_allowed_writable_rel_path(&clean_rel) {
        return Err(format!("安全拦截：不允许通过面板修改受限路径 {}", clean_rel));
    }

    let final_content = if is_config_rel_path(&clean_rel) {
        let mut incoming = serde_json::from_str::<Value>(&content)
            .map_err(|e| format!("config.json 必须是合法的 JSON 对象: {}", e))?;
        let obj = incoming
            .as_object_mut()
            .ok_or_else(|| "config.json 必须是合法的 JSON 对象".to_string())?;
        let incoming_key = obj
            .get("api_key")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if incoming_key == "***MASKED***" || incoming_key == "***" {
            let preserved = if target.is_file() {
                let existing_raw = std::fs::read_to_string(&target)
                    .map_err(|e| format!("读取现有 config.json 失败: {}", e))?;
                let existing: Value = serde_json::from_str(&existing_raw).map_err(|e| {
                    format!("现有 config.json 格式损坏，无法保留原 api_key: {}", e)
                })?;
                existing
                    .get("api_key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("${GEMINI_API_KEY}")
                    .to_string()
            } else {
                "${GEMINI_API_KEY}".to_string()
            };
            obj.insert("api_key".to_string(), Value::String(preserved));
        }
        serde_json::to_string_pretty(&incoming)
            .map(|s| format!("{}\n", s))
            .map_err(|e| format!("序列化 config.json 失败: {}", e))?
    } else {
        content
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&target, final_content.as_bytes()).map_err(|e| format!("保存文件失败: {}", e))
}

#[tauri::command]
pub fn save_agent_mind_file(rel_path: String, content: String) -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    save_file_in_root(&root, &rel_path, content)
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
    let lower_norm = normalized.to_ascii_lowercase();
    let with_ext = if lower_norm.ends_with(".md") || lower_norm.ends_with(".json") {
        normalized
    } else {
        format!("{}.md", normalized)
    };

    let (clean_rel, target) = resolve_safe_rel_path(&root, &with_ext)?;
    let lower_clean = clean_rel.to_ascii_lowercase();
    if !lower_clean.starts_with("rules/") && !lower_clean.starts_with("repos/") {
        return Err("仅允许在 rules/ 或 repos/ 目录下创建规则与仓库卡片".to_string());
    }
    if target.exists() {
        return Err(format!("文件已存在: {}", clean_rel));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&target, content.as_bytes()).map_err(|e| format!("创建规则失败: {}", e))?;
    Ok(clean_rel)
}

fn delete_file_in_root(root: &Path, rel_path: &str) -> Result<(), String> {
    let (clean_rel, target) = resolve_safe_rel_path(root, rel_path)?;

    if is_protected_rel_path(&clean_rel) {
        return Err("核心基础文件受保护，禁止直接删除".to_string());
    }

    let lower = clean_rel.to_ascii_lowercase();
    if !(lower.starts_with("rules/") || lower.starts_with("repos/") || lower.starts_with("reviews/")) {
        return Err("仅允许在 DevTools 中删除 rules/、repos/ 或 reviews/ 下的扩展与审查归档文件".to_string());
    }

    if !target.is_file() {
        return Err(format!("文件不存在: {}", clean_rel));
    }

    std::fs::remove_file(&target).map_err(|e| format!("删除文件失败: {}", e))?;
    if lower.starts_with("reviews/") {
        if let Some(parent) = target.parent() {
            let reviews_root = root.join("reviews");
            let is_reviews_root = parent.eq(&reviews_root)
                || std::fs::canonicalize(parent)
                    .ok()
                    .zip(std::fs::canonicalize(&reviews_root).ok())
                    .map(|(a, b)| a == b)
                    .unwrap_or(false);
            if !is_reviews_root {
                let is_empty = std::fs::read_dir(parent)
                    .map(|mut it| it.next().is_none())
                    .unwrap_or(false);
                if is_empty {
                    let _ = std::fs::remove_dir(parent);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_agent_mind_file(rel_path: String) -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    delete_file_in_root(&root, &rel_path)
}

#[tauri::command]
pub fn open_agent_mind_dir() -> Result<(), String> {
    let (root, _, _) = detect_plugin_location()?;
    crate::open_in_explorer_native(&root);
    Ok(())
}

#[cfg(windows)]
fn open_url_native(url: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let op: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = format!("{}\0", url).encode_utf16().collect();
    let res = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(op.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (res.0 as isize) <= 32 {
        return Err(format!("ShellExecuteW 打开看板 URL 失败 (code={:?})", res.0));
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_url_native(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开看板 URL 失败: {}", e))
}

#[tauri::command]
pub fn launch_agent_mind_sidecar() -> Result<String, String> {
    let port = sidecar_port();
    let url = format!("http://127.0.0.1:{}", port);
    crate::sidecar::ensure_running(port)?;
    open_url_native(&url)?;
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQ: AtomicU64 = AtomicU64::new(1);

    struct TempPluginDir(PathBuf);

    impl TempPluginDir {
        fn new() -> Self {
            let seq = TEST_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "a8_agent_mind_test_{}_{}",
                std::process::id(),
                seq
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("rules")).unwrap();
            std::fs::create_dir_all(dir.join("repos")).unwrap();
            std::fs::create_dir_all(dir.join("skills")).unwrap();
            std::fs::write(dir.join("plugin.json"), r#"{"name":"agent-mind"}"#).unwrap();
            std::fs::write(
                dir.join("config.json"),
                r#"{"api_key":"real-secret-key-xyz","model":"gemini-decision-1"}"#,
            )
            .unwrap();
            std::fs::write(dir.join("repos.md"), "# repos\n").unwrap();
            std::fs::write(dir.join("rules").join("mind-rules.md"), "# core\n").unwrap();
            std::fs::write(dir.join("repos").join("relations.md"), "# rel\n").unwrap();
            std::fs::write(dir.join("rules").join("custom.md"), "# custom\n").unwrap();
            Self(dir)
        }
    }

    impl Drop for TempPluginDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn test_case_alias_canonicalizes_and_masks_config_secret() {
        let tmp = TempPluginDir::new();
        let (clean_rel, _) = resolve_safe_rel_path(&tmp.0, "CONFIG.JSON").unwrap();
        assert_eq!(clean_rel, "config.json");

        let content = read_file_in_root(&tmp.0, "CONFIG.JSON").unwrap();
        assert!(content.contains("***MASKED***"));
        assert!(!content.contains("real-secret-key-xyz"));
    }

    #[test]
    fn test_malformed_config_fails_closed_on_read_and_save() {
        let tmp = TempPluginDir::new();
        assert!(save_file_in_root(&tmp.0, "CONFIG.JSON", "{broken json".to_string()).is_err());

        std::fs::write(tmp.0.join("config.json"), r#"{"api_key": "secret", "#).unwrap();
        let err = read_file_in_root(&tmp.0, "config.json").unwrap_err();
        assert!(err.contains("config.json"));
    }

    #[test]
    fn test_save_config_preserves_secret_on_masked_sentinel() {
        let tmp = TempPluginDir::new();
        let payload = r#"{"api_key":"***MASKED***","model":"gemini-decision-1"}"#.to_string();
        save_file_in_root(&tmp.0, "CONFIG.JSON", payload).unwrap();

        let disk_raw = std::fs::read_to_string(tmp.0.join("config.json")).unwrap();
        assert!(disk_raw.contains("real-secret-key-xyz"));
    }

    #[test]
    fn test_protected_files_cannot_be_deleted_via_case_aliases() {
        let tmp = TempPluginDir::new();
        for alias in [
            "rules/MIND-RULES.MD",
            "repos/RELATIONS.MD",
            "CONFIG.JSON",
            "PLUGIN.JSON",
            "REPOS.MD",
        ] {
            assert!(is_protected_rel_path(alias), "expected protected: {}", alias);
            assert!(
                delete_file_in_root(&tmp.0, alias).is_err(),
                "expected delete blocked for {}",
                alias
            );
        }

        assert!(tmp.0.join("rules").join("mind-rules.md").is_file());
        assert!(tmp.0.join("repos").join("relations.md").is_file());

        // Non-protected extension rules can still be deleted
        delete_file_in_root(&tmp.0, "rules/custom.md").unwrap();
        assert!(!tmp.0.join("rules").join("custom.md").exists());
    }

    #[test]
    fn test_writable_path_guard_and_short_alias_rejection() {
        assert!(is_allowed_writable_rel_path("rules/a.md"));
        assert!(is_allowed_writable_rel_path("Rules/A.md"));
        assert!(is_allowed_writable_rel_path("repos/turbo.md"));
        assert!(is_allowed_writable_rel_path("CONFIG.JSON"));
        assert!(!is_allowed_writable_rel_path("skills/arch-judge/SKILL.md"));
        assert!(!is_allowed_writable_rel_path("agents/arch-judge.md"));
        assert!(!is_allowed_writable_rel_path("plugin.json"));

        let tmp = TempPluginDir::new();
        assert!(resolve_safe_rel_path(&tmp.0, "CONFIG~1.JSO").is_err());
        assert!(resolve_safe_rel_path(&tmp.0, "config.json.").is_err());
        assert!(resolve_safe_rel_path(&tmp.0, ".GIT/config").is_err());

        let masked_ph = mask_config_secrets(serde_json::json!({"api_key": "${GEMINI_API_KEY}"}));
        assert_eq!(masked_ph["api_key"], "${GEMINI_API_KEY}");
    }

    #[test]
    fn test_parse_and_manage_dsh_reviews() {
        let tmp = TempPluginDir::new();
        let reviews_dir = tmp.0.join("reviews");
        let turbo_dir = reviews_dir.join("a8-turbo");
        let devtools_dir = reviews_dir.join("a8-devtools");
        std::fs::create_dir_all(&turbo_dir).unwrap();
        std::fs::create_dir_all(&devtools_dir).unwrap();

        let r1 = "---\n\
id: 20261114-100000-a8-turbo-r17\n\
timestamp: 2026-11-14T10:00:00+08:00\n\
repo: a8-turbo\n\
workspace: E:\\a8-turbo\n\
round: 17\n\
verdict: VIOLATED\n\
title: 确认框文案终审\n\
session_id: session-abc\n\
duration_sec: 15.2\n\
summary: 发现 1 处 UI 文案自相矛盾\n\
---\n\n\
## 终审结论：【不通过 (HOLD)】\n";

        let r2 = "---\n\
id: 20261114-101000-a8-turbo-r18\n\
timestamp: 2026-11-14T10:10:00+08:00\n\
repo: a8-turbo\n\
workspace: E:\\a8-turbo\n\
round: 18\n\
verdict: PASSED\n\
title: 文案修正复核\n\
session_id: session-abc\n\
duration_sec: 8.5\n\
summary: 唯一剩余项已物理闭环\n\
---\n\n\
## 终审结论：【终审通过 (PASSED)】\n";

        let r_no_fm = "## 终审结论：【终审通过 (PASSED)】\n\n未附带 Frontmatter 的兼容报告。\n";

        std::fs::write(turbo_dir.join("20261114-100000-a8-turbo-r17.md"), r1).unwrap();
        std::fs::write(turbo_dir.join("20261114-101000-a8-turbo-r18.md"), r2).unwrap();
        std::fs::write(devtools_dir.join("20261113-090000-legacy.md"), r_no_fm).unwrap();

        let list = parse_reviews_dir(&tmp.0);
        assert_eq!(list.len(), 3);
        // 带有最新时间戳的 r18 应排在第一位
        assert_eq!(list[0].id, "20261114-101000-a8-turbo-r18");
        assert_eq!(list[0].rel_path, "reviews/a8-turbo/20261114-101000-a8-turbo-r18.md");
        assert_eq!(list[0].verdict, "PASSED");
        assert_eq!(list[0].round, 18);
        assert_eq!(list[1].id, "20261114-100000-a8-turbo-r17");
        assert_eq!(list[1].verdict, "VIOLATED");
        // 无 Frontmatter 也可按子目录推断 repo = a8-devtools 与 PASSED / 标题
        assert_eq!(list[2].repo, "a8-devtools");
        assert_eq!(list[2].verdict, "PASSED");
        assert_eq!(list[2].title, "终审结论：【终审通过 (PASSED)】");

        // 可通过 read_file_in_root 读取，但禁止通过 save_file_in_root 篡改归档正文
        let content = read_file_in_root(&tmp.0, "reviews/a8-turbo/20261114-101000-a8-turbo-r18.md").unwrap();
        assert!(content.contains("终审通过"));
        assert!(save_file_in_root(
            &tmp.0,
            "reviews/a8-turbo/20261114-101000-a8-turbo-r18.md",
            "tamper".into()
        )
        .is_err());

        // 允许删除 reviews/<repo>/ 归档（含大小写路径别名），并自动清理空子目录
        delete_file_in_root(&tmp.0, "REVIEWS/a8-devtools/20261113-090000-legacy.md").unwrap();
        assert!(!devtools_dir.join("20261113-090000-legacy.md").exists());
        assert!(!devtools_dir.exists());
    }
}
