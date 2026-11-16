#!/usr/bin/env python3
"""check_plugin_agents.py - 校检 plugins/*/agents/*.md frontmatter 工具下发契约。"""

from pathlib import Path
import re
import sys

CHECK_ID = "PLUGIN_AGENT_FRONTMATTER"
FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---", re.DOTALL)
MULTILINE_TOOLS_RE = re.compile(r"(?m)^tools:\s*$")
INLINE_TOOLS_RE = re.compile(r"(?m)^tools:\s*\[[^\]]+\]\s*$")


def check_plugin_agent_frontmatter(repo_root: Path) -> list[str]:
    """确保 plugins/*/agents/*.md 显式包含 subagent: true、mainAgent: false 与单行 tools: [...]。"""
    violations: list[str] = []
    agents = sorted(repo_root.glob("plugins/*/agents/*.md"))
    for path in agents:
        rel = path.relative_to(repo_root).as_posix()
        text = path.read_text(encoding="utf-8")
        match = FRONTMATTER_RE.match(text)
        if not match:
            violations.append(f"{rel}: 缺少 YAML frontmatter")
            continue
        fm = match.group(1)
        if "subagent: true" not in fm or "mainAgent: false" not in fm:
            violations.append(f"{rel}: 必须显式包含 subagent: true 与 mainAgent: false")
        if MULTILINE_TOOLS_RE.search(fm):
            violations.append(f"{rel}: tools 必须使用单行数组 tools: [...]，禁止多行 YAML 列表")
        elif not INLINE_TOOLS_RE.search(fm):
            violations.append(f"{rel}: 缺少有效的单行 tools: [...] 声明")
    return violations


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    agents = sorted(repo_root.glob("plugins/*/agents/*.md"))
    violations = check_plugin_agent_frontmatter(repo_root)
    if violations:
        print(f"[FAIL] [{CHECK_ID}] 发现 {len(violations)} 处 Subagent 工具配置缺陷：")
        for item in violations:
            print(f"  - {item}")
        return 1
    print(f"[PASS] {CHECK_ID} ({len(agents)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
