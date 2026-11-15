#!/usr/bin/env python3
"""
stop_reflect.py - Post-turn Stop Hook for a8-agent-mind.
Evaluates the finished turn using L0 pre-filtering + Google Gemini Decisions API:
1. Enforces docs/ maintenance gate when non-doc files are modified without docs/ edits
   (only skipped when Decisions API explicitly returns choice=="no" >= threshold).
2. Wakes the main agent via {"decision": "continue"} in AUTO_LINT, AUTO_DECISION, ASK_USER_UI,
   and/or DOCS_MAINTENANCE modes.
"""

import hashlib
import json
import os
import sys
import tempfile
from collections import deque
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
JUDGE_SCRIPTS_DIR = PLUGIN_DIR / "skills" / "a8-judge" / "scripts"
if str(JUDGE_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(JUDGE_SCRIPTS_DIR))

from decisions_client import append_harness_metric, call_decisions_api, load_api_config  # noqa: E402

CORRECTION_KEYWORDS = (
    "不要", "别", "严禁", "禁止", "不能", "不是", "不对", "改回", "撤回", "删掉", "去掉",
    "太慢", "卡", "乱码", "报错", "失败", "错了", "应该", "必须", "约定", "规范", "规则", "红线",
    "lint", "rule", "rules", "wrong", "don't", "do not", "never", "stop", "revert",
)

REFLECT_QUESTIONS = {
    "has_reusable_lesson": {
        "type": "choice",
        "instructions": (
            "Did the latest conversation turn expose a concrete bug root-cause, repeated failure, "
            "user correction, or non-obvious architectural preference that future turns should prevent?"
        ),
        "criteria": {
            "no": (
                "Routine Q&A, pure discussion/planning without mistakes, normal one-off feature work, "
                "or transient typo fixed immediately with no generalizable lesson."
            ),
            "yes": (
                "The user explicitly corrected/rejected an approach, fixed a recurring pitfall, "
                "or surfaced a concrete engineering invariant that future agents could easily violate."
            ),
        },
    },
    "can_be_machine_lint": {
        "type": "choice",
        "instructions": (
            "Can the exposed lesson be enforced deterministically with near-zero false positives "
            "by an executable static check script (AST/XML/config/dependency/forbidden-symbol check) in scripts/lints/?"
        ),
        "criteria": {
            "no": (
                "Requires semantic intent judgment, cross-file context, or natural-language guidance "
                "where a pure regex/AST lint script would cause false positives."
            ),
            "yes": (
                "Clear mechanical invariant checkable by static code/config/structure inspection "
                "(e.g., forbidden import/API/header, duplicate file/class, unignored artifact path, missing flag)."
            ),
        },
    },
    "can_be_semantic_decision": {
        "type": "choice",
        "instructions": (
            "Assuming a deterministic static lint script is unsuitable, can this lesson be enforced cleanly "
            "against code/config Git Diffs as a structured binary choice specification (*.decision.json) "
            "for Google Gemini Decisions API (a8-judge)?"
        ),
        "criteria": {
            "no": (
                "Purely workflow/process discipline, conversation style, subjective UI aesthetics, "
                "or non-code habits that cannot be evaluated objectively by inspecting code/config diffs."
            ),
            "yes": (
                "Code, API contract, boundary, error-handling, white-labeling, or architectural invariant "
                "that is hard for regex/AST lints yet clearly decidable from a code/config diff."
            ),
        },
    },
    "rule_scope": {
        "type": "choice",
        "instructions": (
            "Does this lesson apply only to this specific repository/product stack, "
            "or universally across all software repositories?"
        ),
        "criteria": {
            "project_specific": (
                "Tied to this repository's domain, frameworks, build scripts, directories, or business semantics."
            ),
            "universal": (
                "General engineering, AI workflow, encoding, process/lifecycle, or coding hygiene discipline "
                "applicable across repositories (belongs in global mind-rules.md)."
            ),
        },
    },
}

