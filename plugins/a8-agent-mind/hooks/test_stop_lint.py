#!/usr/bin/env python3
"""Unit tests for hooks/stop_lint.py invariants."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HOOKS_DIR = Path(__file__).resolve().parent
if str(HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(HOOKS_DIR))

import stop_lint  # noqa: E402


class StopLintHookTests(unittest.TestCase):
    def test_ignores_non_normal_termination(self) -> None:
        out = stop_lint.evaluate_stop_hook(
            {
                "terminationReason": "USER_CANCELED",
                "continuationActive": False,
                "cwd": ".",
            }
        )
        self.assertEqual(out, {})

    def test_prevents_loop_when_continuation_active(self) -> None:
        out = stop_lint.evaluate_stop_hook(
            {
                "terminationReason": "NO_TOOL_CALL",
                "continuationActive": True,
                "cwd": ".",
            }
        )
        self.assertEqual(out, {})

    def test_skips_read_only_turn_via_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "transcript.jsonl"
            records = [
                {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "explain"},
                {"source": "MODEL", "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "read_file"}]},
            ]
            transcript.write_text(
                "\n".join(json.dumps(r) for r in records) + "\n",
                encoding="utf-8",
            )
            self.assertFalse(stop_lint.turn_has_mutating_tool(str(transcript)))

    def test_detects_mutating_tool_after_latest_user_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "transcript.jsonl"
            records = [
                {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "turn 1"},
                {"source": "MODEL", "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "write_file"}]},
                {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "turn 2"},
                {"source": "MODEL", "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "read_file"}]},
            ]
            transcript.write_text(
                "\n".join(json.dumps(r) for r in records) + "\n",
                encoding="utf-8",
            )
            self.assertFalse(stop_lint.turn_has_mutating_tool(str(transcript)))

            records.append(
                {"source": "MODEL", "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "edit_file"}]}
            )
            transcript.write_text(
                "\n".join(json.dumps(r) for r in records) + "\n",
                encoding="utf-8",
            )
            self.assertTrue(stop_lint.turn_has_mutating_tool(str(transcript)))

    def test_blocks_with_actionable_reason_when_lint_fails(self) -> None:
        fake_repo = Path("E:/fake-repo")
        fake_result = {
            "ok": False,
            "status": "violated",
            "repo": "fake-repo",
            "evaluated_ids": ["WORK_RECORD_SCHEMA"],
            "violated_ids": ["WORK_RECORD_SCHEMA"],
            "stdout": "[PASS] WORKSPACE_HYGIENE",
            "stderr": "[FAIL] [WORK_RECORD_SCHEMA] 发现 1 处违规：\n  - docs/records/bad.md: 缺少标准章节",
        }
        with (
            mock.patch.object(stop_lint, "turn_has_mutating_tool", return_value=True),
            mock.patch.object(stop_lint, "resolve_target_repo", return_value=fake_repo),
            mock.patch.object(stop_lint, "has_repo_lints", return_value=True),
            mock.patch.object(stop_lint, "has_dirty_git_worktree", return_value=True),
            mock.patch.object(stop_lint, "run_repo_lints", return_value=fake_result),
            mock.patch.object(stop_lint, "append_harness_metric") as metric_mock,
        ):
            out = stop_lint.evaluate_stop_hook(
                {
                    "terminationReason": "NO_TOOL_CALL",
                    "continuationActive": False,
                    "cwd": str(fake_repo),
                }
            )
            self.assertEqual(out.get("decision"), "continue")
            self.assertIn("WORK_RECORD_SCHEMA", out.get("reason", ""))
            self.assertNotIn("WORKSPACE_HYGIENE", out.get("reason", ""))
            self.assertIn("无需阅读 scripts/lints/ 脚本源码", out.get("reason", ""))
            metric_mock.assert_called_once()

    def test_silent_pass_when_lint_succeeds(self) -> None:
        fake_repo = Path("E:/fake-repo")
        fake_result = {
            "ok": True,
            "status": "passed",
            "repo": "fake-repo",
            "evaluated_ids": ["WORK_RECORD_SCHEMA"],
            "violated_ids": [],
            "stdout": "[PASS] WORK_RECORD_SCHEMA",
            "stderr": "",
        }
        with (
            mock.patch.object(stop_lint, "turn_has_mutating_tool", return_value=True),
            mock.patch.object(stop_lint, "resolve_target_repo", return_value=fake_repo),
            mock.patch.object(stop_lint, "has_repo_lints", return_value=True),
            mock.patch.object(stop_lint, "has_dirty_git_worktree", return_value=True),
            mock.patch.object(stop_lint, "run_repo_lints", return_value=fake_result),
        ):
            out = stop_lint.evaluate_stop_hook(
                {
                    "terminationReason": "NO_TOOL_CALL",
                    "continuationActive": False,
                    "cwd": str(fake_repo),
                }
            )
            self.assertEqual(out, {})


if __name__ == "__main__":
    unittest.main()
