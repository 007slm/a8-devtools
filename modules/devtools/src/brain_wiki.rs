use crate::agent_mind::{
    clean_display_path, detect_plugin_location, launch_antigravity_conversation, unix_secs_to_ymd_cn,
    AdvanceProposalResultDto,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BrainBacklinkDto {
    pub rel_path: String,
    pub title: String,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainWikiEntryDto {
    pub rel_path: String,
    pub slug: String,
    pub kind: String, // "page" | "raw" | "meta"
    pub title: String,
    pub category: String,
    pub status: String, // raw: "pending" | "ingested"; page/meta: ""
    pub source: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub sources: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub ingested_at: String,
    pub outbound_links: Vec<String>,
    pub broken_links: Vec<String>,
    pub backlinks: Vec<BrainBacklinkDto>,
    pub size_bytes: u64,
    pub modified_ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct BrainWikiStatsDto {
    pub pages_count: usize,
    pub raw_total: usize,
    pub raw_pending: usize,
    pub raw_ingested: usize,
    pub categories_count: usize,
    pub links_count: usize,
    pub broken_links_count: usize,
    pub orphan_pages_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainWikiOverviewDto {
    pub wiki_dir: String,
    pub default_wiki_dir: String,
    pub is_custom_dir: bool,
    pub stats: BrainWikiStatsDto,
    pub categories: Vec<String>,
    pub meta_files: Vec<BrainWikiEntryDto>,
    pub pages: Vec<BrainWikiEntryDto>,
    pub raw_notes: Vec<BrainWikiEntryDto>,
}

const DEFAULT_SCHEMA_MD: &str = r#"# A8 Brain · LLM Wiki 维护规范 (SCHEMA)

> 本知识库遵循 **LLM Wiki** 分层架构：人类随时记录原始素材（`raw/`），由 Antigravity（`/a8-brain`）负责消化提炼、分类建链维护知识网络（`pages/`、`index.md`、`log.md`），并在头脑风暴时按索引低 Token 精准调取。

## 1. 目录职责

- `SCHEMA.md`：本规范文件（约定分类、Frontmatter、互链与冲突处理）。
- `index.md`：全库按分类组织的导航索引（每条附一句话摘要），是 `/a8-brain` 检索的第一入口。
- `log.md`：追加式操作日志（记录每次整理归档、体检与回写）。
- `raw/`：原始素材收件箱（Twitter 帖子、文章摘录、随手记、链接）。整理后只更新 Frontmatter 中的 `status: ingested` 与 `ingested_at`，**保留原始正文不可变**。
- `pages/`：Antigravity 维护的互链知识页（可扁平存放 `pages/<slug>.md` 或按一级目录存放）。

## 2. Frontmatter 约定

- `raw/*.md`：`title`、`source`、`tags`、`status`（`pending` | `ingested`）、`created_at`、`ingested_at`
- `pages/*.md`：`title`、`category`、`tags`、`summary`、`sources`（指向 `raw/...`）、`updated_at`

## 3. 互链与演进原则

1. 正文统一使用 `[[slug]]` 或 `[[slug|可读名]]` 建立条目双向链接；新建或更新页面时，同步在相关旧页面补齐自然交叉引用。
2. 新旧观点出现冲突时，**严禁静默覆盖旧洞见**，应在条目内显式写出「适用条件分歧 / 观点演进」。
3. 每次整理（Ingest）或体检（Lint）完成后，务必同步更新 `index.md` 并在 `log.md` 追加一条记录。
"#;

const DEFAULT_INDEX_MD: &str = r#"# A8 Brain · 知识大脑总索引

> 每次发起 `/a8-brain` 头脑风暴时，优先读本索引定位 2～5 篇最相关条目，再精读对应 `pages/` 全文。

## Agent 与 Skill 玩法

<!-- 示例：- [[subagent-context-isolation|Subagent 上下文隔离原则]] — 通过隔离上下文降低主会话污染并提升并发效率 -->

## 学习与思考原则

## 架构与工程实践

## 工具与效率

## 待分类
"#;

const DEFAULT_LOG_MD: &str = r#"# A8 Brain · 变更日志

> 追加式记录知识库的整理归档（Ingest）、知识体检（Lint）与头脑风暴沉淀（Compound）。

"#;

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_secs_to_datetime_cn(unix_secs: u64) -> String {
    let ymd = unix_secs_to_ymd_cn(unix_secs);
    let local_secs = unix_secs + 8 * 3600;
    let secs_of_day = local_secs % 86400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    format!("{} {:02}:{:02}", ymd, hour, minute)
}

fn expand_tilde(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            let suffix = trimmed
                .trim_start_matches('~')
                .trim_start_matches(['/', '\\']);
            return if suffix.is_empty() {
                PathBuf::from(home)
            } else {
                PathBuf::from(home).join(suffix)
            };
        }
    }
    PathBuf::from(trimmed)
}

pub(crate) fn resolve_wiki_dir_for_plugin(plugin_root: &Path) -> (PathBuf, PathBuf, bool) {
    let default_dir = plugin_root.join("wiki");
    let cfg_path = plugin_root.join("config.json");
    if let Ok(raw) = std::fs::read_to_string(&cfg_path) {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) {
            if let Some(custom) = map.get("wiki_dir").and_then(|v| v.as_str()) {
                let trimmed = custom.trim();
                if !trimmed.is_empty() {
                    let expanded = expand_tilde(trimmed);
                    let resolved = if expanded.is_absolute() {
                        expanded
                    } else {
                        plugin_root.join(expanded)
                    };
                    return (resolved, default_dir, true);
                }
            }
        }
    }
    (default_dir.clone(), default_dir, false)
}

pub(crate) fn ensure_brain_wiki_scaffold(wiki_root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(wiki_root.join("raw"))
        .map_err(|e| format!("创建知识库 raw/ 目录失败: {}", e))?;
    std::fs::create_dir_all(wiki_root.join("pages"))
        .map_err(|e| format!("创建知识库 pages/ 目录失败: {}", e))?;

    let defaults = [
        ("SCHEMA.md", DEFAULT_SCHEMA_MD),
        ("index.md", DEFAULT_INDEX_MD),
        ("log.md", DEFAULT_LOG_MD),
    ];
    for (name, content) in defaults {
        let target = wiki_root.join(name);
        if !target.exists() {
            write_file_atomic(&target, content)?;
        }
    }
    Ok(())
}

fn write_file_atomic(target: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目标目录失败: {}", e))?;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_name = format!(
        ".{}.tmp.{}.{}",
        target
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("wiki"),
        std::process::id(),
        nanos
    );
    let tmp_path = target.with_file_name(tmp_name);
    std::fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    if let Err(e) = std::fs::rename(&tmp_path, target) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("原子落盘失败: {}", e));
    }
    Ok(())
}