DOCS_MAINTENANCE_QUESTION = {
    "type": "choice",
    "instructions": (
        "The assistant modified non-doc files in this turn without editing any file under docs/. "
        "Determine whether documentation under docs/ should be created or updated for these changes. "
        "Choose 'no' ONLY when it is explicitly clear that docs/ maintenance is unnecessary (e.g., typo/comment fix, "
        "minor UI copy/style tweak, dependency version bump, single-line patch, or temporary cleanup). "
        "Choose 'yes' for architectural/lifecycle changes, system boundary/dependency updates, external contracts/APIs/schemas, "
        "state machines, hook/automation behavior, cumulative multi-step features, deep bug root-cause fixes, or any ambiguity."
    ),
    "criteria": {
        "no": (
            "Explicitly trivial or purely local maintenance (typo/comment edit, minor copy/CSS tweak, "
            "dependency version bump, minor static config tweak, or temporary test cleanup) clearly needing no docs/."
        ),
        "yes": (
            "Architectural, lifecycle, boundary, contract, schema, state-machine, hook/workflow behavior, "
            "feature delivery, deep root-cause fix, or uncertain scope where docs/ maintenance may be required."
        ),
    },
}


def _state_file_path() -> Path:
    base = os.environ.get("PLUGIN_DATA", "").strip()
    root = Path(base) if base else Path(tempfile.gettempdir()) / "a8-agent-mind-hooks"
    root.mkdir(parents=True, exist_ok=True)
    return root / "stop_reflect_state.json"


def _load_state() -> dict:
    sf = _state_file_path()
    if not sf.is_file():
        return {}
    try:
        return json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    sf = _state_file_path()
    # Keep state bounded to last 50 conversations
    if len(state) > 50:
        keys = list(state.keys())[-50:]
        state = {k: state[k] for k in keys}
    try:
        sf.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _extract_recent_turn_summary(transcript_path: str, last_user_input: str) -> dict:
    summary = {
        "edited_files": [],
        "failed_commands": [],
        "has_correction_hint": False,
        "user_text": (last_user_input or "").strip()[:1200],
        "assistant_tail": "",
        "turn_fingerprint": "",
    }
    lowered_user = summary["user_text"].lower()
    if any(kw in lowered_user for kw in CORRECTION_KEYWORDS):
        summary["has_correction_hint"] = True

    tp = Path(transcript_path) if transcript_path else None
    if not tp or not tp.is_file():
        raw_fp = f"{summary['user_text']}|no-transcript"
        summary["turn_fingerprint"] = hashlib.sha256(raw_fp.encode("utf-8")).hexdigest()[:16]
        return summary

    tail_lines: deque[str] = deque(maxlen=80)
    try:
        with tp.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.strip():
                    tail_lines.append(line)
    except Exception:
        raw_fp = f"{summary['user_text']}|read-error"
        summary["turn_fingerprint"] = hashlib.sha256(raw_fp.encode("utf-8")).hexdigest()[:16]
        return summary

    steps = []
    for raw in tail_lines:
        try:
            steps.append(json.loads(raw))
        except Exception:
            continue

    last_user_idx = -1
    for i, st in enumerate(steps):
        st_type = str(st.get("type") or "")
        st_source = str(st.get("source") or "")
        st_content = str(st.get("content") or "")
        if (
            st_type == "USER_INPUT"
            or st_source == "USER_EXPLICIT"
            or "Stop hook blocked termination:" in st_content
        ):
            last_user_idx = i

    recent_steps = steps[last_user_idx:] if last_user_idx >= 0 else steps[-25:]
    edited = []
    failed_cmds = []
    assistant_texts = []
    step_indices = []

    for st in recent_steps:
        if "step_index" in st:
            step_indices.append(str(st["step_index"]))
        st_content = str(st.get("content") or "").strip()
        if st.get("type") == "USER_INPUT" and "Stop hook blocked termination:" not in st_content:
            utxt = st_content
            if utxt:
                summary["user_text"] = utxt[:1200]
                if any(kw in utxt.lower() for kw in CORRECTION_KEYWORDS):
                    summary["has_correction_hint"] = True
        for tc in st.get("tool_calls") or []:
            name = str(tc.get("name") or "")
            args = tc.get("args") or {}
            if name in ("edit_file", "write_file"):
                p = str(args.get("Path") or "").strip()
                if p and p not in edited:
                    edited.append(p)
            elif name == "run_command" and st.get("status") == "ERROR":
                cmd = str(args.get("CommandLine") or "")[:160]
                if cmd:
                    failed_cmds.append(cmd)
        if st.get("status") == "ERROR" and st.get("type") == "TOOL_RESULT":
            txt = str(st.get("content") or "")[:160]
            if txt and txt not in failed_cmds:
                failed_cmds.append(txt)
        if st.get("type") == "PLANNER_RESPONSE" and st.get("content"):
            assistant_texts.append(str(st.get("content"))[:800])

    summary["edited_files"] = edited[:20]
    summary["all_edited_files"] = edited
    summary["failed_commands"] = failed_cmds[:8]
    summary["assistant_tail"] = "\n".join(assistant_texts[-2:])[:1800]
    fp_seed = f"{last_user_idx}|{'-'.join(step_indices[-6:])}|{','.join(edited)}"
    summary["turn_fingerprint"] = hashlib.sha256(fp_seed.encode("utf-8")).hexdigest()[:16]
    return summary


