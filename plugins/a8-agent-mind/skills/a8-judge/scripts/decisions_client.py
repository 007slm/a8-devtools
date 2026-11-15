#!/usr/bin/env python3
"""
decisions_client.py - Native caller for Google Gemini Decisions API (gemini-decision-1).
Evaluates Git Diff against global (plugins/a8-agent-mind/decisions/*.decision.json) and
project-level (<repo>/scripts/lints/*.decision.json) specifications using lossless multi-call
diff chunking and question batching (never dropping rules or truncating diffs).
"""

import concurrent.futures
import copy
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from judge_router import (
    ALL_CATEGORIES,
    decision_matches_diff,
    extract_diff_file_paths,
    get_git_diff,
    load_all_decisions,
    load_rules,
    parse_judge_cli_args,
    resolve_workspace_root,
)

# Per-request chunking / batching strides (multi-call splitting; never truncates or drops)
CHUNK_DIFF_CHARS = 28000
BATCH_QUESTION_CHARS = 6000
BATCH_MAX_QUESTIONS = 12
MAX_CONCURRENT_API_CALLS = 4

ENV_VAR_PATTERN = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")
VALID_VERDICTS = ("PASSED", "VIOLATED", "REQUIRES_APPROVAL")
REQUIRED_VIOLATION_KEYS = ("rule_id", "file_path", "violation_reason", "actionable_fix")


def _resolve_api_key(raw_value: str) -> str:
    """Expands ${ENV_VAR} placeholders or falls back to GEMINI_API_KEY env var."""
    val = (raw_value or "").strip()
    if val:
        m = ENV_VAR_PATTERN.match(val)
        if m:
            return os.environ.get(m.group(1), "").strip()
        if not val.startswith("${"):
            return val
    return os.environ.get("GEMINI_API_KEY", "").strip()


def load_api_config(plugin_dir: Path) -> dict:
    """Loads API key and settings from config.json and expands env placeholders."""
    config = {
        "api_key": "",
        "model": "gemini-decision-1",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/decisions",
        "timeout_seconds": 15,
        "confidence_threshold": 0.85,
    }
    config_file = plugin_dir / "config.json"
    if config_file.is_file():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                disk_conf = json.load(f)
                config.update(disk_conf)
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to parse {config_file}: {e}\n")

    config["api_key"] = _resolve_api_key(str(config.get("api_key", "")))
    return config


def resolve_plugin_data_dir() -> Path:
    """Returns canonical plugin runtime data directory (PLUGIN_DATA or ~/.gemini/antigravity/plugin_data/a8-agent-mind)."""
    base = os.environ.get("PLUGIN_DATA", "").strip()
    root = Path(base) if base else Path.home() / ".gemini" / "antigravity" / "plugin_data" / "a8-agent-mind"
    root.mkdir(parents=True, exist_ok=True)
    return root


def append_harness_metric(event: dict, max_entries: int = 200) -> None:
    """Appends a bounded observability record to harness_metrics.jsonl."""
    try:
        metrics_file = resolve_plugin_data_dir() / "harness_metrics.jsonl"
        now_dt = datetime.now()
        record = {
            "ts": int(event.get("ts") or time.time()),
            "date": str(event.get("date") or now_dt.strftime("%Y-%m-%d")),
            "source": str(event.get("source") or ""),
            "mode": str(event.get("mode") or ""),
            "repo": str(event.get("repo") or ""),
            "verdict": str(event.get("verdict") or ""),
            "confidence": round(float(event.get("confidence", 0.0) or 0.0), 4),
            "docs_choice": str(event.get("docs_choice") or ""),
            "lesson_choice": str(event.get("lesson_choice") or ""),
        }
        existing: list[str] = []
        if metrics_file.is_file():
            existing = [
                ln.strip()
                for ln in metrics_file.read_text(encoding="utf-8", errors="replace").splitlines()
                if ln.strip()
            ]
        existing.append(json.dumps(record, ensure_ascii=False))
        if len(existing) > max_entries:
            existing = existing[-max_entries:]
        metrics_file.write_text("\n".join(existing) + "\n", encoding="utf-8")
    except Exception:
        # Telemetry must never abort core hook or judge execution
        pass


