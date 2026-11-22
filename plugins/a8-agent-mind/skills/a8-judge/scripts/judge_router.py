#!/usr/bin/env python3
"""
judge_router.py - Universal Git Diff Feature Extractor & Category Router
Extracts syntactic primitives from Git Diff and dynamically routes to orthogonal rule categories.
Zero project hardcoding. Pure Python standard library.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ALL_CATEGORIES = {
    "lifecycle_and_evolution": "演化与生命周期契约",
    "topology_and_boundaries": "系统边界与拓扑隔离",
    "concurrency_and_performance": "并发安全与热路径性能",
    "implementation_hygiene": "实现规范、直白命名与单一路径",
}

MAX_UNTRACKED_BYTES = 128 * 1024

IGNORED_DIR_PREFIXES = (
    "modules/devtools/ui/",
    "dist/",
    "build/",
    "target/",
    "node_modules/",
    ".git/",
    ".cowdiff/",
)
IGNORED_DIR_SEGMENTS = (
    "/dist/",
    "/build/",
    "/target/",
    "/node_modules/",
    "/.git/",
    "/.cowdiff/",
    "/assets/",
    "/fonts/",
)
IGNORED_LOCKFILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "cargo.lock",
    "poetry.lock",
    "uv.lock",
    "composer.lock",
    "gemfile.lock",
    "bun.lock",
    "bun.lockb",
}
IGNORED_STATIC_EXTENSIONS = (
    ".min.js",
    ".min.css",
    ".map",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".avif",
    ".bmp",
    ".pdf",
    ".wasm",
    ".dll",
    ".exe",
    ".pdb",
    ".lib",
    ".so",
    ".dylib",
    ".a",
    ".zip",
    ".tar",
    ".gz",
)
# Frontend UI, templates, stylesheets, and pure prose docs do not enter backend architectural Decisions API review
IGNORED_NON_BACKEND_EXTENSIONS = (
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".styl",
    ".jsx",
    ".tsx",
    ".vue",
    ".svelte",
    ".astro",
    ".md",
    ".mdx",
    ".txt",
    ".rst",
)
IGNORED_FRONTEND_DIR_PREFIXES = (
    "web/src/",
    "frontend/src/",
    "client/src/",
)
IGNORED_FRONTEND_DIR_SEGMENTS = (
    "/web/src/",
    "/frontend/src/",
    "/client/src/",
    "/components/",
    "/pages/",
    "/styles/",
)


def _normalize_scope_paths(paths: list[str] | None) -> list[str]:
    """Normalizes optional relative --paths filters into deduplicated POSIX paths."""
    if not paths:
        return []
    out: list[str] = []
    for raw in paths:
        for part in str(raw or "").split(","):
            clean = part.strip().replace("\\", "/").lstrip("./").rstrip("/")
            if clean and clean not in out:
                out.append(clean)
    return out


def parse_judge_cli_args(args: list[str], extra_flags: tuple[str, ...] = ()) -> dict:
    """Shared CLI parser for judge_router.py and decisions_client.py."""
    flag_set = set(extra_flags) | {"--last-commit"}
    parsed: dict = {
        "include_last_commit": False,
        "paths": [],
        "flags": set(),
        "positional": [],
    }
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--last-commit":
            parsed["include_last_commit"] = True
        elif arg == "--paths" and i + 1 < len(args):
            parsed["paths"].extend(_normalize_scope_paths([args[i + 1]]))
            i += 1
        elif arg.startswith("--paths="):
            parsed["paths"].extend(_normalize_scope_paths([arg.split("=", 1)[1]]))
        elif arg in flag_set:
            parsed["flags"].add(arg)
        elif not arg.startswith("--") or arg == "--stdin":
            parsed["positional"].append(arg)
        i += 1
    parsed["paths"] = _normalize_scope_paths(parsed["paths"])
    return parsed


def _build_untracked_diff(workspace: Path, rel_path: str) -> tuple[str, bool]:
    """Formats an untracked text file as a standard unified diff block; reports if omitted."""
    target = workspace / rel_path
    if not target.is_file():
        return "", False
    try:
        raw = target.read_bytes()
    except OSError as exc:
        return (
            f"diff --git a/{rel_path} b/{rel_path}\n"
            f"new file mode 100644\n"
            f"--- /dev/null\n"
            f"+++ b/{rel_path}\n"
            f"+[UNREADABLE UNTRACKED FILE OMITTED: {exc}]\n"
        ), True
    if b"\x00" in raw[:4096] or len(raw) > MAX_UNTRACKED_BYTES:
        return (
            f"diff --git a/{rel_path} b/{rel_path}\n"
            f"new file mode 100644\n"
            f"--- /dev/null\n"
            f"+++ b/{rel_path}\n"
            f"+[binary or oversized file omitted: {len(raw)} bytes]\n"
        ), True
    text = raw.decode("utf-8", errors="replace")
    plus_lines = "\n".join(f"+{line}" for line in text.splitlines())
    return (
        f"diff --git a/{rel_path} b/{rel_path}\n"
        f"new file mode 100644\n"
        f"--- /dev/null\n"
        f"+++ b/{rel_path}\n"
        f"{plus_lines}\n"
    ), False


def get_git_diff(
    working_dir: str = ".",
    include_last_commit: bool = False,
    paths: list[str] | None = None,
) -> tuple[str, dict]:
    """Extracts git diff for staged, unstaged, and untracked files against HEAD (fail-closed on git errors)."""
    scope_paths = _normalize_scope_paths(paths)
    pathspec_args = ["--", *scope_paths] if scope_paths else []
    filtered_files: list[str] = []
    meta = {
        "diff_source": "working_tree",
        "scope_paths": scope_paths,
        "tracked_diff_bytes": 0,
        "untracked_diff_bytes": 0,
        "untracked_files": [],
        "omitted_files": [],
        "filtered_files": filtered_files,
        "error": None,
    }
    try:
        chunks = []
        res = subprocess.run(
            ["git", "-c", "core.quotepath=false", "diff", "HEAD", *pathspec_args],
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if res.returncode != 0:
            err_msg = (res.stderr or f"git diff exited with code {res.returncode}").strip()
            meta["diff_source"] = "error"
            meta["error"] = err_msg
            return "", meta
        if res.stdout.strip():
            tracked_body = _extract_diff_sections(res.stdout.rstrip("\n"), filtered_files=filtered_files)
            if tracked_body.strip():
                chunks.append(tracked_body)
                meta["tracked_diff_bytes"] = len(tracked_body)

        res_untracked = subprocess.run(
            ["git", "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", *pathspec_args],
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if res_untracked.returncode != 0:
            err_msg = (res_untracked.stderr or f"git ls-files exited with code {res_untracked.returncode}").strip()
            meta["diff_source"] = "error"
            meta["error"] = err_msg
            return "", meta
        if res_untracked.stdout.strip():
            workspace = Path(working_dir)
            untracked_bytes = 0
            for rel_path in res_untracked.stdout.splitlines():
                rel_clean = rel_path.strip().replace("\\", "/")
                if not rel_clean:
                    continue
                if not _is_relevant_source_file(rel_clean):
                    if rel_clean not in filtered_files:
                        filtered_files.append(rel_clean)
                    continue
                block, omitted = _build_untracked_diff(workspace, rel_clean)
                if block:
                    block_clean = block.rstrip("\n")
                    chunks.append(block_clean)
                    meta["untracked_files"].append(rel_clean)
                    untracked_bytes += len(block_clean)
                    if omitted:
                        meta["omitted_files"].append(rel_clean)
            meta["untracked_diff_bytes"] = untracked_bytes

        if chunks:
            return "\n".join(chunks) + "\n", meta

        if include_last_commit:
            res_last = subprocess.run(
                ["git", "-c", "core.quotepath=false", "diff", "HEAD~1", "HEAD", *pathspec_args],
                cwd=working_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if res_last.returncode != 0:
                err_msg = (res_last.stderr or f"git diff HEAD~1..HEAD exited with code {res_last.returncode}").strip()
                meta["diff_source"] = "error"
                meta["error"] = err_msg
                return "", meta
            filtered_last = _extract_diff_sections(res_last.stdout, filtered_files=filtered_files)
            if filtered_last.strip():
                meta["diff_source"] = "HEAD~1..HEAD"
                meta["tracked_diff_bytes"] = len(filtered_last)
                return filtered_last + "\n", meta

        meta["diff_source"] = "clean"
        return "", meta
    except Exception as e:
        meta["diff_source"] = "error"
        meta["error"] = str(e)
        return "", meta

def resolve_workspace_root(target: str | Path | None) -> Path | None:
    """Resolves git/AGENTS.md repository root for a workspace directory or file path."""
    if not target:
        return None
    p = Path(target).resolve()
    start = p if p.is_dir() else p.parent
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists() or (candidate / "AGENTS.md").is_file():
            return candidate
    return start if start.is_dir() else None


def _rel_display(path: Path, base: Path | None) -> str:
    if base:
        try:
            return path.relative_to(base).as_posix()
        except ValueError:
            pass
    return path.name


def load_decision_dir(decision_dir: Path, scope: str, repo_name: str = "", base_root: Path | None = None) -> tuple[list[dict], list[str]]:
    """Loads and validates *.decision.json specifications from a directory (fail-closed on malformed files)."""
    items: list[dict] = []
    errors: list[str] = []
    if not decision_dir.is_dir():
        return items, errors

    for d_file in sorted(decision_dir.glob("*.decision.json"), key=lambda p: p.name.lower()):
        src_rel = _rel_display(d_file, base_root)
        try:
            raw = json.loads(d_file.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{src_rel}: JSON 解析失败 ({exc})")
            continue
        if not isinstance(raw, dict):
            errors.append(f"{src_rel}: 顶层必须是 JSON 对象")
            continue

        d_id = str(raw.get("id") or d_file.stem.removesuffix(".decision")).strip()
        if not d_id or not re.match(r"^[A-Za-z0-9_.-]+$", d_id):
            errors.append(f"{src_rel}: 缺少合法 id")
            continue

        q = raw.get("question")
        if not isinstance(q, dict):
            errors.append(f"{src_rel}: 缺少 question 对象")
            continue
        instructions = str(q.get("instructions") or "").strip()
        criteria = q.get("criteria") if isinstance(q.get("criteria"), dict) else {}
        passed_text = str(criteria.get("passed") or "").strip()
        violated_text = str(criteria.get("violated") or "").strip()
        if not instructions or not passed_text or not violated_text:
            errors.append(f"{src_rel}: question.instructions 与 criteria.passed/violated 不能为空")
            continue

        raw_cat = str(raw.get("category") or "implementation_hygiene").strip()
        category = raw_cat if raw_cat in ALL_CATEGORIES else "implementation_hygiene"
        triggers = [str(t).strip() for t in (raw.get("triggers") or []) if str(t).strip()]
        file_patterns = [str(p).strip().replace("\\", "/") for p in (raw.get("file_patterns") or []) if str(p).strip()]
        items.append({
            "id": d_id,
            "name": str(raw.get("name") or d_id).strip(),
            "scope": scope,
            "repo": repo_name,
            "category": category,
            "enabled": bool(raw.get("enabled", True)),
            "triggers": triggers,
            "file_patterns": file_patterns,
            "question": {
                "type": str(q.get("type") or "choice").strip() or "choice",
                "instructions": instructions,
                "criteria": {
                    "passed": passed_text,
                    "violated": violated_text,
                },
            },
            "why": str(raw.get("why") or "").strip(),
            "retired_at": str(raw.get("retired_at") or "").strip(),
            "retired_reason": str(raw.get("retired_reason") or "").strip(),
            "source": src_rel,
        })

    return items, errors


def load_all_decisions(plugin_root: Path, workspace_dir: str | Path | None = None) -> tuple[list[dict], list[str]]:
    """Loads global plugin decisions and project-local decisions (<repo>/scripts/lints/*.decision.json)."""
    all_items: list[dict] = []
    all_errors: list[str] = []

    g_items, g_errors = load_decision_dir(
        plugin_root / "decisions",
        scope="global",
        repo_name="a8-agent-mind",
        base_root=plugin_root,
    )
    all_items.extend(g_items)
    all_errors.extend(g_errors)

    repo_root = resolve_workspace_root(workspace_dir)
    if repo_root:
        p_dir = repo_root / "scripts" / "lints"
        # Avoid duplicate loading if workspace happens to equal plugin_root
        if p_dir.resolve() != (plugin_root / "decisions").resolve():
            p_items, p_errors = load_decision_dir(
                p_dir,
                scope="project",
                repo_name=repo_root.name,
                base_root=repo_root,
            )
            all_items.extend(p_items)
            all_errors.extend(p_errors)

    return all_items, all_errors


def load_rules(plugin_root: Path, workspace_dir: str | Path | None = None) -> list:
    """Loads rules from global rules/*.md and optional repo .agents/rules/*.md."""
    rules = []
    rules_dir = plugin_root / "rules"
    if rules_dir.exists():
        ordered = sorted(
            rules_dir.glob("*.md"),
            key=lambda p: (0 if p.name == "mind-rules.md" else 1, p.name),
        )
        for r_file in ordered:
            rules.extend(parse_rule_file(r_file))

    repo_root = resolve_workspace_root(workspace_dir)
    if repo_root:
        proj_rules_dir = repo_root / ".agents" / "rules"
        if proj_rules_dir.is_dir():
            for r_file in sorted(proj_rules_dir.glob("*.md"), key=lambda p: p.name):
                parsed = parse_rule_file(r_file)
                for item in parsed:
                    item["source"] = f"{repo_root.name}/.agents/rules/{r_file.name}"
                rules.extend(parsed)
    return rules


CATEGORY_BY_SECTION = (
    ("人机协作与交互", None),  # Persona / collaboration style, not code diff rules
    ("顶层架构设计哲学", "lifecycle_and_evolution"),
    ("职责边界自闭环", "topology_and_boundaries"),
    ("演化契约", "lifecycle_and_evolution"),
    ("旧模型退役", "lifecycle_and_evolution"),
    ("全生命周期", "lifecycle_and_evolution"),
    ("系统边界", "topology_and_boundaries"),
    ("并发安全", "concurrency_and_performance"),
    ("实现规范", "implementation_hygiene"),
    ("编码实施", "implementation_hygiene"),
    ("双层文档", None),  # Guarded deterministically by check_work_records/check_workspace_hygiene
    ("文档与双层仓库地图", None),
    ("强制交卷检查", None),
)

ANCHOR_DATE_RE = re.compile(r"^<!--\s*(\d{4}-\d{2}-\d{2})\s*:\s*(.+?)\s*-->$")
INLINE_JUDGE_RE = re.compile(
    r"<!--\s*Judge-Category:\s*([a-zA-Z0-9_]+)(?:\s*\|\s*Triggers:\s*([^>]+?))?\s*-->"
)


def _derive_keywords_from_text(text: str) -> list:
    """Extracts ASCII code symbols / backticked tokens from rule prose for router matching."""
    found = []
    for tick in re.findall(r"`([^`]+)`", text):
        token = tick.strip()
        if token and len(token) >= 3 and token not in found:
            found.append(token)
    return found[:8]


def _resolve_section_category(heading: str, current: str | None) -> str | None:
    for kw, mapped_cat in CATEGORY_BY_SECTION:
        if kw in heading:
            return mapped_cat
    return current


def parse_rule_file(file_path: Path, category_override: str = None) -> list:
    """Parses frontmatter, inline Judge-Category tags, and bullet rules (preserving date anchors as metadata)."""
    content = file_path.read_text(encoding="utf-8", errors="replace")
    rule_id = file_path.stem
    name = file_path.stem
    default_category = category_override or "implementation_hygiene"
    frontmatter_tokens = []
    file_patterns = []

    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            header, body = parts[1], parts[2]
            for line in header.splitlines():
                sline = line.strip()
                if sline.startswith("id:"):
                    rule_id = sline.split(":", 1)[1].strip()
                elif sline.startswith("name:"):
                    name = sline.split(":", 1)[1].strip()
                elif sline.startswith("category:"):
                    default_category = sline.split(":", 1)[1].strip()
                elif sline.startswith("- "):
                    val = sline[2:].strip().strip('"').strip("'")
                    if "/" in val or "*" in val:
                        file_patterns.append(val)
                    elif val:
                        frontmatter_tokens.append(val)
            content = body.strip()

    parsed_rules = []
    if frontmatter_tokens or file_patterns:
        parsed_rules.append({
            "id": rule_id,
            "name": name,
            "category": default_category,
            "tokens": frontmatter_tokens,
            "file_patterns": file_patterns,
            "description": content[:500],
            "source": str(file_path.name),
        })

    # Always parse body bullet rules + attach inline annotations & <!-- YYYY-MM-DD: "..." --> anchors
    current_cat: str | None = default_category
    last_top_rule: dict | None = None
    lines = content.splitlines()

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("#"):
            current_cat = _resolve_section_category(stripped, current_cat)
            last_top_rule = None
            continue

        # Attach <!-- YYYY-MM-DD: "..." --> to the enclosing top-level rule instead of hiding other bullets
        if ANCHOR_DATE_RE.match(stripped):
            if last_top_rule is not None:
                last_top_rule["anchor"] = stripped
            continue

        # Top-level rule bullet (- **Title**：... or - **Title**: ...) without leading indentation
        is_top_bullet = line.startswith("- **") and ("：" in stripped or ":" in stripped)
        if is_top_bullet:
            inline_match = INLINE_JUDGE_RE.search(stripped)
            clean_stripped = INLINE_JUDGE_RE.sub("", stripped).strip() if inline_match else stripped
            if current_cat is None and not (inline_match and inline_match.group(1).strip() in ALL_CATEGORIES):
                # Non-code section (e.g., Persona/Collaboration) excluded from code diff judging
                last_top_rule = None
                continue
            sep = "：" if "：" in clean_stripped else ":"
            title_part, body_part = clean_stripped.split(sep, 1)
            clean_title = title_part.strip("- *[]")
            # Override per-item if the title explicitly belongs to boundary closure
            item_cat = "topology_and_boundaries" if "职责边界" in clean_title else (current_cat or "implementation_hygiene")
            tokens = _derive_keywords_from_text(clean_stripped)
            if inline_match:
                cat_id = inline_match.group(1).strip()
                if cat_id in ALL_CATEGORIES:
                    item_cat = cat_id
                raw_triggers = inline_match.group(2) or ""
                for tk in (t.strip() for t in raw_triggers.split(",") if t.strip()):
                    if tk not in tokens:
                        tokens.append(tk)
            rule_obj = {
                "id": f"{file_path.stem}_rule_{idx}",
                "name": clean_title[:80],
                "category": item_cat,
                "tokens": tokens,
                "file_patterns": [],
                "description": f"{clean_title}：{body_part.strip()}"[:260],
                "source": str(file_path.name),
            }
            parsed_rules.append(rule_obj)
            last_top_rule = rule_obj
            continue

        # Attach <!-- Judge-Category: ... | Triggers: ... --> to the enclosing top-level rule (or emit standalone if outside)
        inline_match = INLINE_JUDGE_RE.search(stripped)
        if inline_match:
            cat_id = inline_match.group(1).strip()
            raw_triggers = inline_match.group(2) or ""
            inline_tokens = [t.strip() for t in raw_triggers.split(",") if t.strip()]
            if last_top_rule is not None:
                if cat_id in ALL_CATEGORIES:
                    last_top_rule["category"] = cat_id
                existing = last_top_rule["tokens"]
                for tk in inline_tokens:
                    if tk not in existing:
                        existing.append(tk)
            elif cat_id in ALL_CATEGORIES:
                parsed_rules.append({
                    "id": f"{file_path.stem}_inline_{idx}",
                    "name": f"{file_path.name}#{idx}",
                    "category": cat_id,
                    "tokens": inline_tokens,
                    "file_patterns": [],
                    "description": stripped[:300],
                    "source": str(file_path.name),
                })
            continue

        if last_top_rule is not None and line.startswith("  ") and not stripped.startswith("- **原因 (Why)**"):
            # Continuation line of the top-level rule (excluding Why note)
            combined = f"{last_top_rule['description']} {stripped.lstrip('- ')}"
            last_top_rule["description"] = combined[:260]
            for tk in _derive_keywords_from_text(stripped):
                if tk not in last_top_rule["tokens"] and len(last_top_rule["tokens"]) < 8:
                    last_top_rule["tokens"].append(tk)

    return parsed_rules


def _is_relevant_source_file(rel_path: str) -> bool:
    """Filters out compiled bundles, static assets, frontend UI code, HTML, and prose docs."""
    norm = rel_path.replace("\\", "/").strip().lower()
    if not norm:
        return False
    if norm.startswith(IGNORED_DIR_PREFIXES) or any(seg in norm for seg in IGNORED_DIR_SEGMENTS):
        return False
    if Path(norm).name in IGNORED_LOCKFILES:
        return False
    if norm.endswith(IGNORED_STATIC_EXTENSIONS) or norm.endswith(IGNORED_NON_BACKEND_EXTENSIONS):
        return False
    if norm.endswith((".ts", ".js")) and (
        norm.startswith(IGNORED_FRONTEND_DIR_PREFIXES)
        or any(seg in norm for seg in IGNORED_FRONTEND_DIR_SEGMENTS)
    ):
        return False
    return True


def _fold_deleted_file_block(block_lines: list[str], rel_path: str) -> list[str]:
    """Folds whole-file deletions into a compact tombstone so dead code does not burn TPM."""
    has_deleted_mode = any(l.startswith("deleted file mode ") for l in block_lines[:6])
    has_dev_null_plus = any(l.strip() == "+++ /dev/null" for l in block_lines[:10])
    if not (has_deleted_mode and has_dev_null_plus):
        return block_lines

    header_lines: list[str] = []
    removed_lines = 0
    in_hunk = False
    for line in block_lines:
        if line.startswith("@@ "):
            in_hunk = True
            continue
        if not in_hunk:
            header_lines.append(line)
        elif line.startswith("-") and not line.startswith("--- "):
            removed_lines += 1
    header_lines.append(f"-[DELETED FILE: {rel_path}, {removed_lines} lines removed]")
    return header_lines


def _extract_diff_sections(diff_text: str, filtered_files: list[str] | None = None) -> str:
    """Extracts backend diff sections, excluding frontend/docs/assets and folding deleted files."""
    if not diff_text:
        return ""
    blocks: list[tuple[str, list[str]]] = []
    cur_rel = ""
    cur_lines: list[str] = []
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            if cur_lines:
                blocks.append((cur_rel, cur_lines))
            parts = line.split(" b/", 1)
            cur_rel = parts[1].strip() if len(parts) > 1 else ""
            cur_lines = [line]
        else:
            cur_lines.append(line)
    if cur_lines:
        blocks.append((cur_rel, cur_lines))

    kept: list[str] = []
    for rel, lines in blocks:
        if rel:
            if not _is_relevant_source_file(rel):
                if filtered_files is not None and rel not in filtered_files:
                    filtered_files.append(rel)
                continue
            kept.extend(_fold_deleted_file_block(lines, rel))
        else:
            kept.extend(lines)
    return "\n".join(kept)


def extract_diff_file_paths(diff_text: str) -> list[str]:
    paths: list[str] = []
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            p = line[6:].strip()
            if p and p not in paths:
                paths.append(p)
        elif line.startswith("diff --git "):
            parts = line.split(" b/", 1)
            if len(parts) == 2:
                p = parts[1].strip()
                if p and p not in paths:
                    paths.append(p)
    return paths


def decision_matches_diff(decision: dict, diff_text: str, diff_files: list[str]) -> bool:
    """Checks whether an enabled Decision applies to the given diff text/file list."""
    if not decision.get("enabled", True):
        return False
    triggers = decision.get("triggers") or []
    patterns = decision.get("file_patterns") or []
    # Unscoped project/custom decisions with no triggers or file_patterns apply to any non-empty code diff
    if not triggers and not patterns:
        return bool(diff_text.strip())

    # If file_patterns are explicitly specified, require at least one changed file to match those patterns
    pattern_hit = True
    if patterns:
        pattern_hit = any(
            pat.replace("*", "").strip() in fpath
            for pat in patterns
            if pat.replace("*", "").strip()
            for fpath in diff_files
        )
        if not pattern_hit:
            return False

    if not triggers:
        return pattern_hit
    return any(tok in diff_text for tok in triggers if tok)


def analyze_diff(
    diff_text: str,
    rules: list,
    categories: dict = None,
    diff_meta: dict = None,
    decisions: list[dict] | None = None,
    decision_errors: list[str] | None = None,
    workspace_dir: Path | None = None,
) -> dict:
    """Matches diff tokens against rules & *.decision.json specifications to activate categories and decisions."""
    activated_categories = set()
    matched_rules = []
    activated_decisions = []
    all_categories = categories or ALL_CATEGORIES
    relevant_diff = _extract_diff_sections(diff_text)
    relevant_files = extract_diff_file_paths(relevant_diff)
    loaded_decisions = decisions or []

    # Universal structural checks based on diff keywords
    if any(k in relevant_diff for k in ["@Deprecated", "Legacy", "Compat", "Transition", "fallback", "legacy", "compat", "deprecated", "AGENTS.md", "repos.md"]):
        activated_categories.add("lifecycle_and_evolution")
    if any(k in relevant_diff for k in ["import ", "package ", "pom.xml", "package.json", "go.mod", "Cargo.toml"]):
        activated_categories.add("topology_and_boundaries")
    if any(k in relevant_diff for k in ["synchronized", "Lock", "Mutex", "volatile", "Thread.sleep", "time.Sleep"]):
        activated_categories.add("concurrency_and_performance")
    if any(k in relevant_diff for k in ["catch", "except", "System.out", "console.log", "print(", "enum "]):
        activated_categories.add("implementation_hygiene")

    # Match triggers defined on loaded *.decision.json specifications
    for d in loaded_decisions:
        if not d.get("enabled", True):
            continue
        if decision_matches_diff(d, relevant_diff, relevant_files):
            cat = d.get("category")
            if cat in all_categories:
                activated_categories.add(cat)
            if d["id"] not in all_categories:
                activated_decisions.append({
                    "id": d["id"],
                    "name": d["name"],
                    "scope": d.get("scope", "global"),
                    "repo": d.get("repo", ""),
                    "category": cat,
                    "source": d.get("source", ""),
                })

    # Match specific rule tokens / file patterns from rules/*.md & .agents/rules/*.md
    for r in rules:
        hit = False
        for token in r.get("tokens", []):
            if token and token in relevant_diff:
                hit = True
                break
        if not hit:
            for pat in r.get("file_patterns", []):
                clean_pat = pat.replace("*", "").strip()
                if clean_pat and any(clean_pat in fpath for fpath in relevant_files):
                    hit = True
                    break
        if hit and r.get("category") in all_categories:
            activated_categories.add(r["category"])
            matched_rules.append({
                "id": r["id"],
                "name": r["name"],
                "category": r["category"],
                "source": r.get("source"),
            })

    # If relevant diff is non-empty but no specific token hit, default to hygiene + lifecycle baseline
    if relevant_diff.strip() and not activated_categories:
        activated_categories.add("implementation_hygiene")
        activated_categories.add("lifecycle_and_evolution")

    ordered_activated = [c for c in all_categories if c in activated_categories]
    doc_guide = get_relevant_docs_for_files(workspace_dir, relevant_files)
    result = {
        "diff_length": len(relevant_diff),
        "changed_files": relevant_files,
        "activated_categories": ordered_activated,
        "skipped_categories": [c for c in all_categories if c not in activated_categories],
        "matched_rules_count": len(matched_rules),
        "rules": matched_rules,
        "global_decisions_count": sum(1 for d in loaded_decisions if d.get("scope") == "global" and d.get("enabled", True)),
        "project_decisions_count": sum(1 for d in loaded_decisions if d.get("scope") == "project" and d.get("enabled", True)),
        "activated_decisions": activated_decisions,
        "decision_load_errors": decision_errors or [],
        "workspace_docs_count": doc_guide["total_docs"],
        "relevant_docs": doc_guide["relevant_docs"],
    }
    if diff_meta:
        result.update(diff_meta)
    return result


_DOC_PATH_RE = re.compile(r"(docs[/\\][^\s`)\]<>\"]+?.md)", re.I)
_SEP_CELL_RE = re.compile(r"^:?-{2,}:?$")
_HIGHLIGHT_SECTION_RE = re.compile(
    r"决策|权衡|契约|边界|核心架构|核心设计|总览|不变量|状态机|生命周期|非目标|适用边界"
    r"|红线|原则|治理|漏斗|裁决|闭环|门禁|规范|隔离"
    r"|Key Decisions|Architecture|Contract|Invariant|State Machine|Lifecycle|Boundary|Non-Goal|Reconsider|Overview",
    re.I,
)
_VERSION_OR_NUM_RE = re.compile(r"^\d+(?:\.\d+)+$")


def _infer_table_column_map(header_cells: list[str]) -> dict[str, int]:
    """Infers semantic column indices from a Markdown table header row."""
    col_map: dict[str, int] = {}
    for idx, raw_h in enumerate(header_cells):
        h = re.sub(r"[`*\s]", "", raw_h).lower()
        if not h:
            continue
        if "type" not in col_map and any(k in h for k in ("类型", "type")):
            col_map["type"] = idx
        elif "status" not in col_map and any(k in h for k in ("状态", "status")):
            col_map["status"] = idx
        elif "assoc" not in col_map and any(k in h for k in ("源码", "关联", "code", "source", "scope")):
            col_map["assoc"] = idx
        elif "summary" not in col_map and any(k in h for k in ("用途", "说明", "摘要", "职责", "summary", "desc", "purpose")):
            col_map["summary"] = idx
        elif "module" not in col_map and any(k in h for k in ("模块", "域", "domain", "module")):
            col_map["module"] = idx
        elif "doc" not in col_map and any(k in h for k in ("文档", "路径", "doc", "path")):
            col_map["doc"] = idx
    return col_map


def _extract_assoc_paths_from_cells(
    cells: list[str],
    skip_indices: set[int],
    include_indices: set[int] | None = None,
) -> list[str]:
    """Extracts source/module path hints from table cells (preferring explicit assoc/module columns)."""
    paths: list[str] = []
    for idx, cell in enumerate(cells):
        if idx in skip_indices:
            continue
        if include_indices is not None and idx not in include_indices:
            continue
        for m in re.findall(r"`([^`]+)`", cell):
            cand = m.strip().rstrip("/").replace("\\", "/").lower()
            if (
                cand
                and " " not in cand
                and not _VERSION_OR_NUM_RE.match(cand)
                and cand not in (".", "..")
                and ("/" in cand or "." in cand)
                and not cand.startswith(("http:", "https:", "file:", "docs/"))
            ):
                if cand not in paths:
                    paths.append(cand)
        for label, target in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", cell):
            for raw in (label, target):
                cand = raw.strip().rstrip("/").replace("\\", "/").lower()
                if (
                    cand
                    and " " not in cand
                    and not _VERSION_OR_NUM_RE.match(cand)
                    and cand not in (".", "..")
                    and ("/" in cand or "." in cand)
                    and not cand.startswith(("http:", "https:", "file:", "docs/"))
                ):
                    if cand not in paths:
                        paths.append(cand)
    return paths


def _parse_agents_doc_registry(agents_md: Path) -> list[dict]:
    """Extracts structured rows from AGENTS.md documentation registry tables (4/5/6+ columns)."""
    if not agents_md.is_file():
        return []
    try:
        lines = agents_md.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    rows: list[dict] = []
    pending_header: list[str] | None = None
    col_map: dict[str, int] | None = None

    for raw in lines:
        line = raw.strip()
        if not line.startswith("|"):
            pending_header = None
            col_map = None
            continue

        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells:
            continue
        if all((not c) or _SEP_CELL_RE.match(c) for c in cells):
            if pending_header is not None:
                col_map = _infer_table_column_map(pending_header)
            continue

        doc_cell_idx = -1
        path_match = None
        for idx, c in enumerate(cells):
            m = _DOC_PATH_RE.search(c)
            if m:
                doc_cell_idx = idx
                path_match = m
                break

        if path_match is None:
            pending_header = cells
            col_map = None
            continue

        if len(cells) < 3:
            continue

        rel_doc = path_match.group(1).replace("\\", "/")
        use_map = col_map if (col_map and max(col_map.values(), default=-1) < len(cells)) else None

        if use_map:
            doc_type = cells[use_map["type"]].strip("`* ") if "type" in use_map else ""
            module_name = cells[use_map["module"]].strip("`* ") if "module" in use_map else ""
            status = cells[use_map["status"]].strip("`* ") if "status" in use_map else ""
            summary_raw = cells[use_map["summary"]] if "summary" in use_map else cells[-1]
            summary = re.sub(r"`([^`]*)`", r"\1", summary_raw).strip()
        else:
            # Fallback column mapping for 3, 4, 5, 6+ column tables without recognized headers
            other_indices = [i for i in range(len(cells)) if i != doc_cell_idx]
            if len(cells) == 3:
                doc_type = cells[other_indices[0]].strip("`* ")
                module_name = ""
                status = ""
                summary = re.sub(r"`([^`]*)`", r"\1", cells[other_indices[-1]]).strip()
            elif len(cells) == 4:
                doc_type = cells[other_indices[0]].strip("`* ")
                module_name = cells[other_indices[1]].strip("`* ")
                status = ""
                summary = re.sub(r"`([^`]*)`", r"\1", cells[other_indices[-1]]).strip()
            else:
                doc_type = cells[other_indices[0]].strip("`* ")
                module_name = cells[other_indices[1]].strip("`* ")
                status = cells[other_indices[2]].strip("`* ")
                summary = re.sub(r"`([^`]*)`", r"\1", cells[other_indices[-1]]).strip()

        if not doc_type:
            doc_type = "EVERGREEN" if "/evergreen/" in f"/{rel_doc.lower()}" else "SPEC"
        if not status and doc_type.upper() == "EVERGREEN":
            status = "ACTIVE"

        if use_map and ("assoc" in use_map or "module" in use_map):
            include_indices = {use_map[k] for k in ("assoc", "module") if k in use_map}
            assoc_paths = _extract_assoc_paths_from_cells(cells, {doc_cell_idx}, include_indices=include_indices)
        else:
            skip_indices = {doc_cell_idx}
            if use_map:
                for k in ("type", "status", "summary"):
                    if k in use_map:
                        skip_indices.add(use_map[k])
            assoc_paths = _extract_assoc_paths_from_cells(cells, skip_indices)
        rows.append(
            {
                "rel_path": rel_doc,
                "doc_type": doc_type,
                "module": module_name,
                "status": status,
                "summary": summary,
                "assoc_paths": assoc_paths,
            }
        )
    return rows


def _extract_doc_highlights(doc_path: Path, max_chars: int = 420) -> str:
    """Extracts concise key decision/invariant/boundary bullets from an Evergreen/SPEC/ADR doc."""
    if not doc_path.is_file():
        return ""
    try:
        text = doc_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""

    in_code = False
    preferred: list[str] = []
    fallback_lines: list[str] = []
    in_preferred_section = False
    seen_sub_heading = False
    for raw in text.splitlines():
        s = raw.strip()
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code or not s or s == "---":
            continue
        if s.startswith("#"):
            if s.startswith("##"):
                seen_sub_heading = True
            in_preferred_section = bool(_HIGHLIGHT_SECTION_RE.search(s))
            continue
        if s.startswith("|"):
            continue
        if s.startswith(">") and not seen_sub_heading:
            continue
        clean = re.sub(r"^>\s*", "", s)
        clean = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        if len(clean) < 12:
            continue
        if in_preferred_section:
            preferred.append(clean)
        elif len(fallback_lines) < 6:
            fallback_lines.append(clean)
        if sum(len(x) + 1 for x in preferred) >= max_chars * 2:
            break

    chosen = preferred or fallback_lines
    out = " ".join(chosen)
    if len(out) > max_chars:
        out = out[: max_chars - 3].rstrip() + "..."
    return out


def get_relevant_docs_for_files(
    workspace_dir: Path | None,
    changed_files: list[str],
    limit: int = 5,
) -> dict:
    """
    Matches workspace AGENTS.md doc registry entries against changed_files so both
    arch-judge (full read) and decisions_client.py (compact injection) see relevant docs/.
    """
    if not workspace_dir:
        return {"total_docs": 0, "relevant_docs": []}
    ws = Path(workspace_dir)
    rows = _parse_agents_doc_registry(ws / "AGENTS.md")
    if not rows:
        return {"total_docs": 0, "relevant_docs": []}

    norm_changed = [f.replace("\\", "/").lstrip("./").lower() for f in (changed_files or []) if f]
    scored: list[tuple[int, dict, str]] = []
    for idx, row in enumerate(rows):
        score = 0
        reasons: list[str] = []
        doc_lower = row["rel_path"].lower()
        if doc_lower.endswith((".html", ".htm")):
            continue
        for cf in norm_changed:
            if cf == doc_lower:
                score += 10
                reasons.append("doc_modified")
            for ap in row["assoc_paths"]:
                ap_clean = ap.lstrip("./")
                if cf == ap_clean or cf.startswith(ap_clean + "/") or ap_clean in cf:
                    score += 5
                    reasons.append(f"module:{ap_clean}")
        if score == 0 and row["doc_type"].upper() in ("ADR", "SPEC", "EVERGREEN", "GUIDE") and idx < 2:
            score = 1
            reasons.append("core_spec_baseline")
        if score > 0:
            scored.append((score, row, ",".join(dict.fromkeys(reasons))))

    scored.sort(key=lambda pair: -pair[0])
    out_docs = [
        {
            "rel_path": row["rel_path"],
            "doc_type": row["doc_type"],
            "status": row["status"],
            "summary": row["summary"],
            "match_reason": reason,
        }
        for _, row, reason in scored[:limit]
    ]
    return {"total_docs": len(rows), "relevant_docs": out_docs}


_NON_ARCHITECTURE_DOC_TYPES = {"VERIFY", "GLOSSARY", "VISUAL"}
_NON_ARCHITECTURE_DOC_NAMES = {"verify.md", "glossary.md"}


def load_documented_decisions_context(
    workspace_dir: Path | None,
    changed_files: list[str],
    max_chars: int = 2400,
    per_doc_chars: int = 700,
) -> str:
    """
    Loads compact architectural redlines/trade-offs from matched Evergreen/ADR/SPEC docs
    for Decisions API screening (excluding verify.md/glossary.md test & lexicon noise).
    Full-document reading remains the job of arch-judge when escalated.
    """
    if not workspace_dir:
        return ""
    ws = Path(workspace_dir)
    guide = get_relevant_docs_for_files(ws, changed_files, limit=5)
    if not guide["relevant_docs"]:
        return ""

    chunks: list[str] = []
    total_len = 0
    included = 0
    for row in guide["relevant_docs"]:
        doc_type_up = (row.get("doc_type") or "").strip().upper()
        doc_name_low = Path(row["rel_path"]).name.lower()
        if doc_type_up in _NON_ARCHITECTURE_DOC_TYPES or doc_name_low in _NON_ARCHITECTURE_DOC_NAMES:
            continue
        doc_path = ws / row["rel_path"]
        highlights = _extract_doc_highlights(doc_path, max_chars=per_doc_chars)
        status_part = f" ({row['status']})" if row.get("status") else ""
        header = f"### [{row['doc_type']}] {row['rel_path']}{status_part} — {row['summary']}"
        entry = f"{header}\n{highlights}" if highlights else header
        if max_chars is not None and total_len + len(entry) + 2 > max_chars:
            remain = max_chars - total_len - 4
            if remain > 80:
                chunks.append(entry[:remain].rstrip() + "...")
            break
        chunks.append(entry)
        total_len += len(entry) + 2
        included += 1
        if included >= 3:
            break
    return "\n\n".join(chunks)


def main():
    plugin_root = Path(__file__).resolve().parents[3]
    cli = parse_judge_cli_args(sys.argv[1:])
    include_last_commit = cli["include_last_commit"]
    working_dir = cli["positional"][0] if cli["positional"] else "."
    ws_root = resolve_workspace_root(working_dir) or (Path(working_dir).resolve() if Path(working_dir).exists() else None)

    diff, diff_meta = get_git_diff(
        working_dir,
        include_last_commit=include_last_commit,
        paths=cli["paths"],
    )
    rules = load_rules(plugin_root, workspace_dir=working_dir)
    decisions, decision_errors = load_all_decisions(plugin_root, workspace_dir=working_dir)
    result = analyze_diff(
        diff,
        rules,
        categories=ALL_CATEGORIES,
        diff_meta=diff_meta,
        decisions=decisions,
        decision_errors=decision_errors,
        workspace_dir=ws_root,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if diff_meta.get("diff_source") == "error" or decision_errors:
        sys.exit(2)


if __name__ == "__main__":
    main()