pub(crate) fn normalize_wiki_rel_path(raw: &str) -> Result<String, String> {
    let replaced = raw.trim().replace('\\', "/");
    let trimmed = replaced.trim_start_matches("./");
    if trimmed.is_empty() {
        return Err("相对路径不能为空".to_string());
    }
    if trimmed.contains('\0')
        || trimmed.contains(':')
        || trimmed.starts_with('/')
        || trimmed.starts_with('~')
    {
        return Err(format!("非法知识库路径: {}", raw));
    }

    let mut segments: Vec<&str> = Vec::new();
    for seg in trimmed.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." || seg.starts_with('.') {
            return Err(format!("路径包含非法片段: {}", raw));
        }
        if seg.ends_with('.') || seg.ends_with(' ') {
            return Err(format!("文件名不能以空格或点结尾: {}", raw));
        }
        segments.push(seg);
    }

    if !trimmed.to_ascii_lowercase().ends_with(".md") {
        return Err("知识库仅允许访问 .md 文件".to_string());
    }

    let normalized = segments.join("/");
    let allowed = match segments.as_slice() {
        [single] => matches!(*single, "SCHEMA.md" | "index.md" | "log.md"),
        ["raw", ..] => segments.len() >= 2 && segments.len() <= 3,
        ["pages", ..] => segments.len() >= 2 && segments.len() <= 4,
        _ => false,
    };

    if !allowed {
        return Err(format!(
            "路径越出知识库白名单（仅允许 SCHEMA.md、index.md、log.md、raw/*.md 与 pages/**/*.md）: {}",
            normalized
        ));
    }
    Ok(normalized)
}

pub(crate) fn resolve_safe_wiki_path(
    wiki_root: &Path,
    rel_path: &str,
    must_exist: bool,
) -> Result<(String, PathBuf), String> {
    let normalized = normalize_wiki_rel_path(rel_path)?;
    let canonical_root = std::fs::canonicalize(wiki_root)
        .map_err(|e| format!("无法解析知识库根目录: {}", e))?;

    let mut candidate = canonical_root.clone();
    for part in normalized.split('/') {
        candidate.push(part);
    }

    for comp in candidate.components() {
        if matches!(comp, Component::ParentDir) {
            return Err("路径包含非法上级目录引用".to_string());
        }
    }

    if must_exist {
        if !candidate.is_file() {
            return Err(format!("知识库文件不存在: {}", normalized));
        }
        let canonical_target = std::fs::canonicalize(&candidate)
            .map_err(|e| format!("解析文件路径失败: {}", e))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err("安全拦截：符号链接指向知识库目录之外".to_string());
        }
        return Ok((normalized, canonical_target));
    }

    if let Some(parent) = candidate.parent() {
        if parent.exists() {
            let canonical_parent = std::fs::canonicalize(parent)
                .map_err(|e| format!("解析父目录失败: {}", e))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err("安全拦截：目标父目录越出知识库范围".to_string());
            }
        }
    }
    Ok((normalized, candidate))
}

#[derive(Default, Debug)]
struct ParsedWikiFrontmatter {
    scalars: HashMap<String, String>,
    lists: HashMap<String, Vec<String>>,
}

fn unquote_yaml_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    } else {
        trimmed.to_string()
    }
}

fn parse_inline_yaml_list(raw: &str) -> Vec<String> {
    let inner = raw.trim().trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(unquote_yaml_value)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_wiki_frontmatter(raw: &str) -> (ParsedWikiFrontmatter, String) {
    let normalized = raw.replace("\r\n", "\n");
    let mut fm = ParsedWikiFrontmatter::default();
    if !normalized.starts_with("---\n") {
        return (fm, normalized);
    }

    let rest = &normalized[4..];
    let Some(end_idx) = rest.find("\n---") else {
        return (fm, normalized);
    };
    let yaml_block = &rest[..end_idx];
    let after = &rest[end_idx + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after).to_string();

    let mut active_list_key: Option<String> = None;
    for line in yaml_block.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(ref key) = active_list_key {
                let val = unquote_yaml_value(item);
                if !val.is_empty() {
                    fm.lists.entry(key.clone()).or_default().push(val);
                }
            }
            continue;
        }
        active_list_key = None;
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim();
            if val.is_empty() {
                active_list_key = Some(key);
            } else if val.starts_with('[') && val.ends_with(']') {
                fm.lists.insert(key, parse_inline_yaml_list(val));
            } else {
                fm.scalars.insert(key, unquote_yaml_value(val));
            }
        }
    }
    (fm, body)
}