def empty_evaluated_categories(evaluated: bool = False, passed: bool = False) -> dict:
    """Returns a complete 4-category evaluation map matching verdict.json."""
    return {
        cat: {
            "evaluated": evaluated,
            "passed": passed,
            "violations": [],
        }
        for cat in ALL_CATEGORIES
    }


def fail_closed_verdict(status: str, summary: str, **extra) -> dict:
    """Builds a schema-compliant fail-closed REQUIRES_APPROVAL verdict."""
    result = {
        "status": status,
        "verdict": "REQUIRES_APPROVAL",
        "confidence_score": 0.0,
        "summary": summary,
        "api_calls_count": 0,
        "diff_chunks_count": 0,
        "evaluated_decisions": [],
        "evaluated_categories": empty_evaluated_categories(evaluated=False, passed=False),
        "violations": [],
    }
    result.update(extra)
    return result


def validate_verdict_schema(verdict_obj: dict) -> list[str]:
    """Validates verdict_obj against verdict.json required fields and constraints using stdlib."""
    errors = []
    for req_root in ("verdict", "confidence_score", "summary", "evaluated_categories"):
        if req_root not in verdict_obj:
            errors.append(f"Missing root key: {req_root}")

    v = verdict_obj.get("verdict")
    if v not in VALID_VERDICTS:
        errors.append(f"Invalid verdict enum: {v}")

    score = verdict_obj.get("confidence_score")
    if not isinstance(score, (int, float)) or isinstance(score, bool) or not (0.0 <= float(score) <= 1.0):
        errors.append(f"Invalid confidence_score: {score}")

    if not isinstance(verdict_obj.get("summary"), str):
        errors.append("summary must be a string")

    cats = verdict_obj.get("evaluated_categories")
    if not isinstance(cats, dict):
        errors.append("evaluated_categories must be an object")
        return errors

    for cat_key in ALL_CATEGORIES:
        cat_val = cats.get(cat_key)
        if not isinstance(cat_val, dict):
            errors.append(f"Missing category object: {cat_key}")
            continue
        for req_cat_key in ("evaluated", "passed", "violations"):
            if req_cat_key not in cat_val:
                errors.append(f"Category {cat_key} missing key: {req_cat_key}")
        if not isinstance(cat_val.get("evaluated"), bool) or not isinstance(cat_val.get("passed"), bool):
            errors.append(f"Category {cat_key} evaluated/passed must be boolean")
        viols = cat_val.get("violations")
        if not isinstance(viols, list):
            errors.append(f"Category {cat_key} violations must be array")
            continue
        for idx, item in enumerate(viols):
            if not isinstance(item, dict):
                errors.append(f"Category {cat_key} violation[{idx}] must be object")
                continue
            for rk in REQUIRED_VIOLATION_KEYS:
                if not isinstance(item.get(rk), str):
                    errors.append(f"Category {cat_key} violation[{idx}] missing string {rk}")
    return errors