def _normalize_path_parts(raw_path: str) -> list[str]:
    norm = raw_path.replace("\\", "/").strip().lower()
    return [p for p in norm.split("/") if p]


def _is_ephemeral_artifact_path(parts: list[str]) -> bool:
    if "logs" in parts or "scratch" in parts:
        return True
    joined = "/".join(parts)
    return ".gemini/antigravity/brain" in joined or ".gemini/config/sidecars" in joined


def _analyze_doc_maintenance(edited_files: list[str]) -> tuple[bool, bool, list[str]]:
    """Classifies edited files into (has_doc_maintenance, needs_docs_check, non_doc_files)."""
    doc_files: list[str] = []
    non_doc_files: list[str] = []
    for raw_path in edited_files:
        parts = _normalize_path_parts(raw_path)
        if not parts:
            continue
        if "docs" in parts:
            doc_files.append(raw_path)
            continue
        if parts[-1] == "agents.md" or _is_ephemeral_artifact_path(parts):
            continue
        non_doc_files.append(raw_path)
    has_doc_maintenance = bool(doc_files)
    needs_docs_check = bool(non_doc_files) and not has_doc_maintenance
    return has_doc_maintenance, needs_docs_check, non_doc_files


def _find_repo_root(hint_files: list[str]) -> str:
    for raw_path in hint_files:
        p = Path(raw_path)
        for parent in [p.parent, *p.parents[:5]]:
            if (parent / "AGENTS.md").is_file() or (parent / ".git").exists():
                return str(parent)
    return ""


def _pick_workspace(payload: dict, hint_files: list[str] | None = None) -> str:
    ws_list = payload.get("workspacePaths") or []
    if ws_list and isinstance(ws_list, list):
        return str(ws_list[0])
    if hint_files:
        detected = _find_repo_root(hint_files)
        if detected:
            return detected
    return str(payload.get("cwd") or os.getcwd())


def _build_reason_auto_lint(workspace: str, scope_choice: str) -> str:
    lint_dir = Path(workspace) / "scripts" / "lints"
    decision_target = (
        PLUGIN_DIR / "decisions"
        if scope_choice == "universal"
        else lint_dir
    )
    return (
        f"[a8-agent-mind Stop Hook -> AUTO_LINT] Decisions API 判定本轮问题优先适合沉淀为确定性静态 Lint。\n"
        f"请立即在 `{lint_dir}` 下新增或扩展精确的结构/代码检查脚本（严禁只写易误报的粗糙正则；优先复用该目录已有检查入口），并严格执行：\n"
        f"1. 立即运行 `scripts/lints/` 检查验证对现存合法代码 0 误报且退出码为 0；\n"
        f"2. 若检查脚本可靠通过，保留脚本并在回复中简洁说明新增规则与验证结果（必要时可在 "
        f"{'全局 mind-rules.md' if scope_choice == 'universal' else '.agents/rules/redline.md'} 留 1 行指针）；\n"
        f"3. 若发现静态 Lint 难以做到低误报，请先降级写成结构化 `*.decision.json`（存放至 `{decision_target}`）并用 `decisions_client.py --validate-only` 校验通过；若连代码 Diff 语义裁决也不适用，再切换渲染紧凑型 Generative UI 卡片供用户选择写入规范/忽略。"
    )


