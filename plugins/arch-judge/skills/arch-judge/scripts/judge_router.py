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

def get_git_diff(working_dir: str = ".") -> str:
    """Extracts git diff for unstaged and staged changes against HEAD."""
    try:
        # First try staged + unstaged changes
        res = subprocess.run(
            ["git", "diff", "HEAD"],
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout

        # Fallback to diff of last commit if working tree is clean
        res_last = subprocess.run(
            ["git", "diff", "HEAD~1", "HEAD"],
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        return res_last.stdout if res_last.returncode == 0 else ""
    except Exception as e:
        sys.stderr.write(f"Error fetching git diff: {e}\n")
        return ""

def load_rules(plugin_root: Path):
    """Loads all universal rules and project-specific rules if present."""
    rules = []
    universal_dir = plugin_root / "rules" / "universal"
    if universal_dir.exists():
        for r_file in universal_dir.glob("*.md"):
            rules.append(parse_rule_file(r_file, category_override=None))
    return rules

def parse_rule_file(file_path: Path, category_override: str = None) -> dict:
    """Parses frontmatter and content of a rule markdown file."""
    content = file_path.read_text(encoding="utf-8", errors="replace")
    rule_id = file_path.stem
    name = file_path.stem
    category = category_override or "implementation_hygiene"
    tokens = []
    file_patterns = []

    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            header, body = parts[1], parts[2]
            for line in header.splitlines():
                line = line.strip()
                if line.startswith("id:"):
                    rule_id = line.split(":", 1)[1].strip()
                elif line.startswith("name:"):
                    name = line.split(":", 1)[1].strip()
                elif line.startswith("category:"):
                    category = line.split(":", 1)[1].strip()
                elif line.startswith("- "):
                    val = line[2:].strip().strip('"').strip("'")
                    if "import" in val or "synchronized" in val or "catch" in val or "@" in val or "Thread" in val or "deprecated" in val.lower():
                        tokens.append(val)
                    elif "/" in val or "*" in val:
                        file_patterns.append(val)
            content = body.strip()

    return {
        "id": rule_id,
        "name": name,
        "category": category,
        "tokens": tokens,
        "file_patterns": file_patterns,
        "description": content[:500]
    }

def analyze_diff(diff_text: str, rules: list) -> dict:
    """Matches diff tokens against rule triggers to activate orthogonal categories."""
    activated_categories = set()
    matched_rules = []

    # Category definitions
    all_categories = {
        "lifecycle_and_evolution": "演化与生命周期契约",
        "topology_and_boundaries": "系统边界与拓扑隔离",
        "concurrency_and_performance": "并发安全与热路径性能",
        "implementation_hygiene": "实现规范与单一路径"
    }

    # Universal structural checks based on diff keywords
    diff_lower = diff_text.lower()
    if any(k in diff_text for k in ["@Deprecated", "Legacy", "Compat", "Transition", "fallback"]):
        activated_categories.add("lifecycle_and_evolution")
    if any(k in diff_text for k in ["import ", "package ", "pom.xml", "package.json", "go.mod"]):
        activated_categories.add("topology_and_boundaries")
    if any(k in diff_text for k in ["synchronized", "Lock", "Mutex", "volatile", "Thread.sleep", "time.Sleep"]):
        activated_categories.add("concurrency_and_performance")
    if any(k in diff_text for k in ["catch", "except", "System.out", "console.log", "print("]):
        activated_categories.add("implementation_hygiene")

    # Match specific rule tokens
    for r in rules:
        hit = False
        for token in r.get("tokens", []):
            if token in diff_text:
                hit = True
                break
        if hit:
            activated_categories.add(r["category"])
            matched_rules.append(r)

    # If diff is non-empty but no specific token hit, default to hygiene + lifecycle baseline
    if diff_text.strip() and not activated_categories:
        activated_categories.add("implementation_hygiene")
        activated_categories.add("lifecycle_and_evolution")

    return {
        "diff_length": len(diff_text),
        "activated_categories": list(activated_categories),
        "skipped_categories": [c for c in all_categories if c not in activated_categories],
        "matched_rules_count": len(matched_rules),
        "rules": matched_rules
    }

def main():
    plugin_root = Path(__file__).resolve().parent.parent.parent
    working_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    diff = get_git_diff(working_dir)

    rules = load_rules(plugin_root)
    result = analyze_diff(diff, rules)

    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
