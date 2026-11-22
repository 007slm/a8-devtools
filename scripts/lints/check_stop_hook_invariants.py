#!/usr/bin/env python3
"""check_stop_hook_invariants.py - 校检 a8-agent-mind Stop Hook Git 回合增量快照、品味沉淀与时机门禁不变量。"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

CHECK_ID = "STOP_HOOK_INVARIANTS"
REPO_ROOT = Path(__file__).resolve().parents[2]
STOP_REFLECT_PATH = REPO_ROOT / "plugins" / "a8-agent-mind" / "hooks" / "stop_reflect.py"


def _load_stop_reflect():
    spec = importlib.util.spec_from_file_location("a8_stop_reflect", STOP_REFLECT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _write_transcript(path: Path, steps: list[dict]) -> None:
    lines = [json.dumps(step, ensure_ascii=False) for step in steps]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _api_ok(answers: dict) -> dict:
    return {"ok": True, "response": {"answers": answers}}


def _git(repo_dir: Path, *args: str) -> None:
    kwargs: dict = {
        "cwd": str(repo_dir),
        "check": True,
        "capture_output": True,
        "text": True,
        "encoding": "utf-8",
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    subprocess.run(["git", "-C", str(repo_dir), *args], **kwargs)


def _init_git_repo(repo_dir: Path, agents_text: str = "# Test Repo\n") -> None:
    repo_dir.mkdir(parents=True, exist_ok=True)
    _git(repo_dir, "init")
    _git(repo_dir, "config", "user.name", "Test")
    _git(repo_dir, "config", "user.email", "test@example.com")
    (repo_dir / "AGENTS.md").write_text(agents_text, encoding="utf-8")
    _git(repo_dir, "add", "AGENTS.md")
    _git(repo_dir, "commit", "-m", "init")


def _write_repo_file(repo_dir: Path, rel_path: str, content: str = "// updated\n") -> Path:
    target = repo_dir / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def check_stop_hook_invariants(repo_root: Path = REPO_ROOT) -> list[str]:
    """验证 Stop Hook 严格 Git 回合增量快照、废除静默写盘、未收口回合抑制及高维品味双门禁不变量。"""
    violations: list[str] = []
    source_path = repo_root / "plugins" / "a8-agent-mind" / "hooks" / "stop_reflect.py"
    src_text = source_path.read_text(encoding="utf-8")

    # 1. 不存在已废除的静默写盘分支与每回合 docs-sync 强行调度常数
    for forbidden in ("AUTO_LINT", "AUTO_DECISION", "EVERGREEN_SYNC_QUESTION", 'TypeName="docs-sync"'):
        if forbidden in src_text:
            violations.append(f"stop_reflect.py 仍包含已废除标识: {forbidden}")

    mod = _load_stop_reflect()
    if (
        hasattr(mod, "_build_reason_auto_lint")
        or hasattr(mod, "_build_reason_auto_decision")
        or hasattr(mod, "_build_reason_evergreen_sync")
    ):
        violations.append("stop_reflect.py 仍存在已废除的 _build_reason_* 函数")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        plugin_data = tmp_dir / "plugin_data"
        plugin_data.mkdir(parents=True, exist_ok=True)
        ws_dir = tmp_dir / "repo"
        _init_git_repo(ws_dir)

        def run_eval(
            conv_id: str,
            transcript: Path,
            last_user: str,
            api_side_effect,
            mutate_fn=None,
            workspace_dir: Path = ws_dir,
            capture_baseline: bool = True,
        ):
            payload = {
                "conversationId": conv_id,
                "transcriptPath": str(transcript),
                "lastUserInput": last_user,
                "workspacePaths": [str(workspace_dir)],
                "artifactDirectoryPath": str(tmp_dir / "brain"),
                "terminationReason": "NO_TOOL_CALL",
            }
            with (
                patch.dict(os.environ, {"PLUGIN_DATA": str(plugin_data)}),
                patch.object(mod, "call_decisions_api", side_effect=api_side_effect) as mock_api,
                patch.object(mod, "append_harness_metric"),
            ):
                if capture_baseline:
                    mod.capture_turn_baseline(payload)
                if mutate_fn is not None:
                    mutate_fn(workspace_dir)
                res = mod.evaluate_stop_payload(payload)
                return res, mock_api.call_count

        # 2. /plan 指令 + RequestFeedback=true 计划书回合：禁止触发，且不推进 last_taste_step
        t2 = tmp_dir / "t2.jsonl"
        plan_user = "<USER_REQUEST>\n/plan 这样做过度设计了，严禁内存合并，应该直接重放\n</USER_REQUEST>"
        _write_transcript(
            t2,
            [
                {"step_index": 10, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": plan_user},
                {
                    "step_index": 11,
                    "type": "PLANNER_RESPONSE",
                    "content": "已整理计划",
                    "tool_calls": [
                        {
                            "name": "write_file",
                            "args": {
                                "Path": f"\"{tmp_dir}/.gemini/antigravity/brain/cid/implementation_plan.md\"",
                                "ArtifactMetadata": json.dumps({"RequestFeedback": True, "UserFacing": True}),
                            },
                        }
                    ],
                },
            ],
        )
        res2, calls2 = run_eval("conv-plan", t2, plan_user, lambda *a, **kw: _api_ok({}))
        with patch.dict(os.environ, {"PLUGIN_DATA": str(plugin_data)}):
            state_after_t2 = mod._get_conv_state(mod._load_state(), "conv-plan")
        if res2 != {} or calls2 != 0 or state_after_t2["last_taste_step"] != -1:
            violations.append(
                f"Invariant 2 失败 (/plan + RequestFeedback): res={res2}, api_calls={calls2}, state={state_after_t2}"
            )

        # 3. 非守护后台任务 RUNNING + 磁盘修改源码：禁止触发
        t3 = tmp_dir / "t3.jsonl"
        _write_transcript(
            t3,
            [
                {"step_index": 20, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "不要再用老接口，修改并跑测试"},
                {
                    "step_index": 21,
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [
                        {"name": "edit_file", "args": {"Path": str(ws_dir / "src" / "Main.java")}},
                        {"name": "run_command", "args": {"CommandLine": "mvn test", "IsDaemon": False}},
                    ],
                },
                {
                    "step_index": 22,
                    "type": "GENERIC",
                    "status": "RUNNING",
                    "content": "Tool is running as a background task with task id: conv-bg/task-22\nTask Description: mvn test",
                },
                {"step_index": 23, "type": "PLANNER_RESPONSE", "content": "正在等待后台测试完成。"},
            ],
        )
        res3, calls3 = run_eval(
            "conv-bg",
            t3,
            "不要再用老接口，修改并跑测试",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: _write_repo_file(d, "src/Main.java"),
        )
        if res3 != {} or calls3 != 0:
            violations.append(f"Invariant 3 失败 (RUNNING background task): res={res3}, api_calls={calls3}")
        # Reset workspace for next invariants
        _write_repo_file(ws_dir, "src/Main.java")
        _git(ws_dir, "add", "src/Main.java")
        _git(ws_dir, "commit", "-m", "clean")

        # 4. 仅修改 docs/*.html（非 .md 且无非文档源码改动）：禁止触发
        t4 = tmp_dir / "t4.jsonl"
        _write_transcript(
            t4,
            [
                {"step_index": 30, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "这图表不行，改回图形化 html"},
                {"step_index": 31, "type": "PLANNER_RESPONSE", "content": "已更新演示页。"},
            ],
        )
        res4, calls4 = run_eval(
            "conv-doc",
            t4,
            "这图表不行，改回图形化 html",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: _write_repo_file(d, "docs/demo.html", "<html></html>"),
        )
        if res4 != {} or calls4 != 0:
            violations.append(f"Invariant 4 失败 (docs html only): res={res4}, api_calls={calls4}")

        # 5. /plan 之后 Proceed 落地源码，但 API 判定属于具体 Bug Fix 细节 (is_distinct_from_bugfix_detail=no)：拦截并不弹卡，同时推进水位
        t5 = tmp_dir / "t5.jsonl"
        _write_transcript(
            t5,
            [
                {"step_index": 10, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": plan_user},
                {
                    "step_index": 11,
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [
                        {
                            "name": "write_file",
                            "args": {
                                "Path": f"\"{tmp_dir}/.gemini/antigravity/brain/cid/implementation_plan.md\"",
                                "ArtifactMetadata": json.dumps({"RequestFeedback": True}),
                            },
                        }
                    ],
                },
                {"step_index": 12, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Proceed"},
                {"step_index": 13, "type": "PLANNER_RESPONSE", "content": "已完成源码修改与验证"},
            ],
        )
        res5, calls5 = run_eval(
            "conv-plan",
            t5,
            "Proceed",
            lambda *a, **kw: _api_ok(
                {
                    "has_high_level_taste_lesson": {"choice": "yes", "confidence": 0.94},
                    "is_distinct_from_bugfix_detail": {"choice": "no", "confidence": 0.91},
                    "rule_scope": {"choice": "universal", "confidence": 0.88},
                    "docs_maintenance_needed": {"choice": "no", "confidence": 0.95},
                }
            ),
            mutate_fn=lambda d: _write_repo_file(d, "src/Writer.java"),
        )
        with patch.dict(os.environ, {"PLUGIN_DATA": str(plugin_data)}):
            state_after_t5 = mod._get_conv_state(mod._load_state(), "conv-plan")
        if res5 != {} or calls5 != 1 or state_after_t5["last_taste_step"] < 12:
            violations.append(
                f"Invariant 5 失败 (bugfix detail filtered): res={res5}, api_calls={calls5}, state={state_after_t5}"
            )

        # 6. /plan 之后 Proceed 落地源码，双品味门禁全高置信通过 -> 触发 ASK_USER_UI；且下一轮正常编码不再重复触发
        t6 = tmp_dir / "t6.jsonl"
        _write_transcript(
            t6,
            [
                {"step_index": 10, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": plan_user},
                {
                    "step_index": 11,
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [
                        {
                            "name": "write_file",
                            "args": {
                                "Path": f"\"{tmp_dir}/.gemini/antigravity/brain/cid/implementation_plan.md\"",
                                "ArtifactMetadata": json.dumps({"RequestFeedback": True}),
                            },
                        }
                    ],
                },
                {"step_index": 12, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Proceed"},
                {"step_index": 13, "type": "PLANNER_RESPONSE", "content": "已完成核心重构与实机验证"},
            ],
        )
        res6, calls6 = run_eval(
            "conv-taste",
            t6,
            "Proceed",
            lambda *a, **kw: _api_ok(
                {
                    "has_high_level_taste_lesson": {"choice": "yes", "confidence": 0.95},
                    "is_distinct_from_bugfix_detail": {"choice": "yes", "confidence": 0.92},
                    "rule_scope": {"choice": "universal", "confidence": 0.90},
                    "docs_maintenance_needed": {"choice": "no", "confidence": 0.95},
                }
            ),
            mutate_fn=lambda d: _write_repo_file(d, "src/Engine.java"),
        )
        if res6.get("decision") != "continue" or "ASK_USER_UI" not in res6.get("reason", "") or calls6 != 1:
            violations.append(f"Invariant 6a 失败 (ASK_USER_UI expected): res={res6}, api_calls={calls6}")

        # 紧接着下一轮普通编码（同时更新常青文档），前序 /plan 纠偏不应重复触发 ASK_USER_UI
        t6_next = tmp_dir / "t6_next.jsonl"
        _write_transcript(
            t6_next,
            [
                {"step_index": 10, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": plan_user},
                {"step_index": 12, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Proceed"},
                {"step_index": 14, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "把日志格式再对齐一下"},
                {"step_index": 15, "type": "PLANNER_RESPONSE", "content": "已更新日志格式与文档"},
            ],
        )
        res6_next, calls6_next = run_eval(
            "conv-taste",
            t6_next,
            "把日志格式再对齐一下",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: (_write_repo_file(d, "src/Logger.java"), _write_repo_file(d, "docs/note.md", "# Note\n")),
        )
        if res6_next != {} or calls6_next != 0:
            violations.append(
                f"Invariant 6b 失败 (stale /plan signal re-triggered): res={res6_next}, api_calls={calls6_next}"
            )

        # 7. PLANNER_RESPONSE / TOOL_RESULT 中引用 "Stop hook blocked termination:" 不得劫持回合边界
        t7 = tmp_dir / "t7.jsonl"
        _write_transcript(
            t7,
            [
                {"step_index": 40, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "修复并完善说明"},
                {
                    "step_index": 41,
                    "type": "PLANNER_RESPONSE",
                    "content": "正在处理源码并引用了 Stop hook blocked termination: 文本示例",
                },
                {
                    "step_index": 42,
                    "type": "TOOL_RESULT",
                    "content": "grep matched: is_stop_hook_msg = \"Stop hook blocked termination:\" in content",
                },
                {"step_index": 43, "type": "PLANNER_RESPONSE", "content": "已完成修改。"},
            ],
        )
        res7, calls7 = run_eval(
            "conv-hijack",
            t7,
            "修复并完善说明",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.96}}),
            mutate_fn=lambda d: _write_repo_file(d, "src/Service.java"),
        )
        reason7 = res7.get("reason", "")
        if (
            res7.get("decision") != "continue"
            or "DOCS_MAINTENANCE" not in reason7
            or str(ws_dir.resolve()) not in reason7
            or "invoke_subagent" in reason7
            or "严禁" not in reason7
            or calls7 != 1
        ):
            violations.append(f"Invariant 7 失败 (marker prose hijacked turn boundary): res={res7}, api_calls={calls7}")

        # 8. manage_subagents 含尾随 [...] 仍能精确解析 running 子代理并静默，且各会话状态分片互不覆盖
        t8 = tmp_dir / "t8.jsonl"
        _write_transcript(
            t8,
            [
                {"step_index": 50, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "启动架构审查"},
                {
                    "step_index": 52,
                    "type": "GENERIC",
                    "status": "DONE",
                    "content": 'You have 1 active subagent(s):\n[{"conversationId":"sub-1","state":"running"}]\n[INFO] trailing log bracket',
                },
                {"step_index": 53, "type": "PLANNER_RESPONSE", "content": "等待子代理完成。"},
            ],
        )
        res8, calls8 = run_eval(
            "conv-subagent",
            t8,
            "启动架构审查",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: _write_repo_file(d, "src/Guard.java"),
        )
        with patch.dict(os.environ, {"PLUGIN_DATA": str(plugin_data)}):
            merged_states = mod._load_state()
        if (
            res8 != {}
            or calls8 != 0
            or mod._get_conv_state(merged_states, "conv-plan")["last_taste_step"] < 12
            or mod._get_conv_state(merged_states, "conv-taste")["last_taste_step"] < 12
        ):
            violations.append(
                f"Invariant 8 失败 (subagent raw_decode / shard isolation): res={res8}, api_calls={calls8}, states={merged_states}"
            )

        # 9. 快轨直通：编写 docs/records/*.md 工作记录 + 源码修改直接放行（0 次 API 调用，不阻塞也不强制起 docs-sync）
        (ws_dir / "docs" / "evergreen").mkdir(parents=True, exist_ok=True)
        (ws_dir / "docs" / "records").mkdir(parents=True, exist_ok=True)
        t9 = tmp_dir / "t9.jsonl"
        _write_transcript(
            t9,
            [
                {"step_index": 60, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "实现状态机并写工作记录"},
                {"step_index": 61, "type": "PLANNER_RESPONSE", "content": "已更新源码、按日期工作记录并顺手轻改常青摘要。"},
            ],
        )
        res9, calls9 = run_eval(
            "conv-record-sync",
            t9,
            "实现状态机并写工作记录",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/StateMachine.rs"),
                _write_repo_file(d, "docs/records/20261120-SPEC-engine-state.md", "# 工作记录\n新增 READY -> SYNCING 状态机契约。\n"),
            ),
        )
        if res9 != {} or calls9 != 0:
            violations.append(f"Invariant 9 失败 (record fast-track should pass cleanly with 0 API calls): res={res9}, api_calls={calls9}")

        # 10. 编写 docs/records/*.md 且存在纠偏品味信号 -> 仅询问 taste 问题（不问 docs_maintenance_needed），可触发 ASK_USER_UI
        t10 = tmp_dir / "t10.jsonl"
        _write_transcript(
            t10,
            [
                {"step_index": 70, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "红线：以后严禁在路径里硬编码盘符"},
                {"step_index": 71, "type": "PLANNER_RESPONSE", "content": "已重构并写好工作记录。"},
            ],
        )
        captured_questions_10: list[dict] = []

        def api_t10(input_summary, questions, *args, **kwargs):
            captured_questions_10.append(dict(questions))
            return _api_ok(
                {
                    "has_high_level_taste_lesson": {"choice": "yes", "confidence": 0.95},
                    "is_distinct_from_bugfix_detail": {"choice": "yes", "confidence": 0.94},
                    "rule_scope": {"choice": "universal", "confidence": 0.92},
                }
            )

        res10, calls10 = run_eval(
            "conv-record-with-taste",
            t10,
            "红线：以后严禁在路径里硬编码盘符",
            api_t10,
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/Helper.rs"),
                _write_repo_file(d, "docs/records/20261120-SPEC-path-rule.md", "# 记录\n移除硬编码路径。\n"),
            ),
        )
        q10 = captured_questions_10[0] if captured_questions_10 else {}
        reason10 = res10.get("reason", "")
        if (
            res10.get("decision") != "continue"
            or "ASK_USER_UI" not in reason10
            or "DOCS_MAINTENANCE" in reason10
            or "docs_maintenance_needed" in q10
            or "has_high_level_taste_lesson" not in q10
            or calls10 != 1
        ):
            violations.append(f"Invariant 10 失败 (record bypasses docs check without blocking taste): res={res10}, q={q10}, api_calls={calls10}")

        # 11. 仅改非文档文件且未写工作记录 -> DOCS_MAINTENANCE 指导当前上下文轻量化直写（严禁 invoke_subagent）
        t11 = tmp_dir / "t11.jsonl"
        _write_transcript(
            t11,
            [
                {"step_index": 80, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "实现状态机"},
                {"step_index": 81, "type": "PLANNER_RESPONSE", "content": "已完成状态机重构。"},
            ],
        )
        captured_questions_11: list[dict] = []

        def api_t11(input_summary, questions, *args, **kwargs):
            captured_questions_11.append(dict(questions))
            return _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.95}})

        res11, calls11 = run_eval(
            "conv-docs-incontext",
            t11,
            "实现状态机",
            api_t11,
            mutate_fn=lambda d: _write_repo_file(d, "src/StateMachine2.rs"),
        )
        q11 = captured_questions_11[0] if captured_questions_11 else {}
        reason11 = res11.get("reason", "")
        if (
            res11.get("decision") != "continue"
            or "DOCS_MAINTENANCE" not in reason11
            or "invoke_subagent" in reason11
            or "docs-sync" not in reason11
            or "严禁" not in reason11
            or "evergreen_sync_needed" in q11
            or calls11 != 1
        ):
            violations.append(f"Invariant 11 失败 (in-context docs guidance): res={res11}, q={q11}, api_calls={calls11}")

        # 12. 直接更新 docs/evergreen/*.md + 源码（哪怕是子代理写的磁盘变更）-> 放行不重复阻断
        t12 = tmp_dir / "t12.jsonl"
        _write_transcript(
            t12,
            [
                {"step_index": 90, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "更新源码与常青文档"},
                {"step_index": 91, "type": "PLANNER_RESPONSE", "content": "已同步常青文档。"},
            ],
        )
        res12, calls12 = run_eval(
            "conv-evergreen-direct",
            t12,
            "更新源码与常青文档",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/StateMachine3.rs"),
                _write_repo_file(d, "docs/evergreen/engine.md", "# Engine Evergreen\n"),
            ),
        )
        if res12 != {} or calls12 != 0:
            violations.append(f"Invariant 12 失败 (direct evergreen doc edit): res={res12}, api_calls={calls12}")

        # 13. 仓库位于父目录 docs/ 下且伴随 docs/diagram.png 非 Markdown 资产时，源码仍须识别为 non_doc 且不能当作已更新常青文档
        docs_parent_ws = tmp_dir / "docs" / "my-project"
        _init_git_repo(docs_parent_ws, "# Docs Parent Repo\n")
        (docs_parent_ws / "docs" / "evergreen").mkdir(parents=True, exist_ok=True)
        t13 = tmp_dir / "t13.jsonl"
        _write_transcript(
            t13,
            [
                {"step_index": 100, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "重构引擎并补图"},
                {"step_index": 101, "type": "PLANNER_RESPONSE", "content": "已重构核心引擎并保存架构图。"},
            ],
        )
        res13, calls13 = run_eval(
            "conv-docs-parent",
            t13,
            "重构引擎并补图",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.95}}),
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/Core.rs"),
                _write_repo_file(d, "docs/diagram.png", "png"),
            ),
            workspace_dir=docs_parent_ws,
        )
        if res13.get("decision") != "continue" or "DOCS_MAINTENANCE" not in res13.get("reason", "") or calls13 != 1:
            violations.append(f"Invariant 13 失败 (workspace under docs/ + non-md asset): res={res13}, api_calls={calls13}")

        # 14. 调用非文档子代理（如 research）且未更新任何 docs/ -> 仍须触发 DOCS_MAINTENANCE
        t14 = tmp_dir / "t14.jsonl"
        _write_transcript(
            t14,
            [
                {"step_index": 110, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "实现状态机"},
                {
                    "step_index": 112,
                    "type": "PLANNER_RESPONSE",
                    "status": "DONE",
                    "tool_calls": [
                        {"name": "invoke_subagent", "args": {"TypeName": "research"}},
                    ],
                },
            ],
        )
        res14, calls14 = run_eval(
            "conv-unrelated-subagent",
            t14,
            "实现状态机",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.92}}),
            mutate_fn=lambda d: _write_repo_file(d, "src/StateMachine4.rs"),
        )
        if res14.get("decision") != "continue" or "DOCS_MAINTENANCE" not in res14.get("reason", "") or calls14 != 1:
            violations.append(f"Invariant 14 失败 (unrelated subagent must not bypass): res={res14}, api_calls={calls14}")

        # 15. docs_maintenance_needed=no (>=阈值) 时，常规局部修改直接放行
        t15 = tmp_dir / "t15.jsonl"
        _write_transcript(
            t15,
            [
                {"step_index": 120, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "修一个小文案"},
                {"step_index": 121, "type": "PLANNER_RESPONSE", "content": "已修改提示文案。"},
            ],
        )
        res15, calls15 = run_eval(
            "conv-trivial-both",
            t15,
            "修一个小文案",
            lambda *a, **kw: _api_ok({
                "docs_maintenance_needed": {"choice": "no", "confidence": 0.94},
            }),
            mutate_fn=lambda d: _write_repo_file(d, "src/Label.rs"),
        )
        if res15 != {} or calls15 != 1:
            violations.append(f"Invariant 15 失败 (trivial fix docs=no should pass): res={res15}, api_calls={calls15}")

        # 16. 严格 Git 模式：非 Git 目录即便改了磁盘文件且 transcript 有记录，Hook 必须静默返回 {} 且 0 次 API 调用
        non_git_ws = tmp_dir / "plain-folder"
        non_git_ws.mkdir(parents=True, exist_ok=True)
        t16 = tmp_dir / "t16.jsonl"
        _write_transcript(
            t16,
            [
                {"step_index": 130, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "非 Git 目录改源码"},
                {
                    "step_index": 131,
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [{"name": "edit_file", "args": {"Path": str(non_git_ws / "main.py")}}],
                },
            ],
        )
        res16, calls16 = run_eval(
            "conv-nongit-silent",
            t16,
            "非 Git 目录改源码",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.99}}),
            mutate_fn=lambda d: _write_repo_file(d, "main.py", "print(1)\n"),
            workspace_dir=non_git_ws,
        )
        if res16 != {} or calls16 != 0:
            violations.append(f"Invariant 16 失败 (non-Git repo must silently no-op): res={res16}, api_calls={calls16}")

        # 17. 回合开始前已存在的 Git 脏文件，在本 Turn 未再改动时不得被误判为本轮变更
        t17 = tmp_dir / "t17.jsonl"
        _write_transcript(
            t17,
            [
                {"step_index": 140, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "只回答问题不改代码"},
                {"step_index": 141, "type": "PLANNER_RESPONSE", "content": "已解释说明。"},
            ],
        )
        res17, calls17 = run_eval(
            "conv-preexisting-dirty",
            t17,
            "只回答问题不改代码",
            lambda *a, **kw: _api_ok({}),
            mutate_fn=None,
        )
        if res17 != {} or calls17 != 0:
            violations.append(f"Invariant 17 失败 (pre-existing dirty files should not trigger): res={res17}, api_calls={calls17}")

        # 18. 编码子代理（DeepCoder）改码且父会话 transcript 无任何 edit_file/write_file 时，Git 回合快照仍须捕获并触发门禁
        t18 = tmp_dir / "t18.jsonl"
        _write_transcript(
            t18,
            [
                {"step_index": 150, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "/boost 重构网关鉴权"},
                {
                    "step_index": 151,
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [{"name": "invoke_subagent", "args": {"TypeName": "DeepCoder", "Role": "Coder"}}],
                },
                {"step_index": 152, "type": "GENERIC", "status": "DONE", "content": "[Message] sender=sub-dc 已完成重构"},
                {"step_index": 153, "type": "PLANNER_RESPONSE", "content": "已完成。"},
            ],
        )
        captured_summary_18: list[str] = []

        def api_t18(input_summary, questions, *args, **kwargs):
            captured_summary_18.append(input_summary)
            return _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.96}})

        res18, calls18 = run_eval(
            "conv-deepcoder-delta",
            t18,
            "/boost 重构网关鉴权",
            api_t18,
            mutate_fn=lambda d: _write_repo_file(d, "src/AuthGateway.rs", "pub fn verify() {}\n"),
        )
        if (
            res18.get("decision") != "continue"
            or "DOCS_MAINTENANCE" not in res18.get("reason", "")
            or "invoke_subagent" in res18.get("reason", "")
            or calls18 != 1
            or "AuthGateway.rs" not in (captured_summary_18[0] if captured_summary_18 else "")
        ):
            violations.append(
                f"Invariant 18 失败 (coding subagent Git delta missed): res={res18}, api_calls={calls18}, summary={captured_summary_18}"
            )

        # 19. 本 Turn 内直接 git commit 的文件同样须被 HEAD diff 捕获
        t19 = tmp_dir / "t19.jsonl"
        _write_transcript(
            t19,
            [
                {"step_index": 160, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "修改并直接提交"},
                {"step_index": 161, "type": "PLANNER_RESPONSE", "content": "已修改并 git commit。"},
            ],
        )

        def commit_in_turn(d: Path) -> None:
            _write_repo_file(d, "src/Committed.rs", "pub fn committed() {}\n")
            _git(d, "add", "src/Committed.rs")
            _git(d, "commit", "-m", "turn commit")

        res19, calls19 = run_eval(
            "conv-commit-in-turn",
            t19,
            "修改并直接提交",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.95}}),
            mutate_fn=commit_in_turn,
        )
        if res19.get("decision") != "continue" or "DOCS_MAINTENANCE" not in res19.get("reason", "") or calls19 != 1:
            violations.append(f"Invariant 19 失败 (git commit inside turn missed): res={res19}, api_calls={calls19}")

        # 20. docs/verify.md 与 docs/glossary.md 显式归类为 "evergreen"；更新验证地图或术语表视为有效常青维护，防止 Stop Hook 死循环
        ws_root_parts = [mod._normalize_path_parts(str(ws_dir))]
        docs_parent_root_parts = [mod._normalize_path_parts(str(docs_parent_ws))]
        role_cases = [
            (mod._classify_doc_path_role("docs/verify.md", has_evergreen_dir=True), "docs/verify.md"),
            (mod._classify_doc_path_role("docs/glossary.md", has_evergreen_dir=True), "docs/glossary.md"),
            (mod._classify_doc_path_role("docs/verify.md", has_evergreen_dir=False), "docs/verify.md (no evergreen dir)"),
            (mod._classify_doc_path_role("docs/glossary.md", has_evergreen_dir=False), "docs/glossary.md (no evergreen dir)"),
            (
                mod._classify_doc_path_role(str(ws_dir / "docs" / "Verify.md"), workspace_roots_parts=ws_root_parts, has_evergreen_dir=True),
                "abs docs/Verify.md",
            ),
            (
                mod._classify_doc_path_role(str(ws_dir / "docs" / "Glossary.md"), workspace_roots_parts=ws_root_parts, has_evergreen_dir=True),
                "abs docs/Glossary.md",
            ),
            (
                mod._classify_doc_path_role(str(docs_parent_ws / "docs" / "verify.md"), workspace_roots_parts=docs_parent_root_parts, has_evergreen_dir=True),
                "docs-parent docs/verify.md",
            ),
        ]
        for actual_role, label in role_cases:
            if actual_role != "evergreen":
                violations.append(f"Invariant 20a 失败 ({label} expected 'evergreen', got {actual_role!r})")

        t20_verify = tmp_dir / "t20_verify.jsonl"
        _write_transcript(
            t20_verify,
            [
                {"step_index": 170, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "修改校验规则并同步验证地图"},
                {"step_index": 171, "type": "PLANNER_RESPONSE", "content": "已更新源码与 docs/verify.md。"},
            ],
        )
        res20v, calls20v = run_eval(
            "conv-verify-map",
            t20_verify,
            "修改校验规则并同步验证地图",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.99}}),
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/VerifyTarget.rs", "pub fn verify() {}\n"),
                _write_repo_file(d, "docs/verify.md", "# 验证地图\n"),
            ),
        )
        if res20v != {} or calls20v != 0:
            violations.append(f"Invariant 20b 失败 (docs/verify.md update blocked): res={res20v}, api_calls={calls20v}")

        t20_glossary = tmp_dir / "t20_glossary.jsonl"
        _write_transcript(
            t20_glossary,
            [
                {"step_index": 180, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "新增概念并更新术语表"},
                {"step_index": 181, "type": "PLANNER_RESPONSE", "content": "已更新源码与 docs/glossary.md。"},
            ],
        )
        res20g, calls20g = run_eval(
            "conv-glossary-map",
            t20_glossary,
            "新增概念并更新术语表",
            lambda *a, **kw: _api_ok({"docs_maintenance_needed": {"choice": "yes", "confidence": 0.99}}),
            mutate_fn=lambda d: (
                _write_repo_file(d, "src/GlossaryTarget.rs", "pub fn term() {}\n"),
                _write_repo_file(d, "docs/glossary.md", "# 项目术语表\n"),
            ),
        )
        if res20g != {} or calls20g != 0:
            violations.append(f"Invariant 20c 失败 (docs/glossary.md update blocked): res={res20g}, api_calls={calls20g}")

    return violations


def main() -> int:
    violations = check_stop_hook_invariants(REPO_ROOT)
    if violations:
        print(f"[FAIL] [{CHECK_ID}] 发现 {len(violations)} 项 Stop Hook 不变量违规：")
        for item in violations:
            print(f"  - {item}")
        return 1
    print(f"[PASS] {CHECK_ID} (20 invariants verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
