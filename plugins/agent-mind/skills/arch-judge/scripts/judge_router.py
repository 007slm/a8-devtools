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
    "implementation_hygiene": "实现规范与单一路径",
}

MAX_UNTRACKED_BYTES = 128 * 1024


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


def get_git_diff(working_dir: str = ".", include_last_commit: bool = False) -> tuple[str, dict]:
    """Extracts git diff for staged, unstaged, and untracked files against HEAD (fail-closed on git errors)."""
    meta = {
        "diff_source": "working_tree",
        "tracked_diff_bytes": 0,
        "untracked_diff_bytes": 0,
        "untracked_files": [],
        "omitted_files": [],
        "error": None,
    }
    try:
        chunks = []
        res = subprocess.run(
            ["git", "-c", "core.quotepath=false", "diff", "HEAD"],
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
            tracked_body = _extract_diff_sections(res.stdout.rstrip("\n"))
            if tracked_body.strip():
                chunks.append(tracked_body)
                meta["tracked_diff_bytes"] = len(tracked_body)

        res_untracked = subprocess.run(
            ["git", "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"],
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
                if not rel_clean or not _is_relevant_source_file(rel_clean):
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
                ["git", "-c", "core.quotepath=false", "diff", "HEAD~1", "HEAD"],
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
            filtered_last = _extract_diff_sections(res_last.stdout)
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

def load_rules(plugin_root: Path) -> list:
    """Loads rules from rules/*.md with mind-rules.md ordered first."""
    rules = []
    rules_dir = plugin_root / "rules"
    if rules_dir.exists():
        ordered = sorted(
            rules_dir.glob("*.md"),
            key=lambda p: (0 if p.name == "mind-rules.md" else 1, p.name),
        )
        for r_file in ordered:
            rules.extend(parse_rule_file(r_file))
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
    ("文档与双层仓库地图", "lifecycle_and_evolution"),
    ("强制交卷检查", "implementation_hygiene"),
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
    """Filters out compiled/generated build artifacts so source code determines routing."""
    norm = rel_path.replace("\\", "/")
    if norm.startswith(("modules/devtools/ui/", "dist/", "build/", "target/")) or "/dist/" in norm or "/target/" in norm:
        return False
    if norm.endswith((".min.js", ".min.css", ".map")):
        return False
    return True


def _extract_diff_sections(diff_text: str) -> str:
    """Extracts diff sections excluding generated dist/ui bundle assets."""
    if not diff_text:
        return ""
    kept = []
    include_current = True
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            parts = line.split(" b/", 1)
            rel = parts[1].strip() if len(parts) > 1 else ""
            include_current = _is_relevant_source_file(rel)
        if include_current:
            kept.append(line)
    return "\n".join(kept)


def analyze_diff(diff_text: str, rules: list, categories: dict = None, diff_meta: dict = None) -> dict:
    """Matches diff tokens against rule triggers to activate orthogonal categories."""
    activated_categories = set()
    matched_rules = []
    all_categories = categories or ALL_CATEGORIES
    relevant_diff = _extract_diff_sections(diff_text)

    # Universal structural checks based on diff keywords
    if any(k in relevant_diff for k in ["@Deprecated", "Legacy", "Compat", "Transition", "fallback", "legacy", "compat", "deprecated", "AGENTS.md", "repos.md"]):
        activated_categories.add("lifecycle_and_evolution")
    if any(k in relevant_diff for k in ["import ", "package ", "pom.xml", "package.json", "go.mod", "Cargo.toml"]):
        activated_categories.add("topology_and_boundaries")
    if any(k in relevant_diff for k in ["synchronized", "Lock", "Mutex", "volatile", "Thread.sleep", "time.Sleep"]):
        activated_categories.add("concurrency_and_performance")
    if any(k in relevant_diff for k in ["catch", "except", "System.out", "console.log", "print("]):
        activated_categories.add("implementation_hygiene")

    # Match specific rule tokens / file patterns from rules/*.md
    for r in rules:
        hit = False
        for token in r.get("tokens", []):
            if token and token in relevant_diff:
                hit = True
                break
        if not hit:
            for pat in r.get("file_patterns", []):
                clean_pat = pat.replace("*", "").strip()
                if clean_pat and clean_pat in relevant_diff:
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
    result = {
        "diff_length": len(relevant_diff),
        "activated_categories": ordered_activated,
        "skipped_categories": [c for c in all_categories if c not in activated_categories],
        "matched_rules_count": len(matched_rules),
        "rules": matched_rules,
    }
    if diff_meta:
        result.update(diff_meta)
    return result


def main():
    plugin_root = Path(__file__).resolve().parents[3]
    args = sys.argv[1:]
    include_last_commit = "--last-commit" in args
    positional = [a for a in args if not a.startswith("--")]
    working_dir = positional[0] if positional else "."

    diff, diff_meta = get_git_diff(working_dir, include_last_commit=include_last_commit)
    rules = load_rules(plugin_root)
    result = analyze_diff(diff, rules, categories=ALL_CATEGORIES, diff_meta=diff_meta)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if diff_meta.get("diff_source") == "error":
        sys.exit(2)


if __name__ == "__main__":
    main()