def _split_oversized_file_block(file_block: str, file_path: str, max_chars: int) -> list[dict]:
    """Splits a single oversized file diff at hunk boundaries (or lines) keeping file header context."""
    lines = file_block.splitlines(keepends=True)
    header_lines: list[str] = []
    body_start = 0
    for idx, line in enumerate(lines):
        if line.startswith("@@ "):
            body_start = idx
            break
        header_lines.append(line)
    else:
        body_start = len(lines)

    header = "".join(header_lines)
    if len(header) >= max_chars:
        header = header[: max_chars // 4]
    hunk_budget = max(512, max_chars - len(header))

    # Group body lines into hunk blocks starting at "@@ "
    hunks: list[str] = []
    cur: list[str] = []
    for line in lines[body_start:]:
        if line.startswith("@@ ") and cur:
            hunks.append("".join(cur))
            cur = [line]
        else:
            cur.append(line)
    if cur:
        hunks.append("".join(cur))
    if not hunks:
        hunks = [""]

    out: list[dict] = []
    acc = ""
    for hunk in hunks:
        if len(hunk) > hunk_budget:
            if acc:
                out.append({"files": [file_path] if file_path else [], "text": f"{header}{acc}"})
                acc = ""
            # Split single huge hunk cleanly on line boundaries
            piece = ""
            for hline in hunk.splitlines(keepends=True):
                if len(hline) > hunk_budget:
                    # Extreme minified line: slice deterministically without dropping
                    for pos in range(0, len(hline), hunk_budget):
                        seg = hline[pos : pos + hunk_budget]
                        out.append({"files": [file_path] if file_path else [], "text": f"{header}{seg}"})
                    continue
                if len(piece) + len(hline) > hunk_budget and piece:
                    out.append({"files": [file_path] if file_path else [], "text": f"{header}{piece}"})
                    piece = hline
                else:
                    piece += hline
            if piece:
                out.append({"files": [file_path] if file_path else [], "text": f"{header}{piece}"})
            continue

        if acc and len(acc) + len(hunk) > hunk_budget:
            out.append({"files": [file_path] if file_path else [], "text": f"{header}{acc}"})
            acc = hunk
        else:
            acc += hunk

    if acc:
        out.append({"files": [file_path] if file_path else [], "text": f"{header}{acc}"})
    return out


def split_diff_into_chunks(diff_text: str, max_chars: int = CHUNK_DIFF_CHARS) -> list[dict]:
    """Splits a unified diff losslessly along file/hunk boundaries so 100% of changes are evaluated."""
    if not diff_text.strip():
        return []
    if len(diff_text) <= max_chars:
        return [{
            "chunk_index": 0,
            "files": extract_diff_file_paths(diff_text),
            "text": diff_text,
        }]

    lines = diff_text.splitlines(keepends=True)
    file_blocks: list[str] = []
    cur_block: list[str] = []
    for line in lines:
        if line.startswith("diff --git ") and cur_block:
            file_blocks.append("".join(cur_block))
            cur_block = [line]
        else:
            cur_block.append(line)
    if cur_block:
        file_blocks.append("".join(cur_block))

    # Fallback when diff_text is raw snippet without "diff --git " headers
    if len(file_blocks) == 1 and not file_blocks[0].startswith("diff --git "):
        chunks: list[dict] = []
        acc = ""
        for line in lines:
            if len(line) > max_chars:
                if acc:
                    chunks.append({"chunk_index": len(chunks), "files": extract_diff_file_paths(acc), "text": acc})
                    acc = ""
                for pos in range(0, len(line), max_chars):
                    seg = line[pos : pos + max_chars]
                    chunks.append({"chunk_index": len(chunks), "files": [], "text": seg})
                continue
            if acc and len(acc) + len(line) > max_chars:
                chunks.append({"chunk_index": len(chunks), "files": extract_diff_file_paths(acc), "text": acc})
                acc = line
            else:
                acc += line
        if acc:
            chunks.append({"chunk_index": len(chunks), "files": extract_diff_file_paths(acc), "text": acc})
        return chunks

    chunks = []
    cur_text = ""
    cur_files: list[str] = []
    for blk in file_blocks:
        blk_files = extract_diff_file_paths(blk)
        blk_file = blk_files[0] if blk_files else ""
        if len(blk) > max_chars:
            if cur_text:
                chunks.append({"chunk_index": len(chunks), "files": cur_files, "text": cur_text})
                cur_text = ""
                cur_files = []
            for sub in _split_oversized_file_block(blk, blk_file, max_chars):
                sub["chunk_index"] = len(chunks)
                chunks.append(sub)
            continue

        if cur_text and len(cur_text) + len(blk) > max_chars:
            chunks.append({"chunk_index": len(chunks), "files": cur_files, "text": cur_text})
            cur_text = blk
            cur_files = list(blk_files)
        else:
            cur_text += blk
            for fp in blk_files:
                if fp not in cur_files:
                    cur_files.append(fp)

    if cur_text:
        chunks.append({"chunk_index": len(chunks), "files": cur_files, "text": cur_text})
    return chunks


def _pack_question_batches(
    questions_map: dict[str, dict],
    max_chars: int = BATCH_QUESTION_CHARS,
    max_items: int = BATCH_MAX_QUESTIONS,
) -> list[dict[str, dict]]:
    """Groups questions into lossless batches without dropping any entry."""
    if not questions_map:
        return []
    batches: list[dict[str, dict]] = []
    cur_batch: dict[str, dict] = {}
    cur_chars = 0

    for q_key, q_val in questions_map.items():
        item_size = len(json.dumps({q_key: q_val}, ensure_ascii=False))
        if cur_batch and (cur_chars + item_size > max_chars or len(cur_batch) >= max_items):
            batches.append(cur_batch)
            cur_batch = {}
            cur_chars = 0
        cur_batch[q_key] = q_val
        cur_chars += item_size

    if cur_batch:
        batches.append(cur_batch)
    return batches


def _build_category_question_parts(
    cat: str,
    base_decision: dict,
    cat_rules: list[dict],
) -> list[tuple[str, dict]]:
    """Builds 1..N question parts for a category so dynamic prose rules are never truncated."""
    base_q = copy.deepcopy(base_decision["question"])
    if not cat_rules:
        return [(cat, base_q)]

    base_rules_header = " Enforce dynamic rules:"
    parts: list[tuple[str, dict]] = []
    cur_q = copy.deepcopy(base_q)
    cur_labels: list[str] = []
    part_idx = 0

    for r in cat_rules:
        label = str(r.get("name") or r.get("id") or "rule").strip()
        desc = (r.get("description") or "").strip().replace("\n", " ")[:180]
        if not desc:
            continue
        snippet = f" | [{label}]: {desc}"
        projected = len(cur_q["instructions"]) + len(snippet) + (0 if cur_labels else len(base_rules_header))
        if cur_labels and projected > BATCH_QUESTION_CHARS:
            cur_q["criteria"]["violated"] += (
                f" Or breaches enforced rules in [{cat}]: {', '.join(cur_labels)}."
            )
            key = cat if part_idx == 0 else f"{cat}__part{part_idx}"
            parts.append((key, cur_q))
            part_idx += 1
            cur_q = copy.deepcopy(base_q)
            cur_labels = []

        if not cur_labels:
            cur_q["instructions"] += base_rules_header
        cur_q["instructions"] += snippet
        cur_labels.append(label)

    if cur_labels:
        cur_q["criteria"]["violated"] += (
            f" Or breaches enforced rules in [{cat}]: {', '.join(cur_labels)}."
        )
    key = cat if part_idx == 0 else f"{cat}__part{part_idx}"
    parts.append((key, cur_q))
    return parts


def _base_category_from_question_key(q_key: str) -> str:
    if "__part" in q_key:
        return q_key.split("__part", 1)[0]
    return q_key


def call_decisions_api(
    input_text: str,
    questions: dict,
    plugin_dir: Path,
    config: dict = None,
) -> dict:
    """Posts an input + questions payload to Google Gemini Decisions API and returns a normalized wrapper."""
    cfg = config if config is not None else load_api_config(plugin_dir)
    api_key = cfg.get("api_key", "")
    if not api_key:
        return {
            "ok": False,
            "status": "error",
            "summary": "Missing GEMINI_API_KEY env var (or valid non-placeholder api_key).",
        }

    payload = {
        "model": cfg.get("model", "gemini-decision-1"),
        "input": input_text,
        "questions": questions,
    }
    url = f"{cfg.get('endpoint', 'https://generativelanguage.googleapis.com/v1beta/decisions')}?key={api_key}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    timeout = cfg.get("timeout_seconds", 15)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_res = json.loads(resp.read().decode("utf-8"))
            return {"ok": True, "response": raw_res, "config": cfg}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "ignore")
        return {
            "ok": False,
            "status": "api_error",
            "summary": f"Decisions API HTTP error {e.code}",
            "http_code": e.code,
            "error_detail": err_body,
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "network_error",
            "summary": f"Decisions API network error: {e}",
            "error": str(e),
        }