fn infer_title_and_summary(body: &str, fallback_slug: &str) -> (String, String) {
    let mut heading = String::new();
    let mut summary = String::new();
    let mut in_code = false;

    for line in body.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || t.is_empty() {
            continue;
        }
        if heading.is_empty() {
            if let Some(h) = t.strip_prefix("# ") {
                heading = h.trim().to_string();
                continue;
            }
        }
        if summary.is_empty()
            && !t.starts_with('#')
            && !t.starts_with('>')
            && !t.starts_with("---")
            && !t.starts_with("<!--")
        {
            let clean = t.trim_start_matches(['-', '*', ' ']).trim();
            if !clean.is_empty() {
                summary = clean.chars().take(120).collect();
            }
        }
        if !heading.is_empty() && !summary.is_empty() {
            break;
        }
    }

    if heading.is_empty() {
        heading = fallback_slug.to_string();
    }
    (heading, summary)
}

/// 从 Markdown 正文提取 `[[slug]]` / `[[slug|label]]` 与相对 `.md` 链接，自动跳过代码块与行内代码。
pub(crate) fn extract_wiki_links(markdown: &str) -> Vec<String> {
    let mut links: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut in_fence = false;

    for raw_line in markdown.replace("\r\n", "\n").lines() {
        let trimmed = raw_line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        // Strip inline backtick spans first so code snippets don't produce phantom links
        let mut stripped = String::with_capacity(raw_line.len());
        let mut in_code = false;
        for ch in raw_line.chars() {
            if ch == '`' {
                in_code = !in_code;
                continue;
            }
            if !in_code {
                stripped.push(ch);
            }
        }

        let bytes = stripped.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            // [[target]] or [[target|label]]
            if i + 1 < bytes.len() && bytes[i] == b'[' && bytes[i + 1] == b'[' {
                if let Some(rel_end) = stripped[i + 2..].find("]]") {
                    let inner = &stripped[i + 2..i + 2 + rel_end];
                    let target = inner
                        .split('|')
                        .next()
                        .unwrap_or("")
                        .split('#')
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !target.is_empty() {
                        let key = target.to_ascii_lowercase();
                        if seen.insert(key) {
                            links.push(target.to_string());
                        }
                    }
                    i = i + 2 + rel_end + 2;
                    continue;
                }
            }

            // Standard markdown relative link [label](target.md)
            if bytes[i] == b']' && i + 1 < bytes.len() && bytes[i + 1] == b'(' {
                if let Some(rel_end) = stripped[i + 2..].find(')') {
                    let href = stripped[i + 2..i + 2 + rel_end].trim();
                    let lower = href.to_ascii_lowercase();
                    if !href.is_empty()
                        && !lower.starts_with("http://")
                        && !lower.starts_with("https://")
                        && !lower.starts_with("mailto:")
                        && !lower.starts_with('#')
                    {
                        let clean_href = href.split('#').next().unwrap_or("").trim();
                        if clean_href.to_ascii_lowercase().ends_with(".md") {
                            let key = clean_href.to_ascii_lowercase();
                            if seen.insert(key) {
                                links.push(clean_href.to_string());
                            }
                        }
                    }
                    i = i + 2 + rel_end + 1;
                    continue;
                }
            }

            i += 1;
        }
    }

    links
}

fn collect_md_files_recursive(
    root: &Path,
    current: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<PathBuf>,
) {
    if depth > max_depth || !current.is_dir() {
        return;
    }
    let Ok(rd) = std::fs::read_dir(current) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_md_files_recursive(root, &path, depth + 1, max_depth, out);
        } else if path.is_file() && name.to_ascii_lowercase().ends_with(".md") {
            out.push(path);
        }
    }
}

fn resolve_target_rel_path(
    raw_target: &str,
    from_rel_path: &str,
    by_rel: &HashMap<String, String>,
    by_slug: &HashMap<String, String>,
    by_title: &HashMap<String, String>,
) -> Option<String> {
    let cleaned = raw_target
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if cleaned.is_empty() {
        return None;
    }

    // Handle relative ../ links from pages/ or raw/
    let resolved_rel = if cleaned.starts_with("../") {
        let mut base_parts: Vec<&str> = from_rel_path.split('/').collect();
        base_parts.pop();
        let mut target_parts: Vec<&str> = Vec::new();
        for seg in cleaned.split('/') {
            if seg == ".." {
                base_parts.pop();
            } else if !seg.is_empty() && seg != "." {
                target_parts.push(seg);
            }
        }
        base_parts.extend(target_parts);
        base_parts.join("/")
    } else {
        cleaned.clone()
    };

    let lower = resolved_rel.to_ascii_lowercase();
    let lower_with_md = if lower.ends_with(".md") {
        lower.clone()
    } else {
        format!("{}.md", lower)
    };
    if let Some(hit) = by_rel.get(&lower_with_md) {
        return Some(hit.clone());
    }
    if let Some(hit) = by_rel.get(&format!("pages/{}", lower_with_md)) {
        return Some(hit.clone());
    }
    if let Some(hit) = by_rel.get(&format!("raw/{}", lower_with_md)) {
        return Some(hit.clone());
    }

    let slug_key = lower
        .trim_end_matches(".md")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    if let Some(hit) = by_slug.get(&slug_key) {
        return Some(hit.clone());
    }

    if let Some(hit) = by_title.get(&cleaned.to_ascii_lowercase()) {
        return Some(hit.clone());
    }

    None
}