def _build_reason_auto_decision(workspace: str, scope_choice: str, scope_conf: float) -> str:
    target_dir = (
        PLUGIN_DIR / "decisions"
        if scope_choice == "universal"
        else Path(workspace) / "scripts" / "lints"
    )
    scope_label = "全局通用 Decision（插件内部）" if scope_choice == "universal" else "项目专属 Decision（与 Lint 同目录）"
    validator = PLUGIN_DIR / "skills" / "a8-judge" / "scripts" / "decisions_client.py"
    return (
        f"[a8-agent-mind Stop Hook -> AUTO_DECISION] Decisions API 判定本轮问题不适合静态正则/AST 硬匹配，"
        f"最适合直接沉淀为结构化语义 Decision（{scope_label}，作用域置信度 {scope_conf:.2f}）。\n"
        f"请在 `{target_dir}` 下新增 `<snake_case_id>.decision.json`（格式含 `id`、`name`、`category`、`enabled: true`、`triggers`、`file_patterns`、`question.type=\"choice\"`、`question.instructions`、`question.criteria.passed/violated`、`why`），并严格执行：\n"
        f"1. 立即执行 `py -3 \"{validator}\" \"{workspace}\" --validate-only` 验证 JSON 格式与加载全绿（0 errors）；\n"
        f"2. 校验通过后在回复中简洁说明新增 Decision 的物理路径、拦截范围与触发条件；\n"
        f"3. 若发现该问题其实无法通过代码 Diff 语义裁决，立即撤回该 JSON 并切换渲染紧凑型 Generative UI 卡片供用户选择写入 Markdown 规则或忽略。"
    )


def _build_reason_ask_ui(workspace: str, artifact_dir: str, scope_choice: str, scope_conf: float) -> str:
    universal_rule = PLUGIN_DIR / "rules" / "mind-rules.md"
    project_rule = Path(workspace) / ".agents" / "rules" / "redline.md"
    lint_dir = Path(workspace) / "scripts" / "lints"
    global_decision_dir = PLUGIN_DIR / "decisions"
    rec_label = (
        f"推荐：通用规范 (`{universal_rule}`)"
        if scope_choice == "universal"
        else f"推荐：项目红线 (`{project_rule}`)"
    )
    card_path = Path(artifact_dir) / "reflect_card.html" if artifact_dir else Path("reflect_card.html")
    return (
        f"[a8-agent-mind Stop Hook -> ASK_USER_UI] Decisions API 判定本轮出现值得沉淀的经验/纠偏，"
        f"暂未直接自动落盘（作用域参考：{rec_label}，置信度 {scope_conf:.2f}）。\n"
        f"请参考 `{PLUGIN_DIR / 'skills' / 'a8-improve' / 'templates' / 'retro_card.html'}` 样式约束，"
        f"在 `{card_path}` 生成紧凑型 Generative UI 确认卡并用 `<agent-embed>` 展示，清晰区分三层沉淀路径与作用域让用户拍板：\n"
        f"- 选项 1：写入全局通用规范（跨仓库适用） -> `{universal_rule}`\n"
        f"- 选项 2：写入本项目专属红线 -> `{project_rule}`\n"
        f"- 选项 3：沉淀为结构化 Decision（全局 `{global_decision_dir}` 或项目 `{lint_dir}`）\n"
        f"- 选项 4：转化为确定性项目 Lint 检查 -> `{lint_dir}`\n"
        f"- 选项 5：仅本次处理，不写入规则\n"
        f"卡片展示完成后停步等待用户确认，未经同意禁止擅自写入规则文件。"
    )


