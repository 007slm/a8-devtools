#!/usr/bin/env python3
"""
run_repo_lints.py - Executes <repo>/scripts/lints/ checks (*.py & *.mjs) and records
per-lint hit/eval metrics to harness_metrics.jsonl without modifying target repo lint scripts.
"""

import json
import os
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
FAIL_LINE_RE = re.compile(r"^\s*\[FAIL\]\s*(?:\[([A-Za-z0-9_.-]+)\]|([A-Za-z0-9_.-]+)\b)", re.M)
CHECK_DEF_RE = re.compile(r"^\s*def\s+check_([A-Za-z0-9_]+)\s*\(", re.M)
CHECK_ID_ASSIGN_RE = re.compile(r"""^\s*(?:const\s+|let\s+|var\s+)?CHECK_ID\s*=\s*["']([A-Za-z0-9_.-]+)["']""", re.M)
PASS_TAG_LITERAL_RE = re.compile(r"""\[PASS\]\s+([A-Z][A-Z0-9_.-]{2,})\b""")
TUPLE_CHECK_RE = re.compile(r"""\(\s*["']([A-Z][A-Z0-9_.-]{2,})["']\s*,\s*(check_[A-Za-z0-9_]+)\s*\)""")


def _discover_lint_ids(lint_files: list[Path]) -> list[str]:
    ids: list[str] = []
    for lf in lint_files:
        try:
            text = lf.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        file_ids: list[str] = []
        tuple_map = {fn: cid.upper() for cid, fn in TUPLE_CHECK_RE.findall(text)}
        assign_match = CHECK_ID_ASSIGN_RE.search(text)
        explicit_id = assign_match.group(1).upper() if assign_match else ""

        if lf.suffix.lower() == ".py":
            found_defs = CHECK_DEF_RE.findall(text)
            if found_defs:
                if len(found_defs) == 1 and explicit_id:
                    file_ids.append(explicit_id)
                else:
                    for tail in found_defs:
                        fn_name = f"check_{tail}"
                        cid = tuple_map.get(fn_name, tail.upper())
                        if cid not in file_ids:
                            file_ids.append(cid)
            elif explicit_id:
                file_ids.append(explicit_id)
        else:
            if explicit_id:
                file_ids.append(explicit_id)
            else:
                tag_match = PASS_TAG_LITERAL_RE.search(text)
                if tag_match:
                    file_ids.append(tag_match.group(1).upper())

        if not file_ids:
            file_ids.append(lf.stem.upper())

        for cid in file_ids:
            if cid not in ids:
                ids.append(cid)
    return ids


def _select_runner_targets(lints_dir: Path) -> list[Path]:
    py_files = sorted(
        [p for p in lints_dir.glob("*.py") if p.is_file() and p.name != "__init__.py"],
        key=lambda p: p.name.lower(),
    )
    mjs_files = sorted(
        [p for p in lints_dir.glob("*.mjs") if p.is_file()],
        key=lambda p: p.name.lower(),
    )
    runner = lints_dir / "run_lints.py"
    if not runner.is_file():
        return [*py_files, *mjs_files]

    runner_text = ""
    try:
        runner_text = runner.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        runner_text = ""

    targets: list[Path] = [runner]
    for mf in mjs_files:
        if mf.name.lower() not in runner_text:
            targets.append(mf)
    return targets


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

    targets = _select_runner_targets(lints_dir)
    if not targets:
        return {
            "ok": False,
            "status": "empty",
            "repo": repo_root.name,
            "error": f"{lints_dir} 下无 .py 或 .mjs Lint 脚本",
            "evaluated_ids": [],
            "violated_ids": [],
        }

    discovered_ids = _discover_lint_ids(targets)

    all_stdout: list[str] = []
    all_stderr: list[str] = []
    passed_ids: list[str] = []
    violated_ids: list[str] = []
    exit_code = 0
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

    for script in targets:
        cmd = ["node", str(script)] if script.suffix.lower() == ".mjs" else [sys.executable, str(script)]
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(repo_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
                creationflags=creationflags,
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
        for m1, m2 in FAIL_LINE_RE.findall(out + "\n" + err):
            cid = (m1 or m2).strip().upper()
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