fn build_entry_from_file(
    wiki_root: &Path,
    abs_path: &Path,
    kind: &str,
) -> Option<(BrainWikiEntryDto, Vec<String>)> {
    let rel = abs_path
        .strip_prefix(wiki_root)
        .map(|p| p.to_path_buf())
        .or_else(|_| {
            let clean_abs = PathBuf::from(clean_display_path(abs_path));
            let clean_root = PathBuf::from(clean_display_path(wiki_root));
            clean_abs
                .strip_prefix(&clean_root)
                .map(|p| p.to_path_buf())
                .map_err(|_| ())
        })
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let slug = abs_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let meta = std::fs::metadata(abs_path).ok()?;
    let size_bytes = meta.len();
    let modified_ts = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let raw_content = std::fs::read_to_string(abs_path).unwrap_or_default();
    let (fm, body) = parse_wiki_frontmatter(&raw_content);
    let (inferred_title, inferred_summary) = infer_title_and_summary(&body, &slug);

    let title = fm
        .scalars
        .get("title")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or(inferred_title);
    let summary = fm
        .scalars
        .get("summary")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or(inferred_summary);
    let category = fm
        .scalars
        .get("category")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| {
            if kind == "page" {
                let parts: Vec<&str> = rel.split('/').collect();
                if parts.len() >= 3 {
                    parts[1].to_string()
                } else {
                    "未分类".to_string()
                }
            } else {
                String::new()
            }
        });
    let status = if kind == "raw" {
        let s = fm
            .scalars
            .get("status")
            .map(|x| x.to_ascii_lowercase())
            .unwrap_or_else(|| "pending".to_string());
        if s == "ingested" {
            "ingested".to_string()
        } else {
            "pending".to_string()
        }
    } else {
        String::new()
    };

    let source = fm.scalars.get("source").cloned().unwrap_or_default();
    let created_at = fm.scalars.get("created_at").cloned().unwrap_or_default();
    let updated_at = fm.scalars.get("updated_at").cloned().unwrap_or_default();
    let ingested_at = fm.scalars.get("ingested_at").cloned().unwrap_or_default();
    let tags = fm.lists.get("tags").cloned().unwrap_or_default();
    let sources = fm.lists.get("sources").cloned().unwrap_or_default();

    let mut extracted = extract_wiki_links(&body);
    for src in &sources {
        let s = src.trim();
        if !s.is_empty() && !extracted.iter().any(|x| x.eq_ignore_ascii_case(s)) {
            extracted.push(s.to_string());
        }
    }

    let dto = BrainWikiEntryDto {
        rel_path: rel,
        slug,
        kind: kind.to_string(),
        title,
        category,
        status,
        source,
        summary,
        tags,
        sources,
        created_at,
        updated_at,
        ingested_at,
        outbound_links: Vec::new(),
        broken_links: Vec::new(),
        backlinks: Vec::new(),
        size_bytes,
        modified_ts,
    };

    Some((dto, extracted))
}