def _run_api_tasks(tasks: list[dict], plugin_dir: Path, config: dict) -> list[dict]:
    """Executes all (chunk, batch) Decisions API requests with bounded concurrency."""
    if not tasks:
        return []
    if len(tasks) == 1:
        t = tasks[0]
        res = call_decisions_api(t["input_text"], t["questions"], plugin_dir, config=config)
        return [{**t, "api_res": res}]

    results: list[dict | None] = [None] * len(tasks)
    max_workers = min(MAX_CONCURRENT_API_CALLS, len(tasks))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {
            pool.submit(call_decisions_api, t["input_text"], t["questions"], plugin_dir, config): idx
            for idx, t in enumerate(tasks)
        }
        for fut in concurrent.futures.as_completed(future_map):
            idx = future_map[fut]
            results[idx] = {**tasks[idx], "api_res": fut.result()}
    return [r for r in results if r is not None]


def evaluate_decisions(
    diff_text: str,
    activated_categories: list,
    plugin_dir: Path,
    diff_meta: dict = None,
    workspace_dir: str | Path | None = None,
) -> dict:
    """Calls Gemini Decisions API across all diff chunks and all global + project Decisions."""
    if not diff_text.strip():
        return fail_closed_verdict(
            "error",
            "No diff content provided to evaluate_decisions; refusing to fabricate PASSED.",
        )

    config = load_api_config(plugin_dir)
    threshold = float(config.get("confidence_threshold", 0.85))
    all_decisions, load_errors = load_all_decisions(plugin_dir, workspace_dir=workspace_dir)
    if load_errors:
        return fail_closed_verdict(
            "error",
            f"Malformed *.decision.json specification(s): {'; '.join(load_errors)}",
            decision_load_errors=load_errors,
        )

    decisions_by_id = {d["id"]: d for d in all_decisions}
    missing_core = [c for c in ALL_CATEGORIES if c not in decisions_by_id]
    if missing_core:
        return fail_closed_verdict(
            "error",
            f"Missing global core decision file(s) under decisions/: {missing_core}",
        )

    requested_cats = [c.strip() for c in activated_categories if c and c.strip() in ALL_CATEGORIES]
    if not requested_cats:
        requested_cats = list(ALL_CATEGORIES.keys())
    target_categories = [c for c in requested_cats if decisions_by_id[c].get("enabled", True)]

    dynamic_rules = load_rules(plugin_dir, workspace_dir=workspace_dir)
    rules_by_cat: dict[str, list[dict]] = {c: [] for c in ALL_CATEGORIES}
    for r in dynamic_rules:
        c = r.get("category")
        if c in rules_by_cat:
            rules_by_cat[c].append(r)

    category_questions_pool: dict[str, dict] = {}
    for cat in target_categories:
        for q_key, q_val in _build_category_question_parts(cat, decisions_by_id[cat], rules_by_cat[cat]):
            category_questions_pool[q_key] = q_val

    custom_decisions = [d for d in all_decisions if d["id"] not in ALL_CATEGORIES and d.get("enabled", True)]
    diff_chunks = split_diff_into_chunks(diff_text, max_chars=CHUNK_DIFF_CHARS)
    diff_files = extract_diff_file_paths(diff_text)
    omitted_files = (diff_meta or {}).get("omitted_files", [])

    api_tasks: list[dict] = []
    decision_records: dict[str, dict] = {}
    for cat in target_categories:
        d = decisions_by_id[cat]
        decision_records[d["id"]] = {
            "id": d["id"],
            "name": d["name"],
            "scope": d.get("scope", "global"),
            "repo": d.get("repo", "a8-agent-mind"),
            "category": d["category"],
            "evaluated": False,
            "passed": True,
            "confidence": 1.0,
            "chunks_evaluated": 0,
            "violations": [],
        }

    for chunk in diff_chunks:
        chunk_questions = dict(category_questions_pool)
        chunk_matched_custom: list[dict] = []
        for cd in custom_decisions:
            if decision_matches_diff(cd, chunk["text"], chunk["files"]):
                chunk_questions[cd["id"]] = cd["question"]
                chunk_matched_custom.append(cd)
                if cd["id"] not in decision_records:
                    decision_records[cd["id"]] = {
                        "id": cd["id"],
                        "name": cd["name"],
                        "scope": cd.get("scope", "project"),
                        "repo": cd.get("repo", ""),
                        "category": cd["category"],
                        "evaluated": False,
                        "passed": True,
                        "confidence": 1.0,
                        "chunks_evaluated": 0,
                        "violations": [],
                    }

        for batch in _pack_question_batches(chunk_questions):
            api_tasks.append({
                "chunk": chunk,
                "questions": batch,
                "input_text": f"Code Diff to review (chunk {chunk['chunk_index'] + 1}/{len(diff_chunks)}):\n\n{chunk['text']}",
            })

    if not api_tasks:
        return fail_closed_verdict(
            "skipped",
            "All matching decision specifications are disabled; nothing evaluated.",
        )

    repo_label = Path(workspace_dir).name if workspace_dir else "global"
    executed = _run_api_tasks(api_tasks, plugin_dir, config)
    for item in executed:
        if not item["api_res"].get("ok"):
            api_res = item["api_res"]
            extra = {k: v for k, v in api_res.items() if k not in ("ok", "status", "summary")}
            append_harness_metric(
                {
                    "source": "a8_judge",
                    "mode": str(api_res.get("status") or "API_ERROR").upper(),
                    "repo": repo_label,
                    "verdict": "ERROR",
                    "confidence": 0.0,
                }
            )
            return fail_closed_verdict(api_res["status"], api_res["summary"], **extra)

    evaluated_categories = empty_evaluated_categories(evaluated=False, passed=False)
    for cat in target_categories:
        evaluated_categories[cat] = {"evaluated": True, "passed": True, "violations": []}

    all_violations: list[dict] = []
    overall_confidence = 1.0
    tokens_evaluated = 0
    missing_answers: list[str] = []

    for item in executed:
        chunk = item["chunk"]
        chunk_files = chunk["files"] or diff_files or ["workspace"]
        primary_file = chunk_files[0]
        raw_res = item["api_res"]["response"]
        usage = raw_res.get("usage") or {}
        tokens_evaluated += int(usage.get("total_input_tokens", 0) or 0)
        answers = raw_res.get("answers") or {}

        for q_key in item["questions"]:
            base_id = _base_category_from_question_key(q_key)
            rec = decision_records.get(base_id)
            ans = answers.get(q_key)
            if not isinstance(ans, dict) or ans.get("choice") not in ("passed", "violated"):
                missing_answers.append(q_key)
                overall_confidence = 0.0
                if base_id in evaluated_categories:
                    evaluated_categories[base_id]["evaluated"] = False
                    evaluated_categories[base_id]["passed"] = False
                continue

            choice = ans.get("choice")
            try:
                conf = max(0.0, min(1.0, float(ans.get("confidence", 0.0))))
            except (TypeError, ValueError):
                conf = 0.0
            overall_confidence = min(overall_confidence, conf)

            cat_key = rec["category"] if rec else base_id
            if rec:
                rec["evaluated"] = True
                rec["chunks_evaluated"] += 1
                rec["confidence"] = min(rec["confidence"], conf)

            if choice == "violated":
                probs = ans.get("probabilities", {})
                v_file = (
                    f"{primary_file} (+{len(chunk_files) - 1} files, chunk {chunk['chunk_index'] + 1})"
                    if len(chunk_files) > 1
                    else primary_file
                )
                rule_id = (
                    f"REDLINE_{base_id.upper()}"
                    if base_id in ALL_CATEGORIES
                    else f"DECISION_{base_id.upper()}"
                )
                v_item = {
                    "rule_id": rule_id,
                    "file_path": v_file,
                    "line_hint": f"chunk {chunk['chunk_index'] + 1}/{len(diff_chunks)}",
                    "violation_reason": (
                        f"Gemini Decisions API calibrated violation in [{base_id}] "
                        f"(confidence={conf:.4f}, probabilities={json.dumps(probs, ensure_ascii=False)})."
                    ),
                    "actionable_fix": (
                        f"Inspect changed files ({', '.join(chunk_files[:5])}) against decision [{base_id}] "
                        f"and fix the violating code before submitting."
                    ),
                }
                all_violations.append(v_item)
                if cat_key in evaluated_categories:
                    evaluated_categories[cat_key]["passed"] = False
                    evaluated_categories[cat_key]["violations"].append(v_item)
                if rec:
                    rec["passed"] = False
                    rec["violations"].append(v_item)

    evaluated_decisions_list = []
    for rec in decision_records.values():
        out_rec = {k: v for k, v in rec.items() if k != "violations"}
        out_rec["confidence"] = round(float(rec["confidence"]), 4)
        evaluated_decisions_list.append(out_rec)

    if all_violations:
        verdict_str = "VIOLATED"
        summary_str = (
            f"Detected {len(all_violations)} architectural/decision violation(s) "
            f"across {len(diff_chunks)} diff chunk(s) and {len(executed)} API call(s)."
        )
    elif missing_answers:
        verdict_str = "REQUIRES_APPROVAL"
        overall_confidence = 0.0
        summary_str = f"Fail-closed: Decisions API response missing keys {missing_answers}."
    elif overall_confidence < threshold:
        verdict_str = "REQUIRES_APPROVAL"
        summary_str = (
            f"Calibrated confidence ({overall_confidence:.4f}) is below threshold ({threshold:.2f}); manual review required."
        )
    elif omitted_files:
        verdict_str = "REQUIRES_APPROVAL"
        summary_str = (
            f"Oversized or binary untracked file(s) omitted from evaluation: {omitted_files}; manual check required."
        )
    else:
        verdict_str = "PASSED"
        summary_str = (
            f"All {len(evaluated_decisions_list)} decision(s) passed across "
            f"{len(diff_chunks)} lossless diff chunk(s) ({len(executed)} API call(s))."
        )

    verdict_obj = {
        "verdict": verdict_str,
        "confidence_score": round(overall_confidence, 4),
        "summary": summary_str,
        "engine": config.get("model", "gemini-decision-1"),
        "api_type": "Decisions API (Zero Output Token, Lossless Multi-Call)",
        "tokens_evaluated": tokens_evaluated,
        "api_calls_count": len(executed),
        "diff_chunks_count": len(diff_chunks),
        "diff_truncated": False,
        "omitted_files": omitted_files,
        "dropped_rules": [],
        "evaluated_decisions": evaluated_decisions_list,
        "evaluated_categories": evaluated_categories,
        "violations": all_violations,
    }
    schema_errors = validate_verdict_schema(verdict_obj)
    if schema_errors:
        append_harness_metric(
            {
                "source": "a8_judge",
                "mode": "SCHEMA_ERROR",
                "repo": repo_label,
                "verdict": "REQUIRES_APPROVAL",
                "confidence": 0.0,
            }
        )
        return fail_closed_verdict(
            "schema_error",
            f"Verdict failed schema validation: {schema_errors}",
            raw_verdict=verdict_str,
        )
    append_harness_metric(
        {
            "source": "a8_judge",
            "mode": verdict_str,
            "repo": repo_label,
            "verdict": verdict_str,
            "confidence": round(overall_confidence, 4),
        }
    )
    return verdict_obj


