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
    pub has_git: bool,
    pub readme_rel_path: String,
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
pub struct GrokProposalRecordDto {
    pub id: String,
    pub file_name: String,
    pub abs_path: String,
    pub date: String,
    pub modified_ts: u64,
    pub title: String,
    pub source_subject: String,
    pub source_date: String,
    pub status: String,
    pub proposal_count: u32,
    pub summary: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AdvanceProposalResultDto {
    pub conversation_id: String,
    pub focused_antigravity: bool,
    pub method: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RepoDocEntryDto {
    pub repo: String,
    pub doc_tier: String,
    pub doc_type: String,
    pub title: String,
    pub date: String,
    pub status: String,
    pub rel_path: String,
    pub abs_path: String,
    pub size_bytes: u64,
    pub estimated_tokens: u32,
    pub modified_ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GovernanceRuleEntryDto {
    pub rel_path: String,
    pub abs_path: String,
    pub name: String,
    pub scope: String,
    pub repo: String,
    pub title: String,
    pub clause_count: u32,
    #[serde(default)]
    pub char_count: usize,
    #[serde(default)]
    pub estimated_tokens: u32,
    pub editable: bool,
    pub size_bytes: u64,
    pub modified_ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DecisionEntryDto {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub repo: String,
    pub category: String,
    pub enabled: bool,
    #[serde(default)]
    pub retired_at: String,
    #[serde(default)]
    pub retired_reason: String,
    #[serde(default)]
    pub eval_count: u32,
    #[serde(default)]
    pub hit_count: u32,
    #[serde(default)]
    pub last_eval_ts: u64,
    #[serde(default)]
    pub last_hit_ts: u64,
    pub triggers: Vec<String>,
    pub file_patterns: Vec<String>,
    pub instructions: String,
    pub passed_criteria: String,
    pub violated_criteria: String,
    pub why: String,
    pub rel_path: String,
    pub abs_path: String,
    pub editable: bool,
    pub parse_error: Option<String>,
    pub size_bytes: u64,
    pub modified_ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LintItemDto {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub repo: String,
    pub file_name: String,
    pub rel_path: String,
    pub abs_path: String,
    pub description: String,
    pub line_number: u32,
    #[serde(default)]
    pub editable: bool,
    #[serde(default)]
    pub deletable: bool,
    #[serde(default)]
    pub eval_count: u32,
    #[serde(default)]
    pub hit_count: u32,
    #[serde(default)]
    pub last_eval_ts: u64,
    #[serde(default)]
    pub last_hit_ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GovernanceSummaryDto {
    pub rule_files_count: usize,
    pub rule_clauses_count: u32,
    #[serde(default)]
    pub rule_total_tokens: u32,
    #[serde(default)]
    pub global_rule_tokens: u32,
    #[serde(default)]
    pub project_rule_tokens: u32,
    pub global_rule_files_count: usize,
    pub project_rule_files_count: usize,
    pub decisions_count: usize,
    pub enabled_decisions_count: usize,
    pub global_decisions_count: usize,
    pub project_decisions_count: usize,
    pub lints_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HarnessMetricEventDto {
    pub ts: u64,
    pub date: String,
    pub source: String,
    pub mode: String,
    pub repo: String,
    pub verdict: String,
    pub confidence: f64,
    pub docs_choice: String,
    pub lesson_choice: String,
    #[serde(default)]
    pub evaluated_ids: Vec<String>,
    #[serde(default)]
    pub violated_ids: Vec<String>,
    #[serde(default)]
    pub tokens_evaluated: u64,
    #[serde(default)]
    pub api_calls_count: u32,
    #[serde(default)]
    pub diff_chunks_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct GitDiffFileDto {
    pub path: String,
    pub old_path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub truncated: bool,
    pub diff_text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitReviewDiffDto {
    pub repo_code: String,
    pub repo_path: String,
    pub branch: String,
    pub head_summary: String,
    pub scope: String,
    pub has_head: bool,
    pub total_additions: u32,
    pub total_deletions: u32,
    pub files: Vec<GitDiffFileDto>,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct CheckerHitStats {
    pub eval_count: u32,
    pub hit_count: u32,
    pub last_eval_ts: u64,
    pub last_hit_ts: u64,
}

#[derive(Default)]
pub(crate) struct CheckerStatsIndex {
    pub decision_global: std::collections::HashMap<String, CheckerHitStats>,
    pub decision_by_repo: std::collections::HashMap<(String, String), CheckerHitStats>,
    pub lint_global: std::collections::HashMap<String, CheckerHitStats>,
    pub lint_by_repo: std::collections::HashMap<(String, String), CheckerHitStats>,
}

impl CheckerStatsIndex {
    fn lookup_decision(&self, scope: &str, repo: &str, id: &str) -> CheckerHitStats {
        if scope == "global" {
            self.decision_global.get(id).copied().unwrap_or_default()
        } else {
            self.decision_by_repo
                .get(&(repo.to_lowercase(), id.to_string()))
                .copied()
                .unwrap_or_default()
        }
    }

    fn lookup_lint(&self, scope: &str, repo: &str, id: &str) -> CheckerHitStats {
        let up = id.to_ascii_uppercase();
        if scope == "global" {
            self.lint_global.get(&up).copied().unwrap_or_default()
        } else {
            self.lint_by_repo
                .get(&(repo.to_lowercase(), up))
                .copied()
                .unwrap_or_default()
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DailyHarnessTrendDto {
    pub date: String,
    pub allow_or_pass: u32,
    pub hook_woke: u32,
    pub violated_or_error: u32,
    #[serde(default)]
    pub tokens_evaluated: u64,
    #[serde(default)]
    pub diff_chunks_count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HarnessTelemetryDto {
    pub metrics_path: String,
    pub total_events: usize,
    pub stop_hook_events: usize,
    pub judge_events: usize,
    pub docs_gate_triggered: usize,
    pub auto_lint_triggered: usize,
    pub avg_confidence: f64,
    pub threshold: f64,
    #[serde(default)]
    pub total_tokens_evaluated: u64,
    #[serde(default)]
    pub avg_judge_tokens: u64,
    #[serde(default)]
    pub max_judge_tokens: u64,
    #[serde(default)]
    pub total_diff_chunks: u32,
    #[serde(default)]
    pub total_api_calls: u32,
    pub daily_trends: Vec<DailyHarnessTrendDto>,
    pub recent_events: Vec<HarnessMetricEventDto>,
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
    pub proposals: Vec<GrokProposalRecordDto>,
    pub proposals_dir: String,
    pub files: Vec<AgentMindFileEntryDto>,
    pub governance_rules: Vec<GovernanceRuleEntryDto>,
    pub repo_docs: Vec<RepoDocEntryDto>,
    pub decisions: Vec<DecisionEntryDto>,
    pub lints: Vec<LintItemDto>,
    pub governance_summary: GovernanceSummaryDto,
    pub telemetry: HarnessTelemetryDto,
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
        if src_name.eq_ignore_ascii_case("a8-agent-mind")
            || tgt_name.eq_ignore_ascii_case("a8-agent-mind")
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
                let candidate = dir.join("plugins").join("a8-agent-mind");
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
        let candidate = cwd.join("plugins").join("a8-agent-mind");
        if candidate.join("plugin.json").exists() {
            candidates.push(candidate);
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let fallback = PathBuf::from(profile)
            .join(".gemini")
            .join("config")
            .join("plugins")
            .join("a8-agent-mind");
        if fallback.join("plugin.json").exists() {
            candidates.push(fallback);
        }
    }

    for c in candidates {
        if c.join("plugin.json").exists() {
            return Ok((c, mounted_target, mount_alive));
        }
    }

    Err("未在工作区镜像源、应用目录或 .gemini 插件目录中定位到 a8-agent-mind/plugin.json".to_string())
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

fn has_git_repo(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    // 跳过驱动器根目录（如 C:\.git）避免误判机器上的普通文件夹
    dir.ancestors()
        .take_while(|p| p.parent().is_some())
        .any(|p| p.join(".git").exists())
}

fn detect_repo_readme(dir: &Path) -> String {
    if !dir.is_dir() {
        return String::new();
    }
    for name in ["README.md", "readme.md"] {
        if dir.join(name).is_file() {
            return name.to_string();
        }
    }
    String::new()
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
        let phys_trimmed = physical_path.trim();
        let has_git = if phys_trimmed.is_empty() {
            false
        } else {
            has_git_repo(Path::new(phys_trimmed))
        };
        let readme_rel_path = if phys_trimmed.is_empty() {
            String::new()
        } else {
            detect_repo_readme(Path::new(phys_trimmed))
        };

        cards.push(HostProjectCardDto {
            code,
            physical_path,
            role,
            summary,
            detail_rel_path,
            detail_exists,
            has_git,
            readme_rel_path,
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

fn is_devtools_repo_root(dir: &Path) -> bool {
    dir.join("Cargo.toml").is_file() && dir.join("modules").join("devtools").is_dir()
}

fn resolve_devtools_repo_root(plugin_root: &Path, projects: &[HostProjectCardDto]) -> Option<PathBuf> {
    if let Some(candidate) = plugin_root.parent().and_then(|p| p.parent()) {
        if is_devtools_repo_root(candidate) {
            return Some(candidate.to_path_buf());
        }
    }
    for proj in projects {
        if proj.code.eq_ignore_ascii_case("a8-devtools") && !proj.physical_path.trim().is_empty() {
            let p = PathBuf::from(proj.physical_path.trim());
            if is_devtools_repo_root(&p) {
                return Some(p);
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..6 {
            if let Some(dir) = cur {
                if is_devtools_repo_root(&dir) {
                    return Some(dir);
                }
                cur = dir.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        if is_devtools_repo_root(&cwd) {
            return Some(cwd);
        }
    }
    let fallback = Path::new(r"E:\a8-devtools");
    if is_devtools_repo_root(fallback) {
        return Some(fallback.to_path_buf());
    }
    None
}

fn grok_proposals_dir(plugin_root: &Path, projects: &[HostProjectCardDto]) -> Option<PathBuf> {
    resolve_devtools_repo_root(plugin_root, projects)
        .map(|root| root.join("logs").join("grok-proposals"))
}

fn count_proposal_headings(body: &str) -> u32 {
    let mut explicit = 0u32;
    let mut h3 = 0u32;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## 提案") || trimmed.starts_with("### 提案") {
            explicit += 1;
        } else if trimmed.starts_with("### ") {
            h3 += 1;
        }
    }
    if explicit > 0 { explicit } else { h3 }
}

fn infer_date_from_stem(stem: &str) -> String {
    let bytes = stem.as_bytes();
    if bytes.len() >= 10
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
    {
        return stem[0..10].to_string();
    }
    String::new()
}

pub(crate) fn parse_grok_proposals_dir(proposals_dir: &Path) -> Vec<GrokProposalRecordDto> {
    if !proposals_dir.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(proposals_dir) else {
        return Vec::new();
    };

    let mut records = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
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
        let (fallback_title, mut fallback_summary) = extract_body_title_and_summary(body, &stem);
        if fallback_summary == "DSH 架构审查归档报告" {
            fallback_summary = "Grok AI 工作流提升提案".to_string();
        }

        let date = fm
            .get("date")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or_else(|| infer_date_from_stem(&stem));
        let title = fm
            .get("title")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(fallback_title);
        let source_subject = fm.get("source_subject").cloned().unwrap_or_default();
        let source_date = fm.get("source_date").cloned().unwrap_or_default();
        let status = fm
            .get("status")
            .filter(|v| !v.is_empty())
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_else(|| "pending".to_string());
        let proposal_count = fm
            .get("proposal_count")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or_else(|| count_proposal_headings(body));
        let summary = fm
            .get("summary")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(fallback_summary);

        records.push(GrokProposalRecordDto {
            id: stem,
            file_name: file_name.to_string(),
            abs_path: clean_display_path(&path),
            date,
            modified_ts,
            title,
            source_subject,
            source_date,
            status,
            proposal_count,
            summary,
            size_bytes,
        });
    }

    records.sort_by(|a, b| {
        b.date
            .cmp(&a.date)
            .then_with(|| b.modified_ts.cmp(&a.modified_ts))
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    records
}

fn resolve_safe_proposal_file(proposals_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed.contains("..")
        || trimmed.contains('~')
        || trimmed.contains('\0')
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
    {
        return Err("安全拦截：非法的提案文件名".to_string());
    }
    if !trimmed.to_ascii_lowercase().ends_with(".md") {
        return Err("仅支持访问 .md 提案文件".to_string());
    }
    let target = proposals_dir.join(trimmed);
    if !target.is_file() {
        return Err(format!("提案文件不存在: {}", trimmed));
    }
    let canon_dir = std::fs::canonicalize(proposals_dir)
        .map_err(|e| format!("无法规范化提案目录: {}", e))?;
    let canon_target = std::fs::canonicalize(&target)
        .map_err(|e| format!("无法规范化提案路径: {}", e))?;
    if !canon_target.starts_with(&canon_dir) {
        return Err("安全拦截：提案路径越界".to_string());
    }
    Ok(canon_target)
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
        "decisions/lifecycle_and_evolution.decision.json",
        "decisions/topology_and_boundaries.decision.json",
        "decisions/concurrency_and_performance.decision.json",
        "decisions/implementation_hygiene.decision.json",
    ]
    .iter()
    .any(|p| rel.eq_ignore_ascii_case(p))
}

fn is_allowed_writable_rel_path(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    lower.starts_with("rules/")
        || lower.starts_with("decisions/")
        || lower.starts_with("repos/")
        || matches!(lower.as_str(), "repos.md" | "config.json")
}

fn is_allowed_repo_governance_rel(clean_rel: &str, writable: bool) -> bool {
    let lower = clean_rel.to_ascii_lowercase();
    if lower == "agents.md" || lower == "gemini.md" {
        return true;
    }
    if lower.starts_with(".agents/rules/") && lower.ends_with(".md") {
        return true;
    }
    if lower.starts_with("scripts/lints/") {
        if lower.ends_with(".decision.json") {
            return true;
        }
        if !writable && (lower.ends_with(".py") || lower.ends_with(".mjs")) {
            return true;
        }
    }
    if !writable && (lower == "readme.md" || lower.starts_with("docs/")) && lower.ends_with(".md") {
        return true;
    }
    false
}

fn validate_repo_delete_target(clean_rel: &str, target: &Path) -> Result<(), String> {
    let lower = clean_rel.to_ascii_lowercase();
    if lower == "agents.md" || lower == "gemini.md" {
        return Err("仓库根地图 (AGENTS.md / GEMINI.md) 受保护，禁止删除".to_string());
    }
    if lower.starts_with(".agents/rules/") && lower.ends_with(".md") {
        return Ok(());
    }
    if lower.starts_with("scripts/lints/") {
        if lower.ends_with(".decision.json") {
            return Ok(());
        }
        if lower.ends_with(".py") || lower.ends_with(".mjs") {
            let file_name = target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if file_name == "run_lints.py" || file_name == "__init__.py" {
                return Err(format!("安全拦截：核心检查入口 {} 受保护，禁止删除整文件", file_name));
            }
            if lower.ends_with(".py") {
                if let Ok(raw) = std::fs::read_to_string(target) {
                    let check_count = raw
                        .lines()
                        .filter(|ln| ln.trim().starts_with("def check_"))
                        .count();
                    if check_count > 1 {
                        return Err(
                            "安全拦截：该脚本包含多个检查函数，禁止整文件删除，请在源码中移除单个检查函数"
                                .to_string(),
                        );
                    }
                }
            }
            return Ok(());
        }
    }
    Err(
        "仓库作用域仅允许删除 .agents/rules/*.md、scripts/lints/*.decision.json 或独立单检查脚本"
            .to_string(),
    )
}

fn resolve_target_scope(
    plugin_root: &Path,
    repo_code: Option<&str>,
    writable: bool,
) -> Result<(PathBuf, bool), String> {
    let raw = repo_code.unwrap_or("").trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("a8-agent-mind") || raw.eq_ignore_ascii_case("global") {
        return Ok((plugin_root.to_path_buf(), false));
    }
    let projects = parse_projects_index(plugin_root);
    let proj = projects
        .into_iter()
        .find(|p| p.code.eq_ignore_ascii_case(raw))
        .ok_or_else(|| format!("未在仓库地图中定位到项目代号: {}", raw))?;
    if writable && proj.role.eq_ignore_ascii_case("test-bed") {
        return Err(format!("安全拦截：测试靶场 {} 严格只读，禁止修改其规则或门禁", proj.code));
    }
    let phys = proj.physical_path.trim();
    if phys.is_empty() {
        return Err(format!("仓库 {} 未配置物理路径", proj.code));
    }
    let path = PathBuf::from(phys);
    if !path.is_dir() {
        return Err(format!("仓库 {} 物理目录不存在: {}", proj.code, phys));
    }
    Ok((path, true))
}

fn file_meta_stats(path: &Path) -> (u64, u64) {
    let meta = std::fs::metadata(path).ok();
    let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_ts = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (size_bytes, modified_ts)
}

fn extract_rule_title_and_clauses(content: &str, fallback_name: &str) -> (String, u32) {
    let mut title = String::new();
    let mut dash_clauses = 0u32;
    let mut numbered_clauses = 0u32;

    for raw_line in content.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();
        if title.is_empty() && trimmed.starts_with("# ") {
            title = trimmed.trim_start_matches('#').trim().to_string();
        }
        // Top-level bullet rule (- **Title**...) or numbered rule (1. **Title**...)
        if line.starts_with("- **") {
            dash_clauses += 1;
        } else if let Some(dot_pos) = trimmed.find(". **") {
            if dot_pos > 0 && trimmed[..dot_pos].bytes().all(|b| b.is_ascii_digit()) {
                numbered_clauses += 1;
            }
        }
    }

    if title.is_empty() {
        title = fallback_name.trim_end_matches(".md").to_string();
    }
    let total = dash_clauses + numbered_clauses;
    (title, total)
}

fn estimate_markdown_tokens(raw: &str) -> (usize, u32) {
    let mut ascii = 0usize;
    let mut non_ascii = 0usize;
    let mut chars = 0usize;
    for ch in raw.chars() {
        chars += 1;
        if ch.is_ascii() {
            ascii += 1;
        } else {
            non_ascii += 1;
        }
    }
    let est = ((ascii as f64 / 4.0) + (non_ascii as f64 / 1.2)).ceil() as u32;
    (chars, est)
}

fn parse_doc_meta(raw: &str, file_name: &str) -> (String, String, String, String) {
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    let mut title = String::new();
    let mut status = String::new();
    for (idx, raw_line) in raw.lines().take(20).enumerate() {
        let trimmed = raw_line.trim().trim_start_matches('\u{feff}');
        if title.is_empty() && trimmed.starts_with('#') {
            title = trimmed.trim_start_matches('#').trim().to_string();
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- **状态**：") {
            let val = rest.trim();
            if !val.is_empty() {
                status = val.chars().take(48).collect();
            }
        }
        if idx > 0 && !title.is_empty() && !status.is_empty() {
            break;
        }
    }
    if title.is_empty() {
        title = stem.to_string();
    }

    let mut date = String::new();
    let mut doc_type = String::new();
    let bytes = stem.as_bytes();
    if bytes.len() >= 9 && bytes[..8].iter().all(|b| b.is_ascii_digit()) && bytes[8] == b'-' {
        date = format!("{}-{}-{}", &stem[0..4], &stem[4..6], &stem[6..8]);
        let rest = &stem[9..];
        if let Some(first_seg) = rest.split('-').next() {
            if !first_seg.is_empty() && first_seg.chars().all(|c| c.is_ascii_uppercase()) {
                doc_type = first_seg.to_string();
            }
        }
    }
    (title, date, doc_type, status)
}

fn classify_repo_doc_tier(rel_lower: &str, date: &str, status: &str) -> (&'static str, &'static str) {
    let sub = rel_lower.strip_prefix("docs/").unwrap_or(rel_lower);
    if sub.starts_with("evergreen/") {
        return ("evergreen", "EVERGREEN");
    }
    if sub.starts_with("deferred/") {
        return ("deferred", "DEFERRED");
    }
    let is_inactive = status.starts_with("已废弃") || status.starts_with("已暂缓");
    if sub.starts_with("records/") || !date.is_empty() {
        return if is_inactive { ("deferred", "RECORD") } else { ("record", "RECORD") };
    }
    ("other", "DOC")
}

fn collect_repo_docs_recursive(
    repo_root: &Path,
    dir: &Path,
    repo_code: &str,
    out: &mut Vec<RepoDocEntryDto>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if path.is_dir() {
            let lower_dir = name.to_ascii_lowercase();
            if matches!(lower_dir.as_str(), ".git" | "node_modules" | "target" | ".cowdiff" | ".cowlink") {
                continue;
            }
            collect_repo_docs_recursive(repo_root, &path, repo_code, out);
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        let Ok(rel) = path.strip_prefix(repo_root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let rel_lower = rel_str.to_ascii_lowercase();
        let (size_bytes, modified_ts) = file_meta_stats(&path);
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        let (title, date, parsed_type, status) = parse_doc_meta(&raw, name);
        let (tier, fallback_type) = classify_repo_doc_tier(&rel_lower, &date, &status);
        let doc_type = if tier == "evergreen" || parsed_type.is_empty() {
            fallback_type.to_string()
        } else {
            parsed_type
        };
        let (_, estimated_tokens) = estimate_markdown_tokens(&raw);
        out.push(RepoDocEntryDto {
            repo: repo_code.to_string(),
            doc_tier: tier.to_string(),
            doc_type,
            title,
            date,
            status,
            rel_path: rel_str,
            abs_path: clean_display_path(&path),
            size_bytes,
            estimated_tokens,
            modified_ts,
        });
    }
}

fn scan_repo_docs(projects: &[HostProjectCardDto]) -> Vec<RepoDocEntryDto> {
    let mut docs = Vec::new();
    for proj in projects {
        let phys = proj.physical_path.trim();
        if phys.is_empty() {
            continue;
        }
        let docs_dir = PathBuf::from(phys).join("docs");
        if docs_dir.is_dir() {
            collect_repo_docs_recursive(Path::new(phys), &docs_dir, &proj.code, &mut docs);
        }
    }
    let tier_rank = |tier: &str| -> u8 {
        match tier {
            "evergreen" => 0,
            "record" => 1,
            "deferred" => 2,
            _ => 3,
        }
    };
    docs.sort_by(|a, b| {
        a.repo
            .cmp(&b.repo)
            .then_with(|| tier_rank(&a.doc_tier).cmp(&tier_rank(&b.doc_tier)))
            .then_with(|| b.date.cmp(&a.date))
            .then_with(|| b.modified_ts.cmp(&a.modified_ts))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    docs
}

fn push_rule_entry_from_path(
    base_root: &Path,
    path: &Path,
    scope: &str,
    repo: &str,
    editable: bool,
    out: &mut Vec<GovernanceRuleEntryDto>,
) {
    if !path.is_file() {
        return;
    }
    let Ok(rel) = path.strip_prefix(base_root) else {
        return;
    };
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let (size_bytes, modified_ts) = file_meta_stats(path);
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let (title, clause_count) = extract_rule_title_and_clauses(&raw, &name);
    let (char_count, estimated_tokens) = estimate_markdown_tokens(&raw);
    out.push(GovernanceRuleEntryDto {
        rel_path: rel_str,
        abs_path: clean_display_path(path),
        name,
        scope: scope.to_string(),
        repo: repo.to_string(),
        title,
        clause_count,
        char_count,
        estimated_tokens,
        editable,
        size_bytes,
        modified_ts,
    });
}

fn collect_rule_entries_in_dir(
    base_root: &Path,
    rules_dir: &Path,
    scope: &str,
    repo: &str,
    editable: bool,
    out: &mut Vec<GovernanceRuleEntryDto>,
) {
    if !rules_dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(rules_dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("md"))
                    .unwrap_or(false)
        })
        .collect();
    paths.sort();

    for path in paths {
        push_rule_entry_from_path(base_root, &path, scope, repo, editable, out);
    }
}

fn collect_decision_entries_in_dir(
    base_root: &Path,
    decision_dir: &Path,
    scope: &str,
    repo: &str,
    editable: bool,
    stats: &CheckerStatsIndex,
    out: &mut Vec<DecisionEntryDto>,
) {
    if !decision_dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(decision_dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.to_ascii_lowercase().ends_with(".decision.json"))
                    .unwrap_or(false)
        })
        .collect();
    paths.sort();

    for path in paths {
        let Ok(rel) = path.strip_prefix(base_root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("decision.json");
        let fallback_id = file_name
            .strip_suffix(".decision.json")
            .unwrap_or(file_name)
            .to_string();
        let (size_bytes, modified_ts) = file_meta_stats(&path);

        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) => {
                let st = stats.lookup_decision(scope, repo, &fallback_id);
                out.push(DecisionEntryDto {
                    id: fallback_id.clone(),
                    name: fallback_id,
                    scope: scope.to_string(),
                    repo: repo.to_string(),
                    category: "implementation_hygiene".to_string(),
                    enabled: false,
                    retired_at: String::new(),
                    retired_reason: String::new(),
                    eval_count: st.eval_count,
                    hit_count: st.hit_count,
                    last_eval_ts: st.last_eval_ts,
                    last_hit_ts: st.last_hit_ts,
                    triggers: Vec::new(),
                    file_patterns: Vec::new(),
                    instructions: String::new(),
                    passed_criteria: String::new(),
                    violated_criteria: String::new(),
                    why: String::new(),
                    rel_path: rel_str,
                    abs_path: clean_display_path(&path),
                    editable,
                    parse_error: Some(format!("读取失败: {}", e)),
                    size_bytes,
                    modified_ts,
                });
                continue;
            }
        };

        let parsed: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                let st = stats.lookup_decision(scope, repo, &fallback_id);
                out.push(DecisionEntryDto {
                    id: fallback_id.clone(),
                    name: fallback_id,
                    scope: scope.to_string(),
                    repo: repo.to_string(),
                    category: "implementation_hygiene".to_string(),
                    enabled: false,
                    retired_at: String::new(),
                    retired_reason: String::new(),
                    eval_count: st.eval_count,
                    hit_count: st.hit_count,
                    last_eval_ts: st.last_eval_ts,
                    last_hit_ts: st.last_hit_ts,
                    triggers: Vec::new(),
                    file_patterns: Vec::new(),
                    instructions: String::new(),
                    passed_criteria: String::new(),
                    violated_criteria: String::new(),
                    why: String::new(),
                    rel_path: rel_str,
                    abs_path: clean_display_path(&path),
                    editable,
                    parse_error: Some(format!("JSON 解析失败: {}", e)),
                    size_bytes,
                    modified_ts,
                });
                continue;
            }
        };

        let id = parsed
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback_id.clone());
        let name = parsed
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        let category = parsed
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("implementation_hygiene")
            .trim()
            .to_string();
        let enabled = parsed.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let retired_at = parsed
            .get("retired_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let retired_reason = parsed
            .get("retired_reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let triggers = parsed
            .get("triggers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let file_patterns = parsed
            .get("file_patterns")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().replace('\\', "/")))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let q = parsed.get("question");
        let instructions = q
            .and_then(|v| v.get("instructions"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let criteria = q.and_then(|v| v.get("criteria"));
        let passed_criteria = criteria
            .and_then(|v| v.get("passed"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let violated_criteria = criteria
            .and_then(|v| v.get("violated"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let why = parsed
            .get("why")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let parse_error = if instructions.is_empty() || passed_criteria.is_empty() || violated_criteria.is_empty() {
            Some("缺少 question.instructions 或 criteria.passed/violated".to_string())
        } else {
            None
        };
        let st = stats.lookup_decision(scope, repo, &id);

        out.push(DecisionEntryDto {
            id,
            name,
            scope: scope.to_string(),
            repo: repo.to_string(),
            category,
            enabled,
            retired_at,
            retired_reason,
            eval_count: st.eval_count,
            hit_count: st.hit_count,
            last_eval_ts: st.last_eval_ts,
            last_hit_ts: st.last_hit_ts,
            triggers,
            file_patterns,
            instructions,
            passed_criteria,
            violated_criteria,
            why,
            rel_path: rel_str,
            abs_path: clean_display_path(&path),
            editable,
            parse_error,
            size_bytes,
            modified_ts,
        });
    }
}

fn extract_unquoted_ident(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.len() >= 2 {
        let q = s.chars().next()?;
        if (q == '"' || q == '\'') && s.ends_with(q) {
            let inner = s[1..s.len() - 1].trim();
            if !inner.is_empty()
                && inner
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
            {
                return Some(inner.to_ascii_uppercase());
            }
        }
    }
    None
}

fn extract_explicit_check_id(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let trimmed = line.trim();
        let after_kw = trimmed
            .strip_prefix("const ")
            .or_else(|| trimmed.strip_prefix("let "))
            .or_else(|| trimmed.strip_prefix("var "))
            .unwrap_or(trimmed)
            .trim();
        if let Some(rest) = after_kw.strip_prefix("CHECK_ID") {
            let rest = rest.trim_start();
            if let Some(val_part) = rest.strip_prefix('=') {
                let val_token = val_part.trim().trim_end_matches(';').trim();
                if let Some(id) = extract_unquoted_ident(val_token) {
                    return Some(id);
                }
            }
        }
    }
    None
}

fn extract_tuple_check_id_map(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(start) = trimmed.find('(') {
            if let Some(end) = trimmed.rfind(')') {
                if end > start + 1 {
                    let inner = &trimmed[start + 1..end];
                    let parts: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
                    if parts.len() == 2 {
                        if let Some(cid) = extract_unquoted_ident(parts[0]) {
                            let fn_name = parts[1].trim();
                            if fn_name.starts_with("check_")
                                && fn_name
                                    .chars()
                                    .all(|c| c.is_ascii_alphanumeric() || c == '_')
                            {
                                map.insert(fn_name.to_string(), cid);
                            }
                        }
                    }
                }
            }
        }
    }
    map
}

fn extract_pass_tag_id(raw: &str) -> Option<String> {
    for line in raw.lines() {
        if let Some(pos) = line.find("[PASS]") {
            let rest = line[pos + 6..].trim_start();
            let token: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
                .collect();
            if token.len() >= 3
                && token
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == '.')
            {
                return Some(token);
            }
        }
    }
    None
}

fn extract_mjs_description(raw: &str) -> String {
    for line in raw.lines().take(20) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("#!")
            || trimmed == "/**"
            || trimmed == "/*"
            || trimmed == "*/"
            || trimmed == "*"
        {
            continue;
        }
        let cleaned = trimmed
            .trim_start_matches("/*")
            .trim_start_matches("//")
            .trim_start_matches('*')
            .trim_end_matches("*/")
            .trim();
        if cleaned.is_empty() || cleaned.starts_with("import ") || cleaned.starts_with("const ") {
            continue;
        }
        return cleaned.to_string();
    }
    "仓库静态检查脚本 (Node.js)".to_string()
}

fn collect_lint_items_in_dir(
    base_root: &Path,
    lints_dir: &Path,
    scope: &str,
    repo: &str,
    editable: bool,
    stats: &CheckerStatsIndex,
    out: &mut Vec<LintItemDto>,
) {
    if !lints_dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(lints_dir) else {
        return;
    };

    let runner_lower = std::fs::read_to_string(lints_dir.join("run_lints.py"))
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            if !p.is_file() {
                return false;
            }
            let Some(fname) = p.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            if fname == "__init__.py" {
                return false;
            }
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext == "py" {
                return true;
            }
            if ext == "mjs" {
                // Skip .mjs helper scripts already wrapped and surfaced inside run_lints.py
                return runner_lower.is_empty() || !runner_lower.contains(&fname.to_ascii_lowercase());
            }
            false
        })
        .collect();
    paths.sort();

    for path in paths {
        let Ok(rel) = path.strip_prefix(base_root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("lint.py")
            .to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };

        let explicit_id = extract_explicit_check_id(&raw);
        let is_runner_file = file_name.eq_ignore_ascii_case("run_lints.py");

        if ext == "mjs" {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("lint");
            let id = explicit_id
                .or_else(|| extract_pass_tag_id(&raw))
                .unwrap_or_else(|| stem.to_ascii_uppercase());
            let st = stats.lookup_lint(scope, repo, &id);
            out.push(LintItemDto {
                id,
                name: file_name.clone(),
                scope: scope.to_string(),
                repo: repo.to_string(),
                file_name,
                rel_path: rel_str,
                abs_path: clean_display_path(&path),
                description: extract_mjs_description(&raw),
                line_number: 1,
                editable,
                deletable: editable && !is_runner_file,
                eval_count: st.eval_count,
                hit_count: st.hit_count,
                last_eval_ts: st.last_eval_ts,
                last_hit_ts: st.last_hit_ts,
            });
            continue;
        }

        let lines: Vec<&str> = raw.lines().collect();
        let tuple_map = extract_tuple_check_id_map(&raw);
        let check_defs: Vec<(usize, String)> = lines
            .iter()
            .enumerate()
            .filter_map(|(idx, line)| {
                let trimmed = line.trim();
                trimmed.strip_prefix("def check_").and_then(|after_def| {
                    let fn_tail = after_def.split('(').next().unwrap_or("").trim();
                    if fn_tail.is_empty() {
                        None
                    } else {
                        Some((idx, fn_tail.to_string()))
                    }
                })
            })
            .collect();

        if !check_defs.is_empty() {
            let def_count = check_defs.len();
            let file_deletable = editable && !is_runner_file && def_count <= 1;
            for (idx, fn_tail) in check_defs {
                let mut desc = String::new();
                if let Some(next_line) = lines.get(idx + 1) {
                    let nt = next_line.trim();
                    if let Some(inner) = nt.strip_prefix("\"\"\"") {
                        desc = inner.trim_end_matches("\"\"\"").trim().to_string();
                    }
                }
                let fn_name = format!("check_{}", fn_tail);
                let id = tuple_map
                    .get(&fn_name)
                    .cloned()
                    .or_else(|| if def_count == 1 { explicit_id.clone() } else { None })
                    .unwrap_or_else(|| fn_tail.to_ascii_uppercase());
                let st = stats.lookup_lint(scope, repo, &id);
                out.push(LintItemDto {
                    id,
                    name: fn_name,
                    scope: scope.to_string(),
                    repo: repo.to_string(),
                    file_name: file_name.clone(),
                    rel_path: rel_str.clone(),
                    abs_path: clean_display_path(&path),
                    description: if desc.is_empty() {
                        format!("静态检查函数 check_{}", fn_tail)
                    } else {
                        desc
                    },
                    line_number: (idx + 1) as u32,
                    editable,
                    deletable: file_deletable,
                    eval_count: st.eval_count,
                    hit_count: st.hit_count,
                    last_eval_ts: st.last_eval_ts,
                    last_hit_ts: st.last_hit_ts,
                });
            }
        } else {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("lint");
            let id = explicit_id
                .or_else(|| extract_pass_tag_id(&raw))
                .unwrap_or_else(|| stem.to_ascii_uppercase());
            let st = stats.lookup_lint(scope, repo, &id);
            out.push(LintItemDto {
                id,
                name: file_name.clone(),
                scope: scope.to_string(),
                repo: repo.to_string(),
                file_name,
                rel_path: rel_str,
                abs_path: clean_display_path(&path),
                description: "仓库静态检查脚本".to_string(),
                line_number: 1,
                editable,
                deletable: editable && !is_runner_file,
                eval_count: st.eval_count,
                hit_count: st.hit_count,
                last_eval_ts: st.last_eval_ts,
                last_hit_ts: st.last_hit_ts,
            });
        }
    }
}

pub(crate) fn scan_governance_assets(
    plugin_root: &Path,
    projects: &[HostProjectCardDto],
    stats: &CheckerStatsIndex,
) -> (
    Vec<GovernanceRuleEntryDto>,
    Vec<DecisionEntryDto>,
    Vec<LintItemDto>,
    GovernanceSummaryDto,
) {
    let mut rules = Vec::new();
    let mut decisions = Vec::new();
    let mut lints = Vec::new();

    // 1. Global plugin assets
    collect_rule_entries_in_dir(
        plugin_root,
        &plugin_root.join("rules"),
        "global",
        "a8-agent-mind",
        true,
        &mut rules,
    );
    collect_decision_entries_in_dir(
        plugin_root,
        &plugin_root.join("decisions"),
        "global",
        "a8-agent-mind",
        true,
        stats,
        &mut decisions,
    );
    collect_lint_items_in_dir(
        plugin_root,
        &plugin_root.join("lints"),
        "global",
        "a8-agent-mind",
        true,
        stats,
        &mut lints,
    );

    // 2. Per-repository assets from repos.md
    for proj in projects {
        let phys = proj.physical_path.trim();
        if phys.is_empty() {
            continue;
        }
        let repo_root = PathBuf::from(phys);
        if !repo_root.is_dir() {
            continue;
        }
        let editable = !proj.role.eq_ignore_ascii_case("test-bed");
        collect_rule_entries_in_dir(
            &repo_root,
            &repo_root.join(".agents").join("rules"),
            "project",
            &proj.code,
            editable,
            &mut rules,
        );
        for map_name in ["AGENTS.md", "GEMINI.md"] {
            push_rule_entry_from_path(
                &repo_root,
                &repo_root.join(map_name),
                "project",
                &proj.code,
                editable,
                &mut rules,
            );
        }
        collect_decision_entries_in_dir(
            &repo_root,
            &repo_root.join("scripts").join("lints"),
            "project",
            &proj.code,
            editable,
            stats,
            &mut decisions,
        );
        collect_lint_items_in_dir(
            &repo_root,
            &repo_root.join("scripts").join("lints"),
            "project",
            &proj.code,
            editable,
            stats,
            &mut lints,
        );
    }

    rules.sort_by(|a, b| {
        let a_master = (a.scope == "global" && a.rel_path == "rules/mind-rules.md") as u8;
        let b_master = (b.scope == "global" && b.rel_path == "rules/mind-rules.md") as u8;
        b_master
            .cmp(&a_master)
            .then_with(|| a.scope.cmp(&b.scope))
            .then_with(|| a.repo.cmp(&b.repo))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    decisions.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then_with(|| a.repo.cmp(&b.repo))
            .then_with(|| a.id.cmp(&b.id))
    });

    let global_rule_tokens: u32 = rules
        .iter()
        .filter(|r| r.scope == "global")
        .map(|r| r.estimated_tokens)
        .sum();
    let project_rule_tokens: u32 = rules
        .iter()
        .filter(|r| r.scope == "project")
        .map(|r| r.estimated_tokens)
        .sum();

    let summary = GovernanceSummaryDto {
        rule_files_count: rules.len(),
        rule_clauses_count: rules.iter().map(|r| r.clause_count).sum(),
        rule_total_tokens: global_rule_tokens + project_rule_tokens,
        global_rule_tokens,
        project_rule_tokens,
        global_rule_files_count: rules.iter().filter(|r| r.scope == "global").count(),
        project_rule_files_count: rules.iter().filter(|r| r.scope == "project").count(),
        decisions_count: decisions.len(),
        enabled_decisions_count: decisions.iter().filter(|d| d.enabled && d.parse_error.is_none()).count(),
        global_decisions_count: decisions.iter().filter(|d| d.scope == "global").count(),
        project_decisions_count: decisions.iter().filter(|d| d.scope == "project").count(),
        lints_count: lints.len(),
    };

    (rules, decisions, lints, summary)
}

#[tauri::command]
pub fn get_agent_mind_overview() -> Result<AgentMindOverviewDto, String> {
    let (root, mounted_target, mount_alive) = detect_plugin_location()?;

    let plugin_meta = read_json_or_empty(&root.join("plugin.json"));
    let config_json = mask_config_secrets(read_json_or_empty(&root.join("config.json")));
    let projects = parse_projects_index(&root);
    let reviews = parse_reviews_dir(&root);
    let proposals_dir_opt = grok_proposals_dir(&root, &projects);
    let proposals = proposals_dir_opt
        .as_deref()
        .map(parse_grok_proposals_dir)
        .unwrap_or_default();
    let proposals_dir = proposals_dir_opt
        .as_deref()
        .map(clean_display_path)
        .unwrap_or_default();

    let threshold = config_json
        .get("confidence_threshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.85);
    let metrics_path_opt = locate_harness_metrics_path();
    let now_secs = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (telemetry, checker_stats) =
        parse_harness_telemetry_with_stats(metrics_path_opt.as_deref(), threshold, now_secs);

    let (governance_rules, decisions, lints, governance_summary) =
        scan_governance_assets(&root, &projects, &checker_stats);
    let repo_docs = scan_repo_docs(&projects);

    let mut files = Vec::new();
    for (dir_name, category) in [
        ("rules", "rules"),
        ("decisions", "decisions"),
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
        proposals,
        proposals_dir,
        files,
        governance_rules,
        repo_docs,
        decisions,
        lints,
        governance_summary,
        telemetry,
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
pub fn read_agent_mind_file(rel_path: String, repo_code: Option<String>) -> Result<String, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (target_root, is_repo) = resolve_target_scope(&plugin_root, repo_code.as_deref(), false)?;
    if is_repo {
        let (clean_rel, _) = resolve_safe_rel_path(&target_root, &rel_path)?;
        if !is_allowed_repo_governance_rel(&clean_rel, false) {
            return Err(format!(
                "安全拦截：仓库作用域仅允许读取 .agents/rules/*.md 或 scripts/lints/ 门禁文件 ({})",
                clean_rel
            ));
        }
    }
    read_file_in_root(&target_root, &rel_path)
}

fn validate_decision_json_content(content: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(content)
        .map_err(|e| format!("Decision 规范必须是合法 JSON 对象: {}", e))?;
    if !v.is_object() {
        return Err("Decision 规范顶层必须是 JSON 对象".to_string());
    }
    Ok(())
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
    } else if clean_rel.to_ascii_lowercase().ends_with(".decision.json") {
        validate_decision_json_content(&content)?;
        content
    } else {
        content
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&target, final_content.as_bytes()).map_err(|e| format!("保存文件失败: {}", e))
}

#[tauri::command]
pub fn save_agent_mind_file(
    rel_path: String,
    content: String,
    repo_code: Option<String>,
) -> Result<(), String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (target_root, is_repo) = resolve_target_scope(&plugin_root, repo_code.as_deref(), true)?;
    if is_repo {
        let (clean_rel, target) = resolve_safe_rel_path(&target_root, &rel_path)?;
        if !is_allowed_repo_governance_rel(&clean_rel, true) {
            return Err(format!("安全拦截：不允许修改仓库受限路径 {}", clean_rel));
        }
        if clean_rel.to_ascii_lowercase().ends_with(".decision.json") {
            validate_decision_json_content(&content)?;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        return std::fs::write(&target, content.as_bytes())
            .map_err(|e| format!("保存文件失败: {}", e));
    }
    save_file_in_root(&target_root, &rel_path, content)
}

#[tauri::command]
pub fn create_agent_mind_rule(
    rel_path: String,
    content: String,
    repo_code: Option<String>,
) -> Result<String, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (target_root, is_repo) = resolve_target_scope(&plugin_root, repo_code.as_deref(), true)?;
    let raw = rel_path.trim().replace('\\', "/");

    if is_repo {
        let normalized = if raw.contains('/') {
            raw
        } else if raw.to_ascii_lowercase().ends_with(".json") {
            let stem = raw.trim_end_matches(".json");
            let file_name = if stem.ends_with(".decision") {
                format!("{}.json", stem)
            } else {
                format!("{}.decision.json", stem)
            };
            format!("scripts/lints/{}", file_name)
        } else {
            let with_md = if raw.to_ascii_lowercase().ends_with(".md") {
                raw
            } else {
                format!("{}.md", raw)
            };
            format!(".agents/rules/{}", with_md)
        };
        let (clean_rel, target) = resolve_safe_rel_path(&target_root, &normalized)?;
        if !is_allowed_repo_governance_rel(&clean_rel, true) {
            return Err(
                "仓库作用域仅允许在 .agents/rules/*.md 或 scripts/lints/*.decision.json 创建".to_string(),
            );
        }
        if target.exists() {
            return Err(format!("文件已存在: {}", clean_rel));
        }
        if clean_rel.to_ascii_lowercase().ends_with(".decision.json") {
            validate_decision_json_content(&content)?;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::write(&target, content.as_bytes()).map_err(|e| format!("创建文件失败: {}", e))?;
        return Ok(clean_rel);
    }

    let normalized = if raw.contains('/') {
        raw
    } else if raw.to_ascii_lowercase().ends_with(".json") {
        let stem = raw.trim_end_matches(".json");
        let file_name = if stem.ends_with(".decision") {
            format!("{}.json", stem)
        } else {
            format!("{}.decision.json", stem)
        };
        format!("decisions/{}", file_name)
    } else {
        format!("rules/{}", raw)
    };
    let lower_norm = normalized.to_ascii_lowercase();
    let with_ext = if lower_norm.ends_with(".md") || lower_norm.ends_with(".json") {
        normalized
    } else {
        format!("{}.md", normalized)
    };

    let (clean_rel, target) = resolve_safe_rel_path(&target_root, &with_ext)?;
    let lower_clean = clean_rel.to_ascii_lowercase();
    if !(lower_clean.starts_with("rules/")
        || lower_clean.starts_with("repos/")
        || (lower_clean.starts_with("decisions/") && lower_clean.ends_with(".decision.json")))
    {
        return Err("仅允许在 rules/、decisions/*.decision.json 或 repos/ 目录下创建".to_string());
    }
    if target.exists() {
        return Err(format!("文件已存在: {}", clean_rel));
    }
    if lower_clean.ends_with(".decision.json") {
        validate_decision_json_content(&content)?;
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
    if !(lower.starts_with("rules/")
        || lower.starts_with("decisions/")
        || lower.starts_with("repos/")
        || lower.starts_with("reviews/"))
    {
        return Err("仅允许在 DevTools 中删除 rules/、decisions/、repos/ 或 reviews/ 下的扩展与审查归档文件".to_string());
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
pub fn delete_agent_mind_file(rel_path: String, repo_code: Option<String>) -> Result<(), String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (target_root, is_repo) = resolve_target_scope(&plugin_root, repo_code.as_deref(), true)?;
    if is_repo {
        let (clean_rel, target) = resolve_safe_rel_path(&target_root, &rel_path)?;
        validate_repo_delete_target(&clean_rel, &target)?;
        if !target.is_file() {
            return Err(format!("文件不存在: {}", clean_rel));
        }
        return std::fs::remove_file(&target).map_err(|e| format!("删除文件失败: {}", e));
    }
    delete_file_in_root(&target_root, &rel_path)
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

fn locate_proposals_dir() -> Result<PathBuf, String> {
    let (root, _, _) = detect_plugin_location()?;
    let projects = parse_projects_index(&root);
    grok_proposals_dir(&root, &projects)
        .ok_or_else(|| "未定位到 a8-devtools 仓库根目录，无法访问 logs/grok-proposals".to_string())
}

pub(crate) fn read_proposal_in_dir(proposals_dir: &Path, file_name: &str) -> Result<String, String> {
    let target = resolve_safe_proposal_file(proposals_dir, file_name)?;
    std::fs::read_to_string(&target).map_err(|e| format!("读取提案失败: {}", e))
}

pub(crate) fn delete_proposal_in_dir(proposals_dir: &Path, file_name: &str) -> Result<(), String> {
    let target = resolve_safe_proposal_file(proposals_dir, file_name)?;
    std::fs::remove_file(&target).map_err(|e| format!("删除提案失败: {}", e))
}

fn unix_secs_to_ymd_cn(unix_secs: u64) -> String {
    // Shift UTC seconds to Asia/Shanghai (+08:00) for local day alignment
    let days = ((unix_secs + 8 * 3600) / 86400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

fn locate_harness_metrics_path() -> Option<PathBuf> {
    if let Ok(pd) = std::env::var("PLUGIN_DATA") {
        let trimmed = pd.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed).join("harness_metrics.jsonl"));
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    Some(
        home.join(".gemini")
            .join("antigravity")
            .join("plugin_data")
            .join("a8-agent-mind")
            .join("harness_metrics.jsonl"),
    )
}

fn parse_string_array_field(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn bump_checker_stat(
    map: &mut std::collections::HashMap<String, CheckerHitStats>,
    id: &str,
    ts: u64,
    is_hit: bool,
) {
    let entry = map.entry(id.to_string()).or_default();
    if is_hit {
        entry.hit_count = entry.hit_count.saturating_add(1);
        entry.last_hit_ts = entry.last_hit_ts.max(ts);
    } else {
        entry.eval_count = entry.eval_count.saturating_add(1);
        entry.last_eval_ts = entry.last_eval_ts.max(ts);
    }
}

fn bump_repo_checker_stat(
    map: &mut std::collections::HashMap<(String, String), CheckerHitStats>,
    repo_lower: &str,
    id: &str,
    ts: u64,
    is_hit: bool,
) {
    let entry = map
        .entry((repo_lower.to_string(), id.to_string()))
        .or_default();
    if is_hit {
        entry.hit_count = entry.hit_count.saturating_add(1);
        entry.last_hit_ts = entry.last_hit_ts.max(ts);
    } else {
        entry.eval_count = entry.eval_count.saturating_add(1);
        entry.last_eval_ts = entry.last_eval_ts.max(ts);
    }
}

pub(crate) fn parse_harness_telemetry_with_stats(
    metrics_path: Option<&Path>,
    threshold: f64,
    now_secs: u64,
) -> (HarnessTelemetryDto, CheckerStatsIndex) {
    let mut events: Vec<HarnessMetricEventDto> = Vec::new();
    let display_path = metrics_path.map(clean_display_path).unwrap_or_default();

    if let Some(fp) = metrics_path {
        if fp.is_file() {
            if let Ok(raw) = std::fs::read_to_string(fp) {
                for line in raw.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    let ts = v.get("ts").and_then(|x| x.as_u64()).unwrap_or(0);
                    let date = v
                        .get("date")
                        .and_then(|x| x.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| {
                            if ts > 0 {
                                unix_secs_to_ymd_cn(ts)
                            } else {
                                String::new()
                            }
                        });
                    events.push(HarnessMetricEventDto {
                        ts,
                        date,
                        source: v
                            .get("source")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        mode: v
                            .get("mode")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        repo: v
                            .get("repo")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        verdict: v
                            .get("verdict")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        confidence: v.get("confidence").and_then(|x| x.as_f64()).unwrap_or(0.0),
                        docs_choice: v
                            .get("docs_choice")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        lesson_choice: v
                            .get("lesson_choice")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        evaluated_ids: parse_string_array_field(&v, "evaluated_ids"),
                        violated_ids: parse_string_array_field(&v, "violated_ids"),
                        tokens_evaluated: v
                            .get("tokens_evaluated")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(0),
                        api_calls_count: v
                            .get("api_calls_count")
                            .and_then(|x| x.as_u64())
                            .and_then(|n| u32::try_from(n).ok())
                            .unwrap_or(0),
                        diff_chunks_count: v
                            .get("diff_chunks_count")
                            .and_then(|x| x.as_u64())
                            .and_then(|n| u32::try_from(n).ok())
                            .unwrap_or(0),
                    });
                }
            }
        }
    }

    let mut day_buckets: std::collections::HashMap<String, (u32, u32, u32, u64, u32)> =
        std::collections::HashMap::new();
    let mut stats_index = CheckerStatsIndex::default();
    let mut stop_hook_events = 0usize;
    let mut judge_events = 0usize;
    let mut docs_gate_triggered = 0usize;
    let mut auto_lint_triggered = 0usize;
    let mut conf_sum = 0.0f64;
    let mut conf_cnt = 0usize;
    let mut total_tokens_evaluated = 0u64;
    let mut judge_token_sum = 0u64;
    let mut judge_token_cnt = 0u64;
    let mut max_judge_tokens = 0u64;
    let mut total_diff_chunks = 0u32;
    let mut total_api_calls = 0u32;

    for ev in &events {
        if ev.source == "stop_hook" {
            stop_hook_events += 1;
        } else if ev.source == "a8_judge" {
            judge_events += 1;
        }
        if ev.mode.contains("DOCS_MAINTENANCE") {
            docs_gate_triggered += 1;
        }
        if ev.mode.contains("AUTO_LINT") || ev.mode.contains("AUTO_DECISION") {
            auto_lint_triggered += 1;
        }
        if ev.confidence > 0.0 {
            conf_sum += ev.confidence;
            conf_cnt += 1;
        }
        total_tokens_evaluated = total_tokens_evaluated.saturating_add(ev.tokens_evaluated);
        total_diff_chunks = total_diff_chunks.saturating_add(ev.diff_chunks_count);
        total_api_calls = total_api_calls.saturating_add(ev.api_calls_count);
        if ev.source == "a8_judge" && ev.tokens_evaluated > 0 {
            judge_token_sum = judge_token_sum.saturating_add(ev.tokens_evaluated);
            judge_token_cnt += 1;
            if ev.tokens_evaluated > max_judge_tokens {
                max_judge_tokens = ev.tokens_evaluated;
            }
        }

        let repo_lower = ev.repo.to_lowercase();
        if ev.source == "a8_judge" {
            for id in &ev.evaluated_ids {
                bump_checker_stat(&mut stats_index.decision_global, id, ev.ts, false);
                if !repo_lower.is_empty() {
                    bump_repo_checker_stat(
                        &mut stats_index.decision_by_repo,
                        &repo_lower,
                        id,
                        ev.ts,
                        false,
                    );
                }
            }
            for id in &ev.violated_ids {
                bump_checker_stat(&mut stats_index.decision_global, id, ev.ts, true);
                if !repo_lower.is_empty() {
                    bump_repo_checker_stat(
                        &mut stats_index.decision_by_repo,
                        &repo_lower,
                        id,
                        ev.ts,
                        true,
                    );
                }
            }
        } else if ev.source == "repo_lint" {
            for id in &ev.evaluated_ids {
                let up = id.to_ascii_uppercase();
                bump_checker_stat(&mut stats_index.lint_global, &up, ev.ts, false);
                if !repo_lower.is_empty() {
                    bump_repo_checker_stat(
                        &mut stats_index.lint_by_repo,
                        &repo_lower,
                        &up,
                        ev.ts,
                        false,
                    );
                }
            }
            for id in &ev.violated_ids {
                let up = id.to_ascii_uppercase();
                bump_checker_stat(&mut stats_index.lint_global, &up, ev.ts, true);
                if !repo_lower.is_empty() {
                    bump_repo_checker_stat(
                        &mut stats_index.lint_by_repo,
                        &repo_lower,
                        &up,
                        ev.ts,
                        true,
                    );
                }
            }
        }

        if !ev.date.is_empty() {
            let entry = day_buckets.entry(ev.date.clone()).or_insert((0, 0, 0, 0, 0));
            let is_err_or_violated = matches!(
                ev.verdict.as_str(),
                "VIOLATED" | "REQUIRES_APPROVAL" | "ERROR"
            ) || ev.mode.contains("API_ERROR")
                || ev.mode.contains("SCHEMA_ERROR");
            if is_err_or_violated {
                entry.2 += 1;
            } else if ev.source == "stop_hook" && ev.verdict == "continue" {
                entry.1 += 1;
            } else {
                entry.0 += 1;
            }
            entry.3 = entry.3.saturating_add(ev.tokens_evaluated);
            entry.4 = entry.4.saturating_add(ev.diff_chunks_count);
        }
    }

    let mut daily_trends = Vec::with_capacity(14);
    for offset in (0..14u64).rev() {
        let day_secs = now_secs.saturating_sub(offset * 86400);
        let ymd = unix_secs_to_ymd_cn(day_secs);
        let (allow_or_pass, hook_woke, violated_or_error, tokens_evaluated, diff_chunks_count) =
            day_buckets.get(&ymd).copied().unwrap_or((0, 0, 0, 0, 0));
        daily_trends.push(DailyHarnessTrendDto {
            date: ymd,
            allow_or_pass,
            hook_woke,
            violated_or_error,
            tokens_evaluated,
            diff_chunks_count,
        });
    }

    events.sort_by(|a, b| b.ts.cmp(&a.ts));
    events.truncate(60);

    let dto = HarnessTelemetryDto {
        metrics_path: display_path,
        total_events: events.len(),
        stop_hook_events,
        judge_events,
        docs_gate_triggered,
        auto_lint_triggered,
        avg_confidence: if conf_cnt > 0 {
            (conf_sum / conf_cnt as f64 * 10000.0).round() / 10000.0
        } else {
            0.0
        },
        threshold,
        total_tokens_evaluated,
        avg_judge_tokens: if judge_token_cnt > 0 {
            judge_token_sum / judge_token_cnt
        } else {
            0
        },
        max_judge_tokens,
        total_diff_chunks,
        total_api_calls,
        daily_trends,
        recent_events: events,
    };
    (dto, stats_index)
}

#[allow(dead_code)]
pub(crate) fn parse_harness_telemetry_at(
    metrics_path: Option<&Path>,
    threshold: f64,
    now_secs: u64,
) -> HarnessTelemetryDto {
    parse_harness_telemetry_with_stats(metrics_path, threshold, now_secs).0
}

pub(crate) fn update_proposal_status_in_dir(
    proposals_dir: &Path,
    file_name: &str,
    next_status: &str,
) -> Result<GrokProposalRecordDto, String> {
    let normalized = next_status.trim().to_ascii_lowercase();
    if !matches!(
        normalized.as_str(),
        "pending" | "in_progress" | "adopted" | "dismissed"
    ) {
        return Err(format!("非法提案状态: {}", next_status));
    }
    let target = resolve_safe_proposal_file(proposals_dir, file_name)?;
    let raw = std::fs::read_to_string(&target).map_err(|e| format!("读取提案失败: {}", e))?;
    let eol = if raw.contains("\r\n") { "\r\n" } else { "\n" };
    let clean = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);
    let updated = if clean.starts_with("---\n") || clean.starts_with("---\r\n") {
        let split_marker = if clean.starts_with("---\r\n") {
            "---\r\n"
        } else {
            "---\n"
        };
        let rest = &clean[split_marker.len()..];
        if let Some(end_idx) = rest.find(&format!("{}---", eol)) {
            let fm_block = &rest[..end_idx];
            let tail = &rest[end_idx..];
            let mut found_status = false;
            let mut new_lines: Vec<String> = fm_block
                .lines()
                .map(|line| {
                    if line.trim_start().starts_with("status:") {
                        found_status = true;
                        format!("status: {}", normalized)
                    } else {
                        line.to_string()
                    }
                })
                .collect();
            if !found_status {
                new_lines.push(format!("status: {}", normalized));
            }
            format!("{}{}{}{}", split_marker, new_lines.join(eol), eol, &tail[eol.len()..])
        } else {
            format!("---{}status: {}{}---{}{}", eol, normalized, eol, eol, clean)
        }
    } else {
        format!("---{}status: {}{}---{}{}{}", eol, normalized, eol, eol, eol, clean)
    };
    std::fs::write(&target, updated).map_err(|e| format!("写入提案状态失败: {}", e))?;

    let list = parse_grok_proposals_dir(proposals_dir);
    let canon = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_name);
    list.into_iter()
        .find(|p| p.file_name.eq_ignore_ascii_case(canon))
        .ok_or_else(|| "更新后未读取到提案记录".to_string())
}

#[tauri::command]
pub fn update_grok_proposal_status(
    file_name: String,
    status: String,
) -> Result<GrokProposalRecordDto, String> {
    let dir = locate_proposals_dir()?;
    update_proposal_status_in_dir(&dir, &file_name, &status)
}

#[tauri::command]
pub fn read_grok_proposal(file_name: String) -> Result<String, String> {
    let dir = locate_proposals_dir()?;
    read_proposal_in_dir(&dir, &file_name)
}

#[tauri::command]
pub fn delete_grok_proposal(file_name: String) -> Result<(), String> {
    let dir = locate_proposals_dir()?;
    delete_proposal_in_dir(&dir, &file_name)
}

#[tauri::command]
pub fn open_grok_proposals_dir() -> Result<(), String> {
    let dir = locate_proposals_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建提案目录失败: {}", e))?;
    }
    crate::open_in_explorer_native(&dir);
    Ok(())
}

fn find_antigravity_agentapi_exe() -> Option<PathBuf> {
    if let Ok(env_exe) = std::env::var("ANTIGRAVITY_AGENTAPI_EXE") {
        let p = PathBuf::from(env_exe.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data)
            .join("Programs")
            .join("Antigravity")
            .join("resources")
            .join("bin")
            .join("language_server.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(windows)]
fn query_active_process_image_name(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return None;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut exit_code = 0u32;
        let still_active = GetExitCodeProcess(handle, &mut exit_code).is_ok() && exit_code == 259;
        let mut name_opt = None;
        if still_active {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            if QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok()
            {
                name_opt = Some(String::from_utf16_lossy(&buf[..len as usize]));
            }
        }
        let _ = CloseHandle(handle);
        name_opt
    }
}

fn process_matches_exe_name(exe_path: &str, expected: &str) -> bool {
    Path::new(exe_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn is_antigravity_hub_live(pid: u32, http_port: u16) -> bool {
    if pid == 0 || http_port == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        let Some(exe_path) = query_active_process_image_name(pid) else {
            return false;
        };
        if !process_matches_exe_name(&exe_path, "language_server.exe") {
            return false;
        }
    }
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], http_port));
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(150)).is_ok()
}

pub(crate) fn discover_ls_from_daemon_dir<F>(
    daemon_dir: &Path,
    is_live: F,
) -> Option<(String, String)>
where
    F: Fn(u32, u16) -> bool,
{
    let entries = std::fs::read_dir(daemon_dir).ok()?;
    let mut candidates: Vec<(i64, u32, u16, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        if !lower.starts_with("hub_") || !lower.ends_with(".json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(val) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let pid = val.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let http_port = val.get("httpPort").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
        let csrf_token = val
            .get("csrfToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if pid == 0 || http_port == 0 || csrf_token.is_empty() {
            continue;
        }
        let modified_ts = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        candidates.push((modified_ts, pid, http_port, csrf_token));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, pid, http_port, csrf_token) in candidates {
        if is_live(pid, http_port) {
            return Some((format!("http://127.0.0.1:{}", http_port), csrf_token));
        }
    }
    None
}

fn discover_antigravity_ls_env() -> Option<(String, String)> {
    if let Ok(addr) = std::env::var("ANTIGRAVITY_LS_ADDRESS") {
        let trimmed = addr.trim().to_string();
        if !trimmed.is_empty() {
            let token = std::env::var("ANTIGRAVITY_CSRF_TOKEN")
                .unwrap_or_default()
                .trim()
                .to_string();
            return Some((trimmed, token));
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let daemon_dir = home.join(".gemini").join("antigravity").join("daemon");
    discover_ls_from_daemon_dir(&daemon_dir, is_antigravity_hub_live)
}

#[cfg(windows)]
fn focus_antigravity_window_native() -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
        ShowWindow, SW_RESTORE,
    };

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let Some(exe_path) = query_active_process_image_name(pid) else {
                return BOOL(1);
            };
            if process_matches_exe_name(&exe_path, "Antigravity.exe") {
                if IsIconic(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                }
                let _ = SetForegroundWindow(hwnd);
                if lparam.0 != 0 {
                    let found_ptr = &mut *(lparam.0 as *mut bool);
                    *found_ptr = true;
                }
                return BOOL(0);
            }
            BOOL(1)
        }
    }

    let mut found = false;
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut found as *mut bool as isize));
    }
    if found {
        return true;
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let app_exe = PathBuf::from(local_app_data)
            .join("Programs")
            .join("Antigravity")
            .join("Antigravity.exe");
        if app_exe.is_file() {
            let _ = open_url_native(&app_exe.to_string_lossy());
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
fn focus_antigravity_window_native() -> bool {
    false
}

pub(crate) fn extract_conversation_id_from_json(raw: &str) -> String {
    let Ok(val) = serde_json::from_str::<Value>(raw.trim()) else {
        return String::new();
    };
    for ptr in [
        "/conversationId",
        "/conversation_id",
        "/response/conversationId",
        "/response/conversation_id",
        "/id",
    ] {
        if let Some(s) = val.pointer(ptr).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return s.trim().to_string();
            }
        }
    }
    String::new()
}

/// 在 Antigravity 中基于指定提案文件创建新会话并唤醒客户端窗口。
#[tauri::command]
pub fn advance_proposal_in_antigravity(
    file_name: String,
    title: Option<String>,
    prompt: Option<String>,
) -> Result<AdvanceProposalResultDto, String> {
    let dir = locate_proposals_dir()?;
    let target = resolve_safe_proposal_file(&dir, &file_name)?;
    let display_path = clean_display_path(&target);
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("proposal");
    let repo_root = dir
        .parent()
        .and_then(|p| p.parent())
        .map(clean_display_path)
        .unwrap_or_else(|| r"E:\a8-devtools".to_string());

    let conv_title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("推进 Grok 提案 ({})", stem));

    let conv_prompt = prompt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            format!(
                "请阅读提案文件 `{}` 以及 `{}\\AGENTS.md`，并与我确认后开始推进实施其中的工作流提升提案（优先推进 P0/P1 项，先给出本次拟落地的改造计划）。",
                display_path, repo_root
            )
        });

    let exe = find_antigravity_agentapi_exe().ok_or_else(|| {
        "未找到 Antigravity language_server.exe，请确认已安装 Antigravity 桌面端".to_string()
    })?;
    let (ls_address, csrf_token) = discover_antigravity_ls_env().ok_or_else(|| {
        "未检测到运行中的 Antigravity Hub 服务（~/.gemini/antigravity/daemon/hub_*.json），请先启动 Antigravity 桌面端后重试".to_string()
    })?;

    let mut cmd = std::process::Command::new(&exe);
    cmd.env("ANTIGRAVITY_LS_ADDRESS", &ls_address);
    if !csrf_token.is_empty() {
        cmd.env("ANTIGRAVITY_CSRF_TOKEN", &csrf_token);
    }
    cmd.args([
        "agentapi",
        "new-conversation",
        "--title",
        &conv_title,
        &conv_prompt,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("调用 Antigravity agentapi 失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("创建 Antigravity 会话失败: {}", detail));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let conversation_id = extract_conversation_id_from_json(&stdout);
    let focused_antigravity = focus_antigravity_window_native();
    if let Ok(raw) = std::fs::read_to_string(&target) {
        let (fm, _) = parse_review_frontmatter(&raw);
        let cur_status = fm.get("status").map(|s| s.trim()).unwrap_or("");
        if cur_status.is_empty() || cur_status.eq_ignore_ascii_case("pending") {
            let _ = update_proposal_status_in_dir(&dir, &file_name, "in_progress");
        }
    }

    Ok(AdvanceProposalResultDto {
        conversation_id,
        focused_antigravity,
        method: "agentapi".to_string(),
    })
}

fn resolve_registered_repo_root(plugin_root: &Path, repo_code: &str) -> Result<PathBuf, String> {
    let clean_code = repo_code.trim();
    if clean_code.is_empty() {
        return Err("缺少目标仓库代号 repo_code".to_string());
    }
    let projects = parse_projects_index(plugin_root);
    let proj = projects
        .into_iter()
        .find(|p| p.code.eq_ignore_ascii_case(clean_code))
        .ok_or_else(|| format!("未在仓库地图找到项目: {}", clean_code))?;
    let repo_root = PathBuf::from(proj.physical_path.trim());
    if !repo_root.is_dir() {
        return Err(format!("项目目录不存在: {}", clean_display_path(&repo_root)));
    }
    Ok(repo_root)
}

fn run_git_output(repo_root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C")
        .arg(repo_root)
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.output()
        .map_err(|e| format!("执行 git 命令失败（请确认已安装 git 并加入 PATH）: {}", e))
}

fn run_git_text(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git_output(repo_root, args)?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {:?} 退出码 {:?}", args, out.status.code())
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

const MAX_DIFF_FILE_BYTES: usize = 300 * 1024;
const MAX_UNTRACKED_BYTES: usize = 256 * 1024;
const MAX_UNTRACKED_LINES: usize = 2500;

fn truncate_utf8_on_line(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let slice = &text[..end];
    let cut = slice.rfind('\n').map(|idx| idx + 1).unwrap_or(end);
    (text[..cut].to_string(), true)
}

fn strip_ab_prefix(raw: &str) -> String {
    let trimmed = raw.trim();
    let unquoted = if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    unquoted
        .strip_prefix("a/")
        .or_else(|| unquoted.strip_prefix("b/"))
        .unwrap_or(unquoted)
        .to_string()
}

fn parse_diff_git_header_paths(header_line: &str) -> (String, String) {
    let rest = header_line.strip_prefix("diff --git ").unwrap_or("").trim();
    if let Some(pos) = rest.find(" b/") {
        let left = strip_ab_prefix(&rest[..pos]);
        let right = strip_ab_prefix(&rest[pos + 1..]);
        return (left, right);
    }
    let parts: Vec<&str> = rest.split_whitespace().collect();
    if parts.len() >= 2 {
        return (strip_ab_prefix(parts[0]), strip_ab_prefix(parts[1]));
    }
    (String::new(), String::new())
}

fn parse_git_diff_blocks(raw: &str) -> Vec<GitDiffFileDto> {
    let normalized = raw.replace("\r\n", "\n");
    if normalized.trim().is_empty() {
        return Vec::new();
    }

    let mut blocks: Vec<&str> = Vec::new();
    let mut start_idx: Option<usize> = None;
    let mut offset = 0usize;
    for line in normalized.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            if let Some(prev) = start_idx {
                blocks.push(&normalized[prev..offset]);
            }
            start_idx = Some(offset);
        }
        offset += line.len();
    }
    if let Some(prev) = start_idx {
        blocks.push(&normalized[prev..]);
    }

    let mut files = Vec::with_capacity(blocks.len());
    for block in blocks {
        let trimmed_block = block.trim_end_matches('\n');
        let mut lines = trimmed_block.lines();
        let Some(first_line) = lines.next() else {
            continue;
        };
        let (hdr_old, hdr_new) = parse_diff_git_header_paths(first_line);

        let mut status = "M".to_string();
        let mut old_path = String::new();
        let mut new_path = hdr_new.clone();
        let mut rename_from = String::new();
        let mut rename_to = String::new();
        let mut is_binary = false;
        let mut in_hunk = false;
        let mut additions: u32 = 0;
        let mut deletions: u32 = 0;

        for line in lines {
            if !in_hunk {
                if line.starts_with("new file mode ") {
                    status = "A".to_string();
                    continue;
                }
                if line.starts_with("deleted file mode ") {
                    status = "D".to_string();
                    continue;
                }
                if let Some(rf) = line.strip_prefix("rename from ") {
                    status = "R".to_string();
                    rename_from = rf.trim().to_string();
                    continue;
                }
                if let Some(rt) = line.strip_prefix("rename to ") {
                    status = "R".to_string();
                    rename_to = rt.trim().to_string();
                    continue;
                }
                if line.starts_with("Binary files ") || line == "GIT binary patch" {
                    is_binary = true;
                    continue;
                }
                if let Some(minus_path) = line.strip_prefix("--- ") {
                    let p = minus_path.trim();
                    if p != "/dev/null" {
                        old_path = strip_ab_prefix(p);
                    }
                    continue;
                }
                if let Some(plus_path) = line.strip_prefix("+++ ") {
                    let p = plus_path.trim();
                    if p != "/dev/null" {
                        new_path = strip_ab_prefix(p);
                    }
                    continue;
                }
                if line.starts_with("@@ ") {
                    in_hunk = true;
                    continue;
                }
            } else if line.starts_with("@@ ") {
                continue;
            } else if line.starts_with('+') && !line.starts_with("+++ ") {
                additions += 1;
            } else if line.starts_with('-') && !line.starts_with("--- ") {
                deletions += 1;
            }
        }

        let display_path = if !rename_to.is_empty() {
            rename_to
        } else if status == "D" {
            if !old_path.is_empty() { old_path.clone() } else { hdr_old.clone() }
        } else if !new_path.is_empty() {
            new_path
        } else {
            hdr_old.clone()
        };

        let display_old = if status == "R" {
            if !rename_from.is_empty() { rename_from } else { hdr_old }
        } else {
            String::new()
        };

        let (capped_text, truncated) = truncate_utf8_on_line(trimmed_block, MAX_DIFF_FILE_BYTES);
        files.push(GitDiffFileDto {
            path: display_path,
            old_path: display_old,
            status,
            additions,
            deletions,
            is_binary,
            truncated,
            diff_text: if is_binary { String::new() } else { capped_text },
        });
    }

    files
}

fn build_untracked_file_diff(repo_root: &Path, rel_path: &str) -> GitDiffFileDto {
    let clean_rel = rel_path.trim().replace('\\', "/");
    let full = repo_root.join(&clean_rel);
    let Ok(bytes) = std::fs::read(&full) else {
        return GitDiffFileDto {
            path: clean_rel,
            old_path: String::new(),
            status: "U".to_string(),
            additions: 0,
            deletions: 0,
            is_binary: true,
            truncated: false,
            diff_text: String::new(),
        };
    };

    let probe_len = bytes.len().min(8192);
    if bytes[..probe_len].contains(&0) {
        return GitDiffFileDto {
            path: clean_rel,
            old_path: String::new(),
            status: "U".to_string(),
            additions: 0,
            deletions: 0,
            is_binary: true,
            truncated: false,
            diff_text: String::new(),
        };
    }

    let full_text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    let (byte_capped, byte_truncated) = truncate_utf8_on_line(&full_text, MAX_UNTRACKED_BYTES);
    let mut lines: Vec<&str> = byte_capped.split('\n').collect();
    if byte_capped.ends_with('\n') && lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let line_truncated = lines.len() > MAX_UNTRACKED_LINES;
    if line_truncated {
        lines.truncate(MAX_UNTRACKED_LINES);
    }

    let line_count = lines.len();
    let mut diff = String::with_capacity(byte_capped.len() + 256);
    diff.push_str(&format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n",
        clean_rel
    ));
    if line_count > 0 {
        diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
        for ln in &lines {
            diff.push('+');
            diff.push_str(ln);
            diff.push('\n');
        }
    }

    GitDiffFileDto {
        path: clean_rel,
        old_path: String::new(),
        status: "U".to_string(),
        additions: line_count as u32,
        deletions: 0,
        is_binary: false,
        truncated: byte_truncated || line_truncated,
        diff_text: diff.trim_end_matches('\n').to_string(),
    }
}

/// 获取指定已登记仓库的 Git Diff（供提交前人工代码审核）。
#[tauri::command]
pub fn get_repo_git_diff(repo_code: String, scope: Option<String>) -> Result<GitReviewDiffDto, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let repo_root = resolve_registered_repo_root(&plugin_root, &repo_code)?;

    let inside = run_git_text(&repo_root, &["rev-parse", "--is-inside-work-tree"])?;
    if inside.trim() != "true" {
        return Err(format!("目录不是有效的 Git 仓库: {}", clean_display_path(&repo_root)));
    }

    let norm_scope = match scope.as_deref().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("staged") => "staged",
        Some("unstaged") => "unstaged",
        _ => "all",
    };

    let has_head = run_git_output(&repo_root, &["rev-parse", "--verify", "HEAD"])
        .map(|o| o.status.success())
        .unwrap_or(false);

    let branch = if has_head {
        run_git_text(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "HEAD".to_string())
    } else {
        "HEAD (尚无提交)".to_string()
    };

    let head_summary = if has_head {
        run_git_text(&repo_root, &["log", "-1", "--pretty=%h %s"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let mut files = match norm_scope {
        "staged" => {
            let raw = run_git_text(
                &repo_root,
                &["diff", "--no-color", "--unified=3", "--find-renames", "--cached"],
            )?;
            parse_git_diff_blocks(&raw)
        }
        "unstaged" => {
            let raw = run_git_text(&repo_root, &["diff", "--no-color", "--unified=3", "--find-renames"])?;
            parse_git_diff_blocks(&raw)
        }
        _ => {
            if has_head {
                let raw = run_git_text(
                    &repo_root,
                    &["diff", "--no-color", "--unified=3", "--find-renames", "HEAD"],
                )?;
                parse_git_diff_blocks(&raw)
            } else {
                let staged = run_git_text(
                    &repo_root,
                    &["diff", "--no-color", "--unified=3", "--find-renames", "--cached"],
                )?;
                let unstaged = run_git_text(
                    &repo_root,
                    &["diff", "--no-color", "--unified=3", "--find-renames"],
                )?;
                let mut combined = parse_git_diff_blocks(&staged);
                combined.extend(parse_git_diff_blocks(&unstaged));
                combined
            }
        }
    };

    if norm_scope != "staged" {
        let untracked_raw = run_git_text(&repo_root, &["ls-files", "--others", "--exclude-standard"])?;
        let mut seen: std::collections::HashSet<String> =
            files.iter().map(|f| f.path.to_lowercase()).collect();
        for rel in untracked_raw.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            let key = rel.replace('\\', "/").to_lowercase();
            if seen.insert(key) {
                files.push(build_untracked_file_diff(&repo_root, rel));
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    let total_additions = files.iter().map(|f| f.additions).sum();
    let total_deletions = files.iter().map(|f| f.deletions).sum();

    Ok(GitReviewDiffDto {
        repo_code: repo_code.trim().to_string(),
        repo_path: clean_display_path(&repo_root),
        branch,
        head_summary,
        scope: norm_scope.to_string(),
        has_head,
        total_additions,
        total_deletions,
        files,
    })
}

/// 运行指定仓库下的 scripts/lints/ 机械检查并记录命中统计到 harness_metrics.jsonl。
#[tauri::command]
pub fn run_repo_lints(repo_code: String) -> Result<Value, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let repo_root = resolve_registered_repo_root(&plugin_root, &repo_code)?;
    let runner = plugin_root.join("scripts").join("run_repo_lints.py");
    if !runner.is_file() {
        return Err(format!("缺失插件 Lint 运行器: {}", clean_display_path(&runner)));
    }

    let (exe, prefix_args): (&str, Vec<&str>) = if cfg!(windows) {
        ("py", vec!["-3"])
    } else {
        ("python3", vec![])
    };
    let mut cmd = std::process::Command::new(exe);
    cmd.args(&prefix_args).arg(&runner).arg(&repo_root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .or_else(|_| {
            let mut fallback = std::process::Command::new("python");
            fallback.arg(&runner).arg(&repo_root);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                fallback.creation_flags(0x08000000);
            }
            fallback.output()
        })
        .map_err(|e| format!("启动 Python Lint 运行器失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stdout.is_empty() {
        return Err(if stderr.is_empty() {
            "Lint 运行器未输出有效结果".to_string()
        } else {
            stderr
        });
    }
    serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("解析 Lint 运行结果失败: {} ({})", e, stdout))
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
            std::fs::write(dir.join("plugin.json"), r#"{"name":"a8-agent-mind"}"#).unwrap();
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
        assert!(!is_allowed_writable_rel_path("skills/a8-judge/SKILL.md"));
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

    #[test]
    fn test_parse_and_manage_grok_proposals() {
        let tmp = TempPluginDir::new();
        let proposals_dir = tmp.0.join("logs").join("grok-proposals");
        std::fs::create_dir_all(&proposals_dir).unwrap();

        let p1 = "---\n\
date: 2026-11-14\n\
title: 昨日 AI 工作流提案\n\
source_subject: Grok Daily AI Digest\n\
source_date: 2026-11-14 14:30\n\
proposal_count: 2\n\
status: adopted\n\
summary: 建议增强 Stop Hook 上下文压缩\n\
---\n\n\
# 昨日 AI 工作流提案\n";

        let p2 = "# 今日 Grok AI 工作流提升\n\n第一段摘要说明。\n\n### 提案 1：规则增量校验\n内容 A\n\n### 提案 2：Sidecar 会话直达\n内容 B\n";

        std::fs::write(proposals_dir.join("2026-11-14.md"), p1).unwrap();
        std::fs::write(proposals_dir.join("2026-11-15.md"), p2).unwrap();

        let list = parse_grok_proposals_dir(&proposals_dir);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].file_name, "2026-11-15.md");
        assert_eq!(list[0].date, "2026-11-15");
        assert_eq!(list[0].title, "今日 Grok AI 工作流提升");
        assert_eq!(list[0].proposal_count, 2);
        assert_eq!(list[0].status, "pending");
        assert_eq!(list[1].file_name, "2026-11-14.md");
        assert_eq!(list[1].status, "adopted");

        assert!(read_proposal_in_dir(&proposals_dir, "../config.json").is_err());
        assert!(read_proposal_in_dir(&proposals_dir, "2026-11-15.txt").is_err());
        let body = read_proposal_in_dir(&proposals_dir, "2026-11-15.md").unwrap();
        assert!(body.contains("规则增量校验"));

        delete_proposal_in_dir(&proposals_dir, "2026-11-14.md").unwrap();
        assert!(!proposals_dir.join("2026-11-14.md").exists());

        assert_eq!(
            extract_conversation_id_from_json(r#"{"conversationId":"conv-123"}"#),
            "conv-123"
        );
        assert_eq!(
            extract_conversation_id_from_json(r#"{"response":{"conversation_id":"conv-456"}}"#),
            "conv-456"
        );
    }

    #[test]
    fn test_scan_governance_assets_and_scope_guards() {
        let tmp = TempPluginDir::new();
        std::fs::create_dir_all(tmp.0.join("decisions")).unwrap();
        std::fs::write(
            tmp.0.join("rules").join("mind-rules.md"),
            "# 总则\n\n- **规则一**：测试条款。\n- **规则二**：另一条款。\n",
        )
        .unwrap();
        std::fs::write(
            tmp.0.join("decisions").join("lifecycle_and_evolution.decision.json"),
            r#"{"id":"lifecycle_and_evolution","name":"演化契约","category":"lifecycle_and_evolution","enabled":true,"triggers":["fallback"],"file_patterns":[],"question":{"type":"choice","instructions":"check compat","criteria":{"passed":"clean","violated":"compat"}},"why":"core"}"#,
        )
        .unwrap();

        let project_repo = tmp.0.join("sample-repo");
        let testbed_repo = tmp.0.join("sample-testbed");
        std::fs::create_dir_all(project_repo.join(".agents").join("rules")).unwrap();
        std::fs::create_dir_all(project_repo.join("scripts").join("lints")).unwrap();
        std::fs::create_dir_all(&testbed_repo).unwrap();

        std::fs::write(
            project_repo.join(".agents").join("rules").join("redline.md"),
            "# 项目红线\n\n- **类型一致**：禁止退化。\n",
        )
        .unwrap();
        std::fs::write(
            project_repo.join("scripts").join("lints").join("white_label.decision.json"),
            r#"{"id":"white_label","name":"白标隔离","category":"topology_and_boundaries","enabled":true,"triggers":["DuckDB"],"file_patterns":["modules/ui/"],"question":{"type":"choice","instructions":"check white label","criteria":{"passed":"ok","violated":"leak"}},"why":"spec"}"#,
        )
        .unwrap();
        std::fs::write(
            project_repo.join("scripts").join("lints").join("run_lints.py"),
            "def check_client_sdk_isolation():\n    \"\"\"检查客户端驱动依赖隔离\"\"\"\n    return []\n",
        )
        .unwrap();

        let repos_md = format!(
            "| 仓库代号 | 物理绝对路径 | 生态位 | 定位 | 下钻 |\n| :--- | :--- | :--- | :--- | :--- |\n| **sample-repo** | `{}` | `core` | 项目 | [repos/a.md](repos/a.md) |\n| **sample-testbed** | `{}` | `test-bed` | 靶场 | [repos/b.md](repos/b.md) |\n",
            project_repo.display(),
            testbed_repo.display()
        );
        std::fs::write(tmp.0.join("repos.md"), repos_md).unwrap();

        std::fs::create_dir_all(project_repo.join(".git")).unwrap();
        let projects = parse_projects_index(&tmp.0);
        assert!(projects.iter().any(|p| p.code == "sample-repo" && p.has_git));
        assert!(projects.iter().any(|p| p.code == "sample-testbed" && !p.has_git));
        let empty_stats = CheckerStatsIndex::default();
        let (rules, decisions, lints, summary) = scan_governance_assets(&tmp.0, &projects, &empty_stats);
        assert_eq!(summary.rule_files_count, 3); // mind-rules.md, custom.md, sample-repo/redline.md
        assert_eq!(summary.rule_clauses_count, 3);
        assert!(summary.global_rule_tokens > 0);
        assert!(summary.project_rule_tokens > 0);
        assert_eq!(
            summary.rule_total_tokens,
            summary.global_rule_tokens + summary.project_rule_tokens
        );
        assert_eq!(summary.decisions_count, 2);
        assert_eq!(summary.global_decisions_count, 1);
        assert_eq!(summary.project_decisions_count, 1);
        assert_eq!(summary.lints_count, 1);
        assert_eq!(lints[0].id, "CLIENT_SDK_ISOLATION");
        assert_eq!(decisions[1].repo, "sample-repo");
        assert!(rules.iter().any(|r| r.repo == "sample-repo" && r.clause_count == 1));

        // 保护与越界检查
        assert!(is_protected_rel_path("decisions/LIFECYCLE_AND_EVOLUTION.DECISION.JSON"));
        assert!(is_allowed_writable_rel_path("decisions/custom.decision.json"));
        assert!(is_allowed_repo_governance_rel("scripts/lints/run_lints.py", false));
        assert!(!is_allowed_repo_governance_rel("scripts/lints/run_lints.py", true));
        assert!(is_allowed_repo_governance_rel("scripts/lints/x.decision.json", true));
        assert!(is_allowed_repo_governance_rel("README.md", false));
        assert!(!is_allowed_repo_governance_rel("README.md", true));
        assert!(is_allowed_repo_governance_rel("docs/evergreen/core.md", false));
        assert!(!is_allowed_repo_governance_rel("docs/evergreen/core.md", true));
        assert!(resolve_target_scope(&tmp.0, Some("sample-testbed"), true).is_err());
        assert!(resolve_target_scope(&tmp.0, Some("sample-repo"), true).is_ok());

        // 仓库 README 与治理文档分类扫描
        std::fs::write(project_repo.join("README.md"), "# Sample Repo\n").unwrap();
        let reparsed_projects = parse_projects_index(&tmp.0);
        let sample_card = reparsed_projects.iter().find(|p| p.code == "sample-repo").unwrap();
        assert_eq!(sample_card.readme_rel_path, "README.md");
        std::fs::create_dir_all(project_repo.join("docs").join("evergreen")).unwrap();
        std::fs::create_dir_all(project_repo.join("docs").join("records")).unwrap();
        std::fs::create_dir_all(project_repo.join("docs").join("deferred")).unwrap();
        std::fs::write(project_repo.join("docs").join("evergreen").join("core.md"), "# 核心常青\n").unwrap();
        std::fs::write(
            project_repo.join("docs").join("records").join("20261120-ADR-core-test.md"),
            "# ADR：决策记录\n- **状态**：已落地（当时有效）\n",
        )
        .unwrap();
        std::fs::write(
            project_repo.join("docs").join("records").join("20261110-SPEC-old-test.md"),
            "# SPEC：旧版方案\n- **状态**：已废弃（被 20261120-ADR-core-test.md 取代）\n",
        )
        .unwrap();
        std::fs::write(
            project_repo.join("docs").join("deferred").join("20261010-SPEC-prof.md"),
            "# SPEC：暂缓观测\n- **状态**：已暂缓\n",
        )
        .unwrap();
        let scanned_docs = scan_repo_docs(&projects);
        assert!(scanned_docs.iter().any(|d| d.repo == "sample-repo" && d.doc_tier == "evergreen" && d.title == "核心常青"));
        assert!(scanned_docs.iter().any(|d| d.repo == "sample-repo" && d.doc_tier == "record" && d.doc_type == "ADR" && d.date == "2026-11-20" && d.status == "已落地（当时有效）"));
        assert!(scanned_docs.iter().any(|d| d.repo == "sample-repo" && d.doc_tier == "deferred" && d.doc_type == "SPEC" && d.status.starts_with("已废弃")));
        assert!(scanned_docs.iter().any(|d| d.repo == "sample-repo" && d.doc_tier == "deferred" && d.rel_path.ends_with("20261010-SPEC-prof.md") && d.status == "已暂缓"));
    }

    #[test]
    fn test_discover_ls_from_daemon_dir_picks_live_hub() {
        let tmp = TempPluginDir::new();
        std::fs::write(
            tmp.0.join("hub_11111.json"),
            r#"{"pid":1001,"httpPort":11111,"csrfToken":"stale-tok"}"#,
        )
        .unwrap();
        std::fs::write(
            tmp.0.join("hub_22222.json"),
            r#"{"pid":2002,"httpPort":22222,"csrfToken":"live-tok"}"#,
        )
        .unwrap();
        std::fs::write(
            tmp.0.join("other_33333.json"),
            r#"{"pid":3003,"httpPort":33333,"csrfToken":"ignore"}"#,
        )
        .unwrap();

        let res = discover_ls_from_daemon_dir(&tmp.0, |pid, port| pid == 2002 && port == 22222);
        assert_eq!(
            res,
            Some(("http://127.0.0.1:22222".to_string(), "live-tok".to_string()))
        );
        assert_eq!(discover_ls_from_daemon_dir(&tmp.0, |_, _| false), None);
    }

    #[test]
    fn test_parse_harness_telemetry_and_proposal_status() {
        let tmp = TempPluginDir::new();
        let metrics = tmp.0.join("harness_metrics.jsonl");
        let now_secs = 1_794_726_200u64; // 2026-11-15 UTC+8
        let today = unix_secs_to_ymd_cn(now_secs);
        let yest = unix_secs_to_ymd_cn(now_secs - 86400);
        let content = format!(
            "{{\"ts\":{},\"date\":\"{}\",\"source\":\"stop_hook\",\"mode\":\"DOCS_MAINTENANCE\",\"repo\":\"a8-devtools\",\"verdict\":\"continue\",\"confidence\":0.98,\"docs_choice\":\"yes\",\"lesson_choice\":\"no\",\"tokens_evaluated\":1200,\"api_calls_count\":1}}\n\
             {{\"ts\":{},\"date\":\"{}\",\"source\":\"a8_judge\",\"mode\":\"PASSED\",\"repo\":\"a8-devtools\",\"verdict\":\"PASSED\",\"confidence\":0.92,\"docs_choice\":\"\",\"lesson_choice\":\"\",\"tokens_evaluated\":8400,\"api_calls_count\":2,\"diff_chunks_count\":2}}\n\
             {{\"ts\":{},\"date\":\"{}\",\"source\":\"a8_judge\",\"mode\":\"VIOLATED\",\"repo\":\"a8-turbo\",\"verdict\":\"VIOLATED\",\"confidence\":0.81,\"docs_choice\":\"\",\"lesson_choice\":\"\",\"tokens_evaluated\":15600,\"api_calls_count\":3,\"diff_chunks_count\":4}}\n",
            now_secs - 3600,
            yest,
            now_secs - 100,
            today,
            now_secs - 50,
            today
        );
        std::fs::write(&metrics, content).unwrap();

        let tel = parse_harness_telemetry_at(Some(&metrics), 0.85, now_secs);
        assert_eq!(tel.total_events, 3);
        assert_eq!(tel.stop_hook_events, 1);
        assert_eq!(tel.judge_events, 2);
        assert_eq!(tel.docs_gate_triggered, 1);
        assert_eq!(tel.total_tokens_evaluated, 25200);
        assert_eq!(tel.avg_judge_tokens, 12000);
        assert_eq!(tel.max_judge_tokens, 15600);
        assert_eq!(tel.total_diff_chunks, 6);
        assert_eq!(tel.total_api_calls, 6);
        assert_eq!(tel.daily_trends.len(), 14);
        assert_eq!(tel.daily_trends.last().unwrap().date, today);
        assert_eq!(tel.daily_trends.last().unwrap().allow_or_pass, 1);
        assert_eq!(tel.daily_trends.last().unwrap().violated_or_error, 1);
        assert_eq!(tel.daily_trends.last().unwrap().tokens_evaluated, 24000);
        assert_eq!(tel.daily_trends.last().unwrap().diff_chunks_count, 6);
        assert_eq!(tel.recent_events[0].verdict, "VIOLATED");
        assert_eq!(tel.recent_events[0].tokens_evaluated, 15600);
        assert_eq!(tel.recent_events[0].diff_chunks_count, 4);
        assert_eq!(tel.recent_events[0].api_calls_count, 3);

        let pdir = tmp.0.join("grok-proposals");
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(
            pdir.join("2026-11-15.md"),
            "---\ndate: 2026-11-15\ntitle: 测试提案\nstatus: pending\n---\n\n### 提案 1：A\n",
        )
        .unwrap();
        let updated = update_proposal_status_in_dir(&pdir, "2026-11-15.md", "adopted").unwrap();
        assert_eq!(updated.status, "adopted");
        assert!(update_proposal_status_in_dir(&pdir, "2026-11-15.md", "bad").is_err());
    }

    #[test]
    fn test_checker_hit_tracking_and_decision_retirement() {
        let tmp = TempPluginDir::new();
        let metrics = tmp.0.join("harness_metrics.jsonl");
        let now_secs = 1_794_726_200u64;
        let today = unix_secs_to_ymd_cn(now_secs);
        let content = format!(
            "{{\"ts\":{},\"date\":\"{}\",\"source\":\"a8_judge\",\"mode\":\"VIOLATED\",\"repo\":\"sample-repo\",\"verdict\":\"VIOLATED\",\"confidence\":0.95,\"evaluated_ids\":[\"LIFECYCLE_GUARD\",\"OLD_RULE\"],\"violated_ids\":[\"LIFECYCLE_GUARD\"]}}\n\
             {{\"ts\":{},\"date\":\"{}\",\"source\":\"a8_judge\",\"mode\":\"PASSED\",\"repo\":\"sample-repo\",\"verdict\":\"PASSED\",\"confidence\":0.91,\"evaluated_ids\":[\"LIFECYCLE_GUARD\",\"OLD_RULE\"],\"violated_ids\":[]}}\n\
             {{\"ts\":{},\"date\":\"{}\",\"source\":\"repo_lint\",\"mode\":\"VIOLATED\",\"repo\":\"sample-repo\",\"verdict\":\"VIOLATED\",\"confidence\":1.0,\"evaluated_ids\":[\"CLIENT_SDK_ISOLATION\"],\"violated_ids\":[\"CLIENT_SDK_ISOLATION\"]}}\n",
            now_secs - 200,
            today,
            now_secs - 100,
            today,
            now_secs - 50,
            today
        );
        std::fs::write(&metrics, content).unwrap();

        let (tel, stats) = parse_harness_telemetry_with_stats(Some(&metrics), 0.85, now_secs);
        assert_eq!(tel.total_events, 3);
        assert_eq!(tel.recent_events[0].source, "repo_lint");
        assert_eq!(tel.recent_events[0].violated_ids, vec!["CLIENT_SDK_ISOLATION"]);

        let dec_dir = tmp.0.join("decisions");
        std::fs::create_dir_all(&dec_dir).unwrap();
        std::fs::write(
            dec_dir.join("lifecycle.decision.json"),
            r#"{"id":"LIFECYCLE_GUARD","name":"Lifecycle Guard","enabled":true,"triggers":[],"file_patterns":[],"instructions":"check"}"#,
        )
        .unwrap();
        std::fs::write(
            dec_dir.join("old.decision.json"),
            r#"{"id":"OLD_RULE","name":"Old Rule","enabled":false,"retired_at":"2026-11-15","retired_reason":"看板一键退役","triggers":[],"file_patterns":[],"instructions":"old"}"#,
        )
        .unwrap();

        let mut decisions = Vec::new();
        collect_decision_entries_in_dir(&tmp.0, &dec_dir, "global", "a8-agent-mind", true, &stats, &mut decisions);
        assert_eq!(decisions.len(), 2);
        let life = decisions.iter().find(|d| d.id == "LIFECYCLE_GUARD").unwrap();
        assert_eq!(life.eval_count, 2);
        assert_eq!(life.hit_count, 1);
        assert_eq!(life.last_hit_ts, now_secs - 200);
        let old = decisions.iter().find(|d| d.id == "OLD_RULE").unwrap();
        assert!(!old.enabled);
        assert_eq!(old.retired_at, "2026-11-15");
        assert_eq!(old.retired_reason, "看板一键退役");
        assert_eq!(old.eval_count, 2);
        assert_eq!(old.hit_count, 0);

        let repo_root = tmp.0.join("sample-repo");
        let lints_dir = repo_root.join("scripts").join("lints");
        std::fs::create_dir_all(&lints_dir).unwrap();
        std::fs::write(
            lints_dir.join("run_lints.py"),
            "def check_client_sdk_isolation():\n    \"\"\"禁止客户端引入重型容器\"\"\"\n    pass\n",
        )
        .unwrap();
        let mut lints = Vec::new();
        collect_lint_items_in_dir(&repo_root, &lints_dir, "project", "sample-repo", true, &stats, &mut lints);
        assert_eq!(lints.len(), 1);
        assert_eq!(lints[0].id, "CLIENT_SDK_ISOLATION");
        assert!(!lints[0].deletable); // run_lints.py protected against whole-file delete
        assert_eq!(lints[0].eval_count, 1);
        assert_eq!(lints[0].hit_count, 1);
        assert_eq!(lints[0].last_hit_ts, now_secs - 50);

        // Standalone .py and .mjs lints extract CHECK_ID/[PASS] and support single-check deletion
        std::fs::write(
            lints_dir.join("check_demo.py"),
            "CHECK_ID = \"DEMO_RULE\"\ndef check_demo_impl():\n    \"\"\"演示单独检查\"\"\"\n    return []\n",
        )
        .unwrap();
        std::fs::write(
            lints_dir.join("check_js_guard.mjs"),
            "/**\n * JS 静态防线检查 (JS_GUARD)\n */\nconsole.log('[PASS] JS_GUARD');\n",
        )
        .unwrap();
        let mut lints2 = Vec::new();
        collect_lint_items_in_dir(&repo_root, &lints_dir, "project", "sample-repo", true, &stats, &mut lints2);
        let py_item = lints2.iter().find(|l| l.file_name == "check_demo.py").unwrap();
        assert_eq!(py_item.id, "DEMO_RULE");
        assert!(py_item.deletable);
        let mjs_item = lints2.iter().find(|l| l.file_name == "check_js_guard.mjs").unwrap();
        assert_eq!(mjs_item.id, "JS_GUARD");
        assert!(mjs_item.deletable);
        assert!(validate_repo_delete_target("scripts/lints/check_js_guard.mjs", &lints_dir.join("check_js_guard.mjs")).is_ok());
        assert!(validate_repo_delete_target("scripts/lints/run_lints.py", &lints_dir.join("run_lints.py")).is_err());
    }

    #[test]
    fn test_parse_git_diff_blocks_and_untracked_synthesis() {
        let sample = "\
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/old_name.rs b/new_name.rs
similarity index 90%
rename from old_name.rs
rename to new_name.rs
--- a/old_name.rs
+++ b/new_name.rs
@@ -1 +1 @@
-fn old() {}
+fn renamed() {}
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/dead.txt b/dead.txt
deleted file mode 100644
--- a/dead.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
";
        let parsed = parse_git_diff_blocks(sample);
        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[0].path, "src/app.ts");
        assert_eq!(parsed[0].status, "M");
        assert_eq!(parsed[0].additions, 2);
        assert_eq!(parsed[0].deletions, 1);

        assert_eq!(parsed[1].path, "new_name.rs");
        assert_eq!(parsed[1].old_path, "old_name.rs");
        assert_eq!(parsed[1].status, "R");

        assert_eq!(parsed[2].path, "assets/logo.png");
        assert!(parsed[2].is_binary);

        assert_eq!(parsed[3].path, "dead.txt");
        assert_eq!(parsed[3].status, "D");
        assert_eq!(parsed[3].deletions, 2);

        let tmp = TempPluginDir::new();
        std::fs::write(tmp.0.join("notes.md"), "hello\nworld\n").unwrap();
        let untracked = build_untracked_file_diff(&tmp.0, "notes.md");
        assert_eq!(untracked.status, "U");
        assert_eq!(untracked.additions, 2);
        assert!(!untracked.is_binary);
        assert!(untracked.diff_text.contains("+++ b/notes.md"));
        assert!(untracked.diff_text.contains("+hello"));
    }
}