pub(crate) fn scan_brain_wiki_overview(
    wiki_root: &Path,
    default_dir: &Path,
    is_custom_dir: bool,
) -> Result<BrainWikiOverviewDto, String> {
    ensure_brain_wiki_scaffold(wiki_root)?;

    let mut items: Vec<(BrainWikiEntryDto, Vec<String>)> = Vec::new();

    for meta_name in ["index.md", "log.md", "SCHEMA.md"] {
        let p = wiki_root.join(meta_name);
        if p.is_file() {
            if let Some(entry) = build_entry_from_file(wiki_root, &p, "meta") {
                items.push(entry);
            }
        }
    }

    let mut page_files = Vec::new();
    collect_md_files_recursive(wiki_root, &wiki_root.join("pages"), 0, 3, &mut page_files);
    for p in page_files {
        if let Some(entry) = build_entry_from_file(wiki_root, &p, "page") {
            items.push(entry);
        }
    }

    let mut raw_files = Vec::new();
    collect_md_files_recursive(wiki_root, &wiki_root.join("raw"), 0, 2, &mut raw_files);
    for p in raw_files {
        if let Some(entry) = build_entry_from_file(wiki_root, &p, "raw") {
            items.push(entry);
        }
    }

    // Build deterministic lookup maps (pages take priority over raw on slug collisions)
    let mut by_rel: HashMap<String, String> = HashMap::new();
    let mut by_slug: HashMap<String, String> = HashMap::new();
    let mut by_title: HashMap<String, String> = HashMap::new();

    for (entry, _) in &items {
        by_rel.insert(entry.rel_path.to_ascii_lowercase(), entry.rel_path.clone());
    }
    for (entry, _) in items.iter().filter(|(e, _)| e.kind == "page") {
        by_slug
            .entry(entry.slug.to_ascii_lowercase())
            .or_insert_with(|| entry.rel_path.clone());
        by_title
            .entry(entry.title.to_ascii_lowercase())
            .or_insert_with(|| entry.rel_path.clone());
    }
    for (entry, _) in items.iter().filter(|(e, _)| e.kind != "page") {
        by_slug
            .entry(entry.slug.to_ascii_lowercase())
            .or_insert_with(|| entry.rel_path.clone());
        by_title
            .entry(entry.title.to_ascii_lowercase())
            .or_insert_with(|| entry.rel_path.clone());
    }

    let mut backlinks_map: HashMap<String, Vec<BrainBacklinkDto>> = HashMap::new();
    let mut links_count = 0usize;
    let mut broken_links_count = 0usize;

    for (entry, raw_links) in &mut items {
        let mut resolved_seen: HashSet<String> = HashSet::new();
        for link in raw_links.iter() {
            if let Some(target_rel) =
                resolve_target_rel_path(link, &entry.rel_path, &by_rel, &by_slug, &by_title)
            {
                if target_rel != entry.rel_path && resolved_seen.insert(target_rel.clone()) {
                    entry.outbound_links.push(target_rel.clone());
                    if entry.kind == "page" {
                        links_count += 1;
                    }
                    if entry.kind != "meta" {
                        backlinks_map
                            .entry(target_rel)
                            .or_default()
                            .push(BrainBacklinkDto {
                                rel_path: entry.rel_path.clone(),
                                title: entry.title.clone(),
                                kind: entry.kind.clone(),
                            });
                    }
                }
            } else if entry.kind == "page" {
                entry.broken_links.push(link.clone());
                broken_links_count += 1;
            }
        }
    }

    let mut meta_files = Vec::new();
    let mut pages = Vec::new();
    let mut raw_notes = Vec::new();
    let mut category_set: BTreeSet<String> = BTreeSet::new();

    for (mut entry, _) in items {
        if let Some(mut bls) = backlinks_map.remove(&entry.rel_path) {
            bls.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
            entry.backlinks = bls;
        }
        match entry.kind.as_str() {
            "meta" => meta_files.push(entry),
            "page" => {
                if !entry.category.is_empty() {
                    category_set.insert(entry.category.clone());
                }
                pages.push(entry);
            }
            "raw" => raw_notes.push(entry),
            _ => {}
        }
    }

    pages.sort_by(|a, b| {
        b.modified_ts
            .cmp(&a.modified_ts)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    raw_notes.sort_by(|a, b| {
        let pa = if a.status == "pending" { 0 } else { 1 };
        let pb = if b.status == "pending" { 0 } else { 1 };
        pa.cmp(&pb)
            .then_with(|| b.modified_ts.cmp(&a.modified_ts))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });

    let orphan_pages_count = pages
        .iter()
        .filter(|p| {
            let has_page_out = p
                .outbound_links
                .iter()
                .any(|o| o.starts_with("pages/"));
            let has_page_in = p.backlinks.iter().any(|b| b.kind == "page");
            !has_page_out && !has_page_in
        })
        .count();

    let raw_pending = raw_notes.iter().filter(|r| r.status == "pending").count();
    let raw_ingested = raw_notes.len().saturating_sub(raw_pending);
    let categories: Vec<String> = category_set.into_iter().collect();

    let stats = BrainWikiStatsDto {
        pages_count: pages.len(),
        raw_total: raw_notes.len(),
        raw_pending,
        raw_ingested,
        categories_count: categories.len(),
        links_count,
        broken_links_count,
        orphan_pages_count,
    };

    Ok(BrainWikiOverviewDto {
        wiki_dir: clean_display_path(wiki_root),
        default_wiki_dir: clean_display_path(default_dir),
        is_custom_dir,
        stats,
        categories,
        meta_files,
        pages,
        raw_notes,
    })
}

fn slugify_raw_title(title: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in title.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if ch >= '\u{4e00}' && ch <= '\u{9fff}' {
            out.push(ch);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
        if out.chars().count() >= 42 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

fn escape_yaml_str(raw: &str) -> String {
    raw.trim()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
}

pub(crate) fn create_raw_note_in_dir(
    wiki_root: &Path,
    title: &str,
    source: Option<&str>,
    tags: &[String],
    content: &str,
) -> Result<BrainWikiEntryDto, String> {
    ensure_brain_wiki_scaffold(wiki_root)?;
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("素材标题不能为空".to_string());
    }
    let clean_content = content.trim();
    if clean_content.is_empty() {
        return Err("素材正文不能为空".to_string());
    }

    let now = now_unix_secs();
    let ymd = unix_secs_to_ymd_cn(now).replace('-', "");
    let created_at = unix_secs_to_datetime_cn(now);
    let base_slug = slugify_raw_title(clean_title);

    let mut chosen_rel = format!("raw/{}-{}.md", ymd, base_slug);
    let mut seq = 2u32;
    while wiki_root.join(&chosen_rel).exists() {
        chosen_rel = format!("raw/{}-{}-{}.md", ymd, base_slug, seq);
        seq += 1;
    }

    let clean_tags: Vec<String> = tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let tags_yaml = clean_tags
        .iter()
        .map(|t| format!("\"{}\"", escape_yaml_str(t)))
        .collect::<Vec<_>>()
        .join(", ");
    let clean_source = source.unwrap_or("").trim();

    let doc = format!(
        "---\ntitle: \"{}\"\nsource: \"{}\"\ntags: [{}]\nstatus: pending\ncreated_at: \"{}\"\ningested_at: \"\"\n---\n\n{}\n",
        escape_yaml_str(clean_title),
        escape_yaml_str(clean_source),
        tags_yaml,
        created_at,
        clean_content
    );

    let (normalized, target_path) = resolve_safe_wiki_path(wiki_root, &chosen_rel, false)?;
    write_file_atomic(&target_path, &doc)?;

    let (entry, _) = build_entry_from_file(wiki_root, &target_path, "raw")
        .ok_or_else(|| format!("创建后无法读取素材: {}", normalized))?;
    Ok(entry)
}

pub(crate) fn read_wiki_file_in_dir(wiki_root: &Path, rel_path: &str) -> Result<String, String> {
    ensure_brain_wiki_scaffold(wiki_root)?;
    let (_, target) = resolve_safe_wiki_path(wiki_root, rel_path, true)?;
    std::fs::read_to_string(&target).map_err(|e| format!("读取知识库文件失败: {}", e))
}

pub(crate) fn save_wiki_file_in_dir(
    wiki_root: &Path,
    rel_path: &str,
    content: &str,
) -> Result<(), String> {
    ensure_brain_wiki_scaffold(wiki_root)?;
    let (_, target) = resolve_safe_wiki_path(wiki_root, rel_path, false)?;
    write_file_atomic(&target, content)
}

pub(crate) fn delete_wiki_file_in_dir(wiki_root: &Path, rel_path: &str) -> Result<(), String> {
    ensure_brain_wiki_scaffold(wiki_root)?;
    let (normalized, target) = resolve_safe_wiki_path(wiki_root, rel_path, true)?;
    if !normalized.starts_with("raw/") && !normalized.starts_with("pages/") {
        return Err("不允许删除知识库核心元数据文件（SCHEMA.md / index.md / log.md）".to_string());
    }
    std::fs::remove_file(&target).map_err(|e| format!("删除知识库文件失败: {}", e))
}

pub(crate) fn update_wiki_dir_in_config(plugin_root: &Path, next_dir: &str) -> Result<(), String> {
    let cfg_path = plugin_root.join("config.json");
    let mut obj: Map<String, Value> = if let Ok(raw) = std::fs::read_to_string(&cfg_path) {
        serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    } else {
        Map::new()
    };

    let trimmed = next_dir.trim();
    if trimmed.is_empty() {
        obj.remove("wiki_dir");
    } else {
        if trimmed.contains('\0') {
            return Err("知识库路径包含非法字符".to_string());
        }
        let expanded = expand_tilde(trimmed);
        let resolved = if expanded.is_absolute() {
            expanded
        } else {
            plugin_root.join(expanded)
        };
        ensure_brain_wiki_scaffold(&resolved)?;
        obj.insert("wiki_dir".to_string(), Value::String(trimmed.to_string()));
    }

    let serialized = serde_json::to_string_pretty(&Value::Object(obj))
        .map_err(|e| format!("序列化 config.json 失败: {}", e))?;
    write_file_atomic(&cfg_path, &format!("{}\n", serialized))
}

pub(crate) fn build_brain_launch_prompt(
    wiki_dir: &str,
    mode: &str,
    rel_path: Option<&str>,
    topic: Option<&str>,
) -> (String, String) {
    match mode.trim().to_ascii_lowercase().as_str() {
        "ingest" => {
            if let Some(rp) = rel_path.map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let stem = rp.rsplit('/').next().unwrap_or(rp).trim_end_matches(".md");
                (
                    format!("A8 Brain 整理素材 ({})", stem),
                    format!(
                        "/a8-brain 请按整理归档模式（Mode 2 Ingest）处理知识库 `{}` 中的原始素材 `{}`：先读 `SCHEMA.md` 与 `index.md`，提炼核心观点与方法论，写入或合并到 `pages/` 并建立 `[[slug]]` 双向链接，同步更新 `index.md`、`log.md`，最后将该 raw 素材标记为 `status: ingested`（保留原始正文不变）。",
                        wiki_dir, rp
                    ),
                )
            } else {
                (
                    "A8 Brain 批量整理待归档素材".to_string(),
                    format!(
                        "/a8-brain 请按整理归档模式（Mode 2 Ingest）扫描知识库 `{}` 下 `raw/` 目录中所有 `status: pending` 的待整理素材：先读 `SCHEMA.md` 与 `index.md`，逐篇消化提炼后写入或合并到 `pages/` 并建立 `[[slug]]` 双向链接，同步更新 `index.md`、`log.md` 并将已处理素材标记为 `status: ingested`。",
                        wiki_dir
                    ),
                )
            }
        }
        "lint" => (
            "A8 Brain 知识库体检".to_string(),
            format!(
                "/a8-brain 请按知识库体检模式（Mode 3 Lint）对 `{}` 执行一次全面健康巡检：检查断链 `[[target]]`、孤立页面、未登进 `index.md` 的漏网页面、概念重复或观点冲突以及待整理积压，先给出清晰体检报告再按确认修复。",
                wiki_dir
            ),
        ),
        _ => {
            let clean_topic = topic.map(|s| s.trim()).filter(|s| !s.is_empty());
            let title = clean_topic
                .map(|t| format!("A8 头脑风暴：{}", t.chars().take(28).collect::<String>()))
                .unwrap_or_else(|| "A8 头脑风暴".to_string());
            let prompt = match clean_topic {
                Some(t) => format!(
                    "/a8-brain 请先读取知识库 `{}` 的 `index.md`，挑选最相关的 2～5 篇 `pages/` 条目精读，然后结合库中沉淀的原则、模式与玩法，围绕以下主题展开结构化头脑风暴并显式引用 `[[slug]]`：\n\n{}",
                    wiki_dir, t
                ),
                None => format!(
                    "/a8-brain 请先读取知识库 `{}` 的 `index.md` 了解我已沉淀的方法论与主题脉络，准备好随时和我展开头脑风暴；简短告诉我目前库里有哪些核心思维武器可以调用。",
                    wiki_dir
                ),
            };
            (title, prompt)
        }
    }
}

#[tauri::command]
pub fn get_brain_wiki_overview() -> Result<BrainWikiOverviewDto, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, default_dir, is_custom) = resolve_wiki_dir_for_plugin(&plugin_root);
    scan_brain_wiki_overview(&wiki_root, &default_dir, is_custom)
}

