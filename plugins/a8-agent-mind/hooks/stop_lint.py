#!/usr/bin/env python3
"""
stop_lint.py - 极轻本地确定性 Stop Hook (a8-repo-lint)

职责：
  将「Prompt 规范要求」与「Lint 代码检查」物理拆分为两条独立线。
  模型按规范直接写代码与文档；回合正常结束时由本 Hook 静默运行目标仓
  `<repo>/scripts/lints/` 确定性静态检查（0 Token、不调 LLM、不联网）：
    - 纯问答/只读分析、无文件变更、无 scripts/lints/、或全部通过 -> 返回 {} 零打扰；
    - 发现违规 -> 返回 {"decision": "continue", "reason": "<报错与改法>"} 驱动当场修复；
    - continuationActive 为 true 时直接放行，严格防止死循环。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = PLUGIN_DIR / "scripts"
JUDGE_SCRIPTS_DIR = PLUGIN_DIR / "skills" / "a8-judge" / "scripts"
for _dir in (SCRIPTS_DIR, JUDGE_SCRIPTS_DIR):
    if str(_dir) not in sys.path:
        sys.path.insert(0, str(_dir))

from decisions_client import append_harness_metric  # noqa: E402
from judge_router import resolve_workspace_root  # noqa: E402
from run_repo_lints import run_repo_lints  # noqa: E402

MUTATING_TOOLS = frozenset(
    {
        "write_file",
        "edit_file",
        "replace_file_content",
        "multi_replace_file_content",
        "write_to_file",
        "run_command",
    }
)
TRANSCRIPT_TAIL_BYTES = 512 * 1024
MAX_REASON_DETAIL_CHARS = 2500
CREATION_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def turn_has_mutating_tool(transcript_path: str) -> bool:
    """检查当前用户轮次是否调用过写入类工具；纯问答/只读查询直接返回 False。"""
    if not transcript_path:
        return True
    path = Path(transcript_path)
    if not path.is_file():
        return True

    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > TRANSCRIPT_TAIL_BYTES:
                fh.seek(size - TRANSCRIPT_TAIL_BYTES)
                raw = fh.read()
                first_nl = raw.find(b"\n")
                if first_nl >= 0:
                    raw = raw[first_nl + 1 :]
            else:
                raw = fh.read()
    except OSError:
        return True

    lines = raw.decode("utf-8", errors="replace").splitlines()
    for line in reversed(lines):
        text = line.strip()
        if not text:
            continue
        try:
            obj = json.loads(text)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue

        if obj.get("type") == "USER_INPUT" or obj.get("source") == "USER_EXPLICIT":
            return False

        tool_calls = obj.get("tool_calls")
        if isinstance(tool_calls, list):
            for tc in tool_calls:
                if isinstance(tc, dict) and tc.get("name") in MUTATING_TOOLS:
                    return True

    return True


def resolve_target_repo(payload: dict) -> Path | None:
    candidates: list[str] = []
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        candidates.append(cwd.strip())
    workspace_paths = payload.get("workspacePaths")
    if isinstance(workspace_paths, list):
        for item in workspace_paths:
            if isinstance(item, str) and item.strip():
                candidates.append(item.strip())

    seen: set[str] = set()
    for cand in candidates:
        if cand in seen:
            continue
        seen.add(cand)
        root = resolve_workspace_root(cand)
        if root is not None and root.is_dir():
            return root
    return None


def has_repo_lints(repo_root: Path) -> bool:
    lints_dir = repo_root / "scripts" / "lints"
    if not lints_dir.is_dir():
        return False
    for entry in lints_dir.iterdir():
        if not entry.is_file():
            continue
        suffix = entry.suffix.lower()
        if suffix == ".mjs" or (suffix == ".py" and entry.name != "__init__.py"):
            return True
    return False


def has_dirty_git_worktree(repo_root: Path) -> bool:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), "status", "--porcelain=v1", "-uall"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
            creationflags=CREATION_FLAGS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0 and bool(proc.stdout.strip())


def format_failure_summary(lint_result: dict) -> str:
    combined_lines: list[str] = []
    for key in ("stderr", "stdout"):
        raw = str(lint_result.get(key) or "").strip()
        if not raw:
            continue
        for ln in raw.splitlines():
            stripped = ln.strip()
            if not stripped or stripped.startswith("[PASS]"):
                continue
            combined_lines.append(ln.rstrip())

    if not combined_lines:
        violated = lint_result.get("violated_ids") or []
        detail = f"未通过规则: {', '.join(violated)}" if violated else "静态检查返回非零退出码"
    else:
        detail = "\n".join(combined_lines)

    if len(detail) > MAX_REASON_DETAIL_CHARS:
        detail = detail[:MAX_REASON_DETAIL_CHARS].rstrip() + "\n...（输出已截断，请先修复上述靠前违规）"

    return (
        "[自动 Lint 门禁未通过] 仓库确定性静态检查发现以下违规，请直接按报错提示修复对应文件"
        "（无需阅读 scripts/lints/ 脚本源码）：\n\n"
        f"{detail}"
    )


def evaluate_stop_hook(payload: dict) -> dict:
    termination_reason = str(payload.get("terminationReason") or "")
    if termination_reason and termination_reason != "NO_TOOL_CALL":
        return {}

    if bool(payload.get("continuationActive")):
        return {}

    if not turn_has_mutating_tool(str(payload.get("transcriptPath") or "")):
        return {}

    repo_root = resolve_target_repo(payload)
    if repo_root is None or not has_repo_lints(repo_root):
        return {}

    if not has_dirty_git_worktree(repo_root):
        return {}

    lint_result = run_repo_lints(str(repo_root))
    if lint_result.get("ok") or lint_result.get("status") in ("missing", "empty"):
        return {}

    append_harness_metric(
        {
            "source": "stop_hook",
            "mode": "LINT_GATE",
            "repo": str(lint_result.get("repo") or repo_root.name),
            "verdict": "continue",
            "confidence": 1.0,
            "evaluated_ids": lint_result.get("evaluated_ids") or [],
            "violated_ids": lint_result.get("violated_ids") or [],
        }
    )

    return {
        "decision": "continue",
        "reason": format_failure_summary(lint_result),
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")

    raw = sys.stdin.read().strip()
    if not raw:
        print("{}")
        return

    try:
        payload = json.loads(raw)
    except ValueError:
        print("{}")
        return

    if not isinstance(payload, dict):
        print("{}")
        return

    try:
        result = evaluate_stop_hook(payload)
    except Exception as exc:
        print(f"[a8-repo-lint] stop hook bypassed on unexpected error: {exc}", file=sys.stderr)
        print("{}")
        return

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