def _build_reason_docs_sync(
    workspace: str,
    non_doc_files: list[str],
    choice: str,
    conf: float,
    threshold: float,
    api_error: str = "",
) -> str:
    docs_dir = Path(workspace) / "docs"
    agents_map = Path(workspace) / "AGENTS.md"
    preview = ", ".join(non_doc_files[:6])
    if len(non_doc_files) > 6:
        preview += f" 等共 {len(non_doc_files)} 个文件"
    if api_error:
        judge_desc = f"Decisions API 未返回明确免检结论（{api_error}）"
    else:
        judge_desc = f"Decisions API 未明确判定免检（choice={choice}, confidence={conf:.2f}, 豁免阈值={threshold:.2f}）"
    return (
        f"[a8-agent-mind Stop Hook -> DOCS_MAINTENANCE] 本轮修改了非文档文件（{preview}），"
        f"但未检测到对 `docs/` 的维护；{judge_desc}。\n"
        f"按“仅明确不需要时方可豁免”原则，请立即核查并闭环文档维护：\n"
        f"1. 检查本次累积改动是否触及架构/生命周期变更、系统边界/依赖拓扑、外部契约/状态模型、Hook/工作流机制或深层机制故障复盘；\n"
        f"2. 若需要维护文档，请立即在 `{docs_dir}` 新增或更新长期文档（`YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`），"
        f"并同步更新 `{agents_map}` 索引表（涉及跨仓拓扑变化时同步更新 `a8-agent-mind/repos.md`）；\n"
        f"3. 若经核实确属轻量变更无需入库 `docs/`，请向用户明确说明免建档理由后结束。"
    )


def _safe_confidence(answer: dict | None) -> float:
    if not isinstance(answer, dict):
        return 0.0
    try:
        return float(answer.get("confidence", 0.0))
    except (TypeError, ValueError):
        return 0.0