#[tauri::command]
pub fn read_brain_wiki_file(rel_path: String) -> Result<String, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    read_wiki_file_in_dir(&wiki_root, &rel_path)
}

#[tauri::command]
pub fn create_brain_raw_note(
    title: String,
    source: Option<String>,
    tags: Option<Vec<String>>,
    content: String,
) -> Result<BrainWikiEntryDto, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    create_raw_note_in_dir(
        &wiki_root,
        &title,
        source.as_deref(),
        tags.as_deref().unwrap_or(&[]),
        &content,
    )
}

#[tauri::command]
pub fn save_brain_wiki_file(rel_path: String, content: String) -> Result<(), String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    save_wiki_file_in_dir(&wiki_root, &rel_path, &content)
}

#[tauri::command]
pub fn delete_brain_wiki_file(rel_path: String) -> Result<(), String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    delete_wiki_file_in_dir(&wiki_root, &rel_path)
}

#[tauri::command]
pub fn open_brain_wiki_dir() -> Result<(), String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    ensure_brain_wiki_scaffold(&wiki_root)?;
    crate::open_in_explorer_native(&wiki_root);
    Ok(())
}

#[tauri::command]
pub fn set_brain_wiki_dir(wiki_dir: String) -> Result<BrainWikiOverviewDto, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    update_wiki_dir_in_config(&plugin_root, &wiki_dir)?;
    let (wiki_root, default_dir, is_custom) = resolve_wiki_dir_for_plugin(&plugin_root);
    scan_brain_wiki_overview(&wiki_root, &default_dir, is_custom)
}