def _load_diff_from_arg(
    target_arg: str,
    include_last_commit: bool = False,
    paths: list[str] | None = None,
) -> tuple[str, dict]:
    target = Path(target_arg)
    if target.is_dir():
        return get_git_diff(str(target), include_last_commit=include_last_commit, paths=paths)
    if target.is_file():
        return target.read_text(encoding="utf-8", errors="replace"), {
            "diff_source": "file",
            "omitted_files": [],
        }
    raise FileNotFoundError(f"Input path does not exist: {target_arg}")


def main():
    plugin_dir = Path(__file__).resolve().parents[3]
    cli = parse_judge_cli_args(sys.argv[1:], extra_flags=("--validate-only",))
    include_last_commit = cli["include_last_commit"]
    validate_only = "--validate-only" in cli["flags"]
    positional = cli["positional"]
    scope_paths = cli["paths"]

    if validate_only:
        ws = positional[0] if positional and positional[0] not in ("-", "--stdin") else "."
        items, errs = load_all_decisions(plugin_dir, workspace_dir=ws)
        out = {
            "ok": not errs,
            "total": len(items),
            "global_count": sum(1 for d in items if d.get("scope") == "global"),
            "project_count": sum(1 for d in items if d.get("scope") == "project"),
            "errors": errs,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
        sys.exit(0 if not errs else 2)

    diff_text = ""
    diff_meta: dict = {"diff_source": "stdin", "omitted_files": []}
    raw_categories = ""
    explicit_input_mode = False
    workspace_dir: Path | None = None

    if not positional:
        workspace_dir = resolve_workspace_root(".")
        diff_text, diff_meta = get_git_diff(".", include_last_commit=include_last_commit, paths=scope_paths)
    elif positional[0] in ("-", "--stdin"):
        explicit_input_mode = True
        workspace_dir = resolve_workspace_root(".")
        diff_text = sys.stdin.read()
        raw_categories = positional[1] if len(positional) > 1 else ""
    else:
        try:
            target_path = Path(positional[0])
            if target_path.is_file():
                explicit_input_mode = True
            workspace_dir = resolve_workspace_root(target_path)
            diff_text, diff_meta = _load_diff_from_arg(
                positional[0],
                include_last_commit=include_last_commit,
                paths=scope_paths,
            )
        except FileNotFoundError as e:
            err = fail_closed_verdict("error", str(e))
            print(json.dumps(err, ensure_ascii=False, indent=2))
            sys.exit(2)
        raw_categories = positional[1] if len(positional) > 1 else ""

    if diff_meta.get("diff_source") == "error":
        err = fail_closed_verdict("error", f"Git diff extraction failed: {diff_meta.get('error')}")
        print(json.dumps(err, ensure_ascii=False, indent=2))
        sys.exit(2)

    if not diff_text.strip():
        if explicit_input_mode:
            err = fail_closed_verdict(
                "error",
                "Empty diff provided via stdin or file; refusing to fabricate PASSED.",
            )
            print(json.dumps(err, ensure_ascii=False, indent=2))
            sys.exit(2)
        out = fail_closed_verdict(
            "skipped",
            "Working tree has no unexcluded changes to evaluate (pass --last-commit to judge HEAD~1..HEAD).",
        )
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    categories = [c.strip() for c in raw_categories.split(",") if c.strip()] if raw_categories else []
    res = evaluate_decisions(
        diff_text,
        categories,
        plugin_dir,
        diff_meta=diff_meta,
        workspace_dir=workspace_dir,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if res.get("status") in ("error", "api_error", "network_error", "schema_error"):
        sys.exit(1)


if __name__ == "__main__":
    main()