def evaluate_stop_payload(payload: dict) -> dict:
    if payload.get("continuationActive") is True:
        return {}
    if payload.get("terminationReason", "NO_TOOL_CALL") != "NO_TOOL_CALL" or payload.get("error"):
        return {}

    conv_id = str(payload.get("conversationId") or "default")
    turn = _extract_recent_turn_summary(
        str(payload.get("transcriptPath") or ""),
        str(payload.get("lastUserInput") or ""),
    )

    # Skip pure conversational / lookup turns with no edits, no failures, and no correction hints
    if not turn["edited_files"] and not turn["failed_commands"] and not turn["has_correction_hint"]:
        return {}

    state = _load_state()
    if state.get(conv_id) == turn["turn_fingerprint"]:
        return {}

    raw_edited = turn["all_edited_files"] if "all_edited_files" in turn else turn["edited_files"]
    _, needs_docs_check, non_doc_files = _analyze_doc_maintenance(raw_edited)

    input_summary = (
        f"User input:\n{turn['user_text']}\n\n"
        f"Edited files ({len(turn['edited_files'])}): {', '.join(turn['edited_files']) or 'none'}\n"
        f"Failed commands ({len(turn['failed_commands'])}): {'; '.join(turn['failed_commands']) or 'none'}\n\n"
        f"Assistant summary:\n{turn['assistant_tail']}"
    )[:8000]

    questions = dict(REFLECT_QUESTIONS)
    if needs_docs_check:
        questions["docs_maintenance_needed"] = DOCS_MAINTENANCE_QUESTION

    config = load_api_config(PLUGIN_DIR)
    threshold = float(config.get("confidence_threshold", 0.85))
    api_res = call_decisions_api(input_summary, questions, PLUGIN_DIR, config=config)

    if not api_res.get("ok"):
        # For background reflection alone, fail-open when API/key is unavailable.
        # When non-doc files changed without docs/ edits, absence of explicit "no" triggers a one-shot docs check prompt.
        if not needs_docs_check:
            return {}
        state[conv_id] = turn["turn_fingerprint"]
        _save_state(state)
        workspace = _pick_workspace(payload, non_doc_files)
        append_harness_metric(
            {
                "source": "stop_hook",
                "mode": "API_ERROR",
                "repo": Path(workspace).name or "workspace",
                "verdict": "continue",
                "confidence": 0.0,
                "docs_choice": "unknown",
            }
        )
        return {
            "decision": "continue",
            "reason": _build_reason_docs_sync(
                workspace,
                non_doc_files,
                "unknown",
                0.0,
                threshold,
                api_error=str(api_res.get("summary") or "Decisions API 不可用"),
            ),
        }

    answers = (api_res.get("response") or {}).get("answers") or {}
    lesson_ans = answers.get("has_reusable_lesson") or {}
    lint_ans = answers.get("can_be_machine_lint") or {}
    decision_ans = answers.get("can_be_semantic_decision") or {}
    scope_ans = answers.get("rule_scope") or {}

    lesson_conf = _safe_confidence(lesson_ans)
    lint_conf = _safe_confidence(lint_ans)
    decision_conf = _safe_confidence(decision_ans)
    scope_conf = _safe_confidence(scope_ans)

    state[conv_id] = turn["turn_fingerprint"]
    _save_state(state)

    workspace = _pick_workspace(payload, non_doc_files or raw_edited)
    reasons: list[str] = []
    triggered_modes: list[str] = []

    if lesson_ans.get("choice") == "yes" and lesson_conf >= threshold:
        scope_choice = scope_ans.get("choice") if scope_ans.get("choice") in ("universal", "project_specific") else "project_specific"
        artifact_dir = str(payload.get("artifactDirectoryPath") or "")
        if lint_ans.get("choice") == "yes" and lint_conf >= 0.80:
            triggered_modes.append("AUTO_LINT")
            reasons.append(_build_reason_auto_lint(workspace, scope_choice))
        elif decision_ans.get("choice") == "yes" and decision_conf >= 0.80 and scope_conf >= 0.70:
            triggered_modes.append("AUTO_DECISION")
            reasons.append(_build_reason_auto_decision(workspace, scope_choice, scope_conf))
        else:
            triggered_modes.append("ASK_USER_UI")
            reasons.append(_build_reason_ask_ui(workspace, artifact_dir, scope_choice, scope_conf))

    docs_choice = ""
    docs_conf = 0.0
    if needs_docs_check:
        docs_ans = answers.get("docs_maintenance_needed") or {}
        docs_choice = str(docs_ans.get("choice") or "").strip()
        docs_conf = _safe_confidence(docs_ans)
        # Only skip when Decisions API explicitly judges documentation maintenance as unnecessary ("no" >= threshold)
        if not (docs_choice == "no" and docs_conf >= threshold):
            triggered_modes.append("DOCS_MAINTENANCE")
            reasons.append(
                _build_reason_docs_sync(
                    workspace,
                    non_doc_files,
                    docs_choice or "unknown",
                    docs_conf,
                    threshold,
                )
            )

    metric_conf = docs_conf if needs_docs_check and docs_conf > 0 else lesson_conf
    append_harness_metric(
        {
            "source": "stop_hook",
            "mode": "+".join(triggered_modes) if triggered_modes else "PASS",
            "repo": Path(workspace).name or "workspace",
            "verdict": "continue" if reasons else "allow",
            "confidence": round(metric_conf, 4),
            "docs_choice": docs_choice,
            "lesson_choice": str(lesson_ans.get("choice") or "").strip(),
        }
    )

    if not reasons:
        return {}

    return {
        "decision": "continue",
        "reason": "\n\n---\n\n".join(reasons),
    }


def main() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    try:
        if len(sys.argv) >= 3 and sys.argv[1] == "--dry-run":
            raw = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
        else:
            raw = sys.stdin.read()

        if not raw.strip():
            print("{}")
            return

        payload = json.loads(raw)
        if not isinstance(payload, dict):
            print("{}")
            return

        result = evaluate_stop_payload(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print("{}")


if __name__ == "__main__":
    main()