#[tauri::command]
pub fn launch_brain_in_antigravity(
    mode: String,
    rel_path: Option<String>,
    topic: Option<String>,
    title: Option<String>,
    prompt: Option<String>,
) -> Result<AdvanceProposalResultDto, String> {
    let (plugin_root, _, _) = detect_plugin_location()?;
    let (wiki_root, _, _) = resolve_wiki_dir_for_plugin(&plugin_root);
    ensure_brain_wiki_scaffold(&wiki_root)?;
    let display_dir = clean_display_path(&wiki_root);

    let (default_title, default_prompt) =
        build_brain_launch_prompt(&display_dir, &mode, rel_path.as_deref(), topic.as_deref());
    let conv_title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(default_title);
    let conv_prompt = prompt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(default_prompt);

    launch_antigravity_conversation(&conv_title, &conv_prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDirGuard(PathBuf);

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "a8_brain_test_{}_{}_{}",
                prefix,
                std::process::id(),
                nanos
            ));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn test_normalize_wiki_rel_path_security() {
        assert_eq!(normalize_wiki_rel_path("index.md").unwrap(), "index.md");
        assert_eq!(normalize_wiki_rel_path("SCHEMA.md").unwrap(), "SCHEMA.md");
        assert_eq!(normalize_wiki_rel_path("log.md").unwrap(), "log.md");
        assert_eq!(
            normalize_wiki_rel_path(r"pages\agents\subagent.md").unwrap(),
            "pages/agents/subagent.md"
        );
        assert_eq!(
            normalize_wiki_rel_path("raw/20261122-note.md").unwrap(),
            "raw/20261122-note.md"
        );

        assert!(normalize_wiki_rel_path("../secret.md").is_err());
        assert!(normalize_wiki_rel_path("pages/../secret.md").is_err());
        assert!(normalize_wiki_rel_path("C:/Windows/win.md").is_err());
        assert!(normalize_wiki_rel_path("pages/evil.exe").is_err());
        assert!(normalize_wiki_rel_path("other/file.md").is_err());
        assert!(normalize_wiki_rel_path("pages/.hidden.md").is_err());
    }

    #[test]
    fn test_extract_wiki_links_skips_code_blocks_and_inline_code() {
        let md = r#"
正文引用 [[subagent-pattern]] 和 [[learning-loop|学习闭环]]，以及 [相对文档](./architecture.md)。
忽略行内代码 `[[not-a-link]]` 和外部链接 [官网](https://example.com/a.md)。

```markdown
这里面的 [[code-block-link]] 与 [假链接](fake.md) 不能提取
```

最后再引用 [[subagent-pattern#section-2]]（去重后不重复）。
"#;
        let links = extract_wiki_links(md);
        assert_eq!(
            links,
            vec![
                "subagent-pattern".to_string(),
                "learning-loop".to_string(),
                "./architecture.md".to_string(),
            ]
        );
    }

    #[test]
    fn test_scan_overview_computes_backlinks_broken_links_and_orphans() {
        let tmp = TempDirGuard::new("graph");
        let wiki = tmp.0.join("wiki");
        ensure_brain_wiki_scaffold(&wiki).unwrap();

        let raw_entry = create_raw_note_in_dir(
            &wiki,
            "Twitter Subagent 心得",
            Some("https://x.com/example/status/1"),
            &["subagent".to_string(), "twitter".to_string()],
            "隔离上下文能大幅减少干扰。",
        )
        .unwrap();
        assert_eq!(raw_entry.status, "pending");
        assert!(raw_entry.rel_path.starts_with("raw/"));

        save_wiki_file_in_dir(
            &wiki,
            "pages/subagent-isolation.md",
            &format!(
                "---\ntitle: \"Subagent 上下文隔离\"\ncategory: \"Agent 与 Skill 玩法\"\ntags: [\"subagent\"]\nsummary: \"隔离上下文降低污染\"\nsources: [\"{}\"]\n---\n\n参考 [[prompt-depth]] 以及 [[missing-page]]。\n",
                raw_entry.rel_path
            ),
        )
        .unwrap();

        save_wiki_file_in_dir(
            &wiki,
            "pages/prompt-depth.md",
            "---\ntitle: \"提示词深化原则\"\ncategory: \"学习与思考原则\"\n---\n\n先做深不做大。\n",
        )
        .unwrap();

        save_wiki_file_in_dir(
            &wiki,
            "pages/orphan-note.md",
            "---\ntitle: \"孤立条目\"\ncategory: \"待分类\"\n---\n\n暂未关联任何条目。\n",
        )
        .unwrap();

        let ov = scan_brain_wiki_overview(&wiki, &wiki, false).unwrap();
        assert_eq!(ov.stats.pages_count, 3);
        assert_eq!(ov.stats.raw_total, 1);
        assert_eq!(ov.stats.raw_pending, 1);
        assert_eq!(ov.stats.broken_links_count, 1);
        assert_eq!(ov.stats.orphan_pages_count, 1);

        let prompt_page = ov
            .pages
            .iter()
            .find(|p| p.rel_path == "pages/prompt-depth.md")
            .unwrap();
        assert_eq!(prompt_page.backlinks.len(), 1);
        assert_eq!(prompt_page.backlinks[0].rel_path, "pages/subagent-isolation.md");

        let subagent_page = ov
            .pages
            .iter()
            .find(|p| p.rel_path == "pages/subagent-isolation.md")
            .unwrap();
        assert_eq!(subagent_page.broken_links, vec!["missing-page".to_string()]);
        assert!(subagent_page
            .outbound_links
            .contains(&"pages/prompt-depth.md".to_string()));
        assert!(subagent_page.outbound_links.contains(&raw_entry.rel_path));
    }

    #[test]
    fn test_delete_protects_meta_files_and_raw_dedup_works() {
        let tmp = TempDirGuard::new("delete_dedup");
        let wiki = tmp.0.join("wiki");
        ensure_brain_wiki_scaffold(&wiki).unwrap();

        assert!(delete_wiki_file_in_dir(&wiki, "index.md").is_err());
        assert!(delete_wiki_file_in_dir(&wiki, "SCHEMA.md").is_err());
        assert!(delete_wiki_file_in_dir(&wiki, "log.md").is_err());

        let n1 = create_raw_note_in_dir(&wiki, "同名笔记", None, &[], "内容 1").unwrap();
        let n2 = create_raw_note_in_dir(&wiki, "同名笔记", None, &[], "内容 2").unwrap();
        assert_ne!(n1.rel_path, n2.rel_path);

        delete_wiki_file_in_dir(&wiki, &n1.rel_path).unwrap();
        assert!(read_wiki_file_in_dir(&wiki, &n1.rel_path).is_err());
    }

    #[test]
    fn test_update_wiki_dir_preserves_existing_config_keys() {
        let tmp = TempDirGuard::new("cfg");
        let plugin = tmp.0.join("plugin");
        let custom_wiki = tmp.0.join("my-custom-wiki");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(
            plugin.join("config.json"),
            r#"{"model":"gemini-decision-1","confidence_threshold":0.85}"#,
        )
        .unwrap();

        update_wiki_dir_in_config(&plugin, &custom_wiki.to_string_lossy()).unwrap();
        let (resolved, _, is_custom) = resolve_wiki_dir_for_plugin(&plugin);
        assert!(is_custom);
        assert_eq!(resolved, custom_wiki);
        assert!(custom_wiki.join("index.md").is_file());

        let raw_cfg: Value =
            serde_json::from_str(&std::fs::read_to_string(plugin.join("config.json")).unwrap())
                .unwrap();
        assert_eq!(raw_cfg["model"], "gemini-decision-1");
        assert_eq!(raw_cfg["confidence_threshold"], 0.85);

        update_wiki_dir_in_config(&plugin, "").unwrap();
        let (reset_dir, default_dir, is_custom_after) = resolve_wiki_dir_for_plugin(&plugin);
        assert!(!is_custom_after);
        assert_eq!(reset_dir, default_dir);
    }
}
