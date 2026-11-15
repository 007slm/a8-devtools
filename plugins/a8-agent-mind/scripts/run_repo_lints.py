#!/usr/bin/env python3
"""
run_repo_lints.py - Executes <repo>/scripts/lints/ checks and records per-lint hit/eval metrics
to harness_metrics.jsonl without modifying target repository lint scripts.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
JUDGE_SCRIPTS_DIR = PLUGIN_DIR / "skills" / "a8-judge" / "scripts"
if str(JUDGE_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(JUDGE_SCRIPTS_DIR))

from decisions_client import append_harness_metric  # noqa: E402
from judge_router import resolve_workspace_root  # noqa: E402

PASS_LINE_RE = re.compile(r"^\s*\[PASS\]\s+([A-Za-z0-9_.-]+)\b", re.M)
FAIL_LINE_RE = re.compile(r"^\s*\[FAIL\]\s*\[([A-Za-z0-9_.-]+)\]", re.M)
CHECK_DEF_RE = re.compile(r"^\s*def\s+check_([A-Za-z0-9_]+)\s*\(", re.M)


def _discover_lint_ids(lint_files: list[Path]) -> list[str]:
    ids: list[str] = []
    for lf in lint_files:
        try:
            text = lf.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        found = CHECK_DEF_RE.findall(text)
        if found:
            for tail in found:
                cid = tail.upper()
                if cid not in ids:
                    ids.append(cid)
        else:
            stem = lf.stem.upper()
            if stem not in ids:
                ids.append(stem)
    return ids


def run_repo_lints(workspace_arg: str) -> dict:
    repo_root = resolve_workspace_root(workspace_arg) or Path(workspace_arg).resolve()
    lints_dir = repo_root / "scripts" / "lints"
    if not lints_dir.is_dir():
        return {
            "ok": False,
            "status": "missing",
            "repo": repo_root.name,
            "error": f"未找到 {lints_dir}",
            "evaluated_ids": [],
            "violated_ids": [],
        }

    py_files = sorted(
        [p for p in lints_dir.glob("*.py") if p.is_file() and p.name != "__init__.py"],
        key=lambda p: p.name.lower(),
    )
    if not py_files:
        return {
            "ok": False,
            "status": "empty",
            "repo": repo_root.name,
            "error": f"{lints_dir} 下无 Python Lint 脚本",
            "evaluated_ids": [],
            "violated_ids": [],
        }

    runner = lints_dir / "run_lints.py"
    targets = [runner] if runner.is_file() else py_files
    discovered_ids = _discover_lint_ids(targets)

    all_stdout: list[str] = []
    all_stderr: list[str] = []
    passed_ids: list[str] = []
    violated_ids: list[str] = []
    exit_code = 0

    for script in targets:
        try:
            proc = subprocess.run(
                [sys.executable, str(script)],
                cwd=str(repo_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            out = proc.stdout or ""
            err = proc.stderr or ""
            rc = proc.returncode
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
            err = f"Lint script timed out after 60s: {script.name}"
            rc = 124
        except OSError as exc:
            out = ""
            err = f"Failed to run lint script {script.name}: {exc}"
            rc = 1

        if out:
            all_stdout.append(out.rstrip())
        if err:
            all_stderr.append(err.rstrip())
        if rc != 0:
            exit_code = rc

        for m in PASS_LINE_RE.findall(out):
            cid = m.strip().upper()
            if cid and cid not in passed_ids:
                passed_ids.append(cid)
        for m in FAIL_LINE_RE.findall(out + "\n" + err):
            cid = m.strip().upper()
            if cid and cid not in violated_ids:
                violated_ids.append(cid)

        # Fallback for standalone lint scripts without [PASS]/[FAIL] tags
        if not PASS_LINE_RE.search(out) and not FAIL_LINE_RE.search(out + "\n" + err):
            script_ids = _discover_lint_ids([script])
            if rc == 0:
                for cid in script_ids:
                    if cid not in passed_ids:
                        passed_ids.append(cid)
            else:
                for cid in script_ids:
                    if cid not in violated_ids:
                        violated_ids.append(cid)

    evaluated_ids: list[str] = []
    for cid in ([*passed_ids, *violated_ids] or discovered_ids):
        if cid not in evaluated_ids:
            evaluated_ids.append(cid)

    verdict = "PASSED" if exit_code == 0 and not violated_ids else "VIOLATED"
    mode = "PASS" if verdict == "PASSED" else "VIOLATED"
    append_harness_metric(
        {
            "source": "repo_lint",
            "mode": mode,
            "repo": repo_root.name,
            "verdict": verdict,
            "confidence": 1.0,
            "evaluated_ids": evaluated_ids,
            "violated_ids": violated_ids,
        }
    )

    return {
        "ok": verdict == "PASSED",
        "status": "passed" if verdict == "PASSED" else "violated",
        "repo": repo_root.name,
        "exit_code": exit_code,
        "evaluated_ids": evaluated_ids,
        "violated_ids": violated_ids,
        "stdout": "\n".join(all_stdout),
        "stderr": "\n".join(all_stderr),
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    res = run_repo_lints(target)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if res.get("status") in ("missing", "empty"):
        sys.exit(2)
    sys.exit(0 if res.get("ok") else 1)


if __name__ == "__main__":
    main()
