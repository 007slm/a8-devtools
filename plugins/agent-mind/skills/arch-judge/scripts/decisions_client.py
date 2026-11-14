#!/usr/bin/env python3
"""
decisions_client.py - Native caller for Google Gemini Decisions API (gemini-decision-1).
Evaluates Git Diff against the 4 orthogonal architectural redlines with zero text tokens and calibrated probabilities.
"""

import copy
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from judge_router import ALL_CATEGORIES, get_git_diff, load_rules

MAX_DIFF_CHARS = 30000
MAX_QUESTION_CHARS = 6000
ENV_VAR_PATTERN = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")
VALID_VERDICTS = ("PASSED", "VIOLATED", "REQUIRES_APPROVAL")
REQUIRED_VIOLATION_KEYS = ("rule_id", "file_path", "violation_reason", "actionable_fix")

# 4 Orthogonal Architectural Dimensions Criteria Matrix
ARCH_QUESTIONS = {
    "lifecycle_and_evolution": {
        "type": "choice",
        "instructions": (
            "Evaluate compliance with Evolution Contract: zero unapproved backward compatibility, "
            "removal of dead/deprecated code, and clean deprecation."
        ),
        "criteria": {
            "passed": (
                "Complies with clean deprecation. Dead code, deprecated endpoints or legacy fallbacks "
                "are deleted rather than preserved secretly. No unapproved backward-compatibility layers."
            ),
            "violated": (
                "Violates rule: unapproved deprecated code, zombie backward-compatible fallback, "
                "dual-track compatibility or hidden compatibility layers introduced."
            ),
        },
    },
    "topology_and_boundaries": {
        "type": "choice",
        "instructions": (
            "Evaluate compliance with System Boundaries: client SDK zero heavy server container dependencies, "
            "strict unidirectional dependencies."
        ),
        "criteria": {
            "passed": (
                "Clean dependency hierarchy. Pure client SDK/driver has zero heavy server container libraries "
                "(Spring, Netty, Jackson, HikariCP), modules follow strict unidirectional flow."
            ),
            "violated": (
                "Violates boundary: heavy server container dependencies leaking into client SDK, "
                "or circular module dependencies."
            ),
        },
    },
    "concurrency_and_performance": {
        "type": "choice",
        "instructions": (
            "Evaluate Concurrency and Performance: no coarse-grained method-level synchronized locks "
            "on hot read paths, zero phantom polling."
        ),
        "criteria": {
            "passed": (
                "No coarse-grained method-level synchronized locks on hot read paths; uses fine-grained or lock-free "
                "mechanisms; zero phantom polling/probing."
            ),
            "violated": (
                "Method-level synchronized lock used on hot data read path, or phantom polling/probing introduced."
            ),
        },
    },
    "implementation_hygiene": {
        "type": "choice",
        "instructions": (
            "Evaluate Implementation Hygiene: single implementation path for core capabilities, "
            "no swallowed exceptions, standardized logging."
        ),
        "criteria": {
            "passed": (
                "Single implementation path for core domain logic; exceptions retain original cause without being swallowed; "
                "clean error handling."
            ),
            "violated": (
                "Dual-track parser or converter introduced, swallowed exceptions ignoring error context, "
                "or broken logging standards."
            ),
        },
    },
}


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


def build_questions(plugin_dir: Path, target_categories: list) -> tuple[dict, list[str]]:
    """Builds Decisions API questions by augmenting ARCH_QUESTIONS with dynamic rules from rules/*.md."""
    questions = {}
    rule_names_by_cat: dict[str, list[str]] = {c: [] for c in target_categories}
    dropped_rules: list[str] = []

    for cat in target_categories:
        if cat in ARCH_QUESTIONS:
            questions[cat] = copy.deepcopy(ARCH_QUESTIONS[cat])

    dynamic_rules = load_rules(plugin_dir)
    for r in dynamic_rules:
        cat = r.get("category")
        if cat not in questions:
            continue
        rule_label = str(r.get("name") or r.get("id") or "rule").strip()
        desc = (r.get("description") or "").strip().replace("\n", " ")
        if not desc:
            continue
        compact_desc = desc[:150]
        extra = f" | [{rule_label}]: {compact_desc}"
        if len(questions[cat]["instructions"]) + len(extra) <= MAX_QUESTION_CHARS:
            questions[cat]["instructions"] += extra
            rule_names_by_cat[cat].append(rule_label)
        else:
            dropped_rules.append(str(r.get("id") or rule_label))

    for cat, names in rule_names_by_cat.items():
        if names and cat in questions:
            questions[cat]["criteria"]["violated"] += (
                f" Or breaches any enforced rule in [{cat}]: {', '.join(names)}."
            )

    if dropped_rules:
        sys.stderr.write(
            f"Warning: {len(dropped_rules)} rule(s) exceeded {MAX_QUESTION_CHARS} char budget: {dropped_rules}\n"
        )

    return questions, dropped_rules


def _extract_diff_file_paths(diff_text: str) -> list:
    paths = []
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            p = line[6:].strip()
            if p and p not in paths:
                paths.append(p)
    return paths


def format_decision_verdict(
    api_response: dict,
    config: dict,
    target_categories: list,
    diff_files: list,
    diff_truncated: bool = False,
    omitted_files: list = None,
    dropped_rules: list = None,
) -> dict:
    """Transforms Decisions API raw output into ArchitectureVerdict schema (fail-closed)."""
    answers = api_response.get("answers") or {}
    usage = api_response.get("usage") or {}
    threshold = float(config.get("confidence_threshold", 0.85))
    primary_file = diff_files[0] if diff_files else "workspace"
    omitted_files = omitted_files or []
    dropped_rules = dropped_rules or []

    evaluated_categories = {}
    all_violations = []
    overall_confidence = 1.0
    missing_answers = []

    for cat_name in ALL_CATEGORIES:
        if cat_name not in target_categories:
            evaluated_categories[cat_name] = {
                "evaluated": False,
                "passed": False,
                "violations": [],
            }
            continue

        ans = answers.get(cat_name)
        if not isinstance(ans, dict) or ans.get("choice") not in ("passed", "violated"):
            missing_answers.append(cat_name)
            overall_confidence = 0.0
            evaluated_categories[cat_name] = {
                "evaluated": False,
                "passed": False,
                "violations": [],
            }
            continue

        choice = ans.get("choice")
        try:
            raw_conf = float(ans.get("confidence", 0.0))
        except (TypeError, ValueError):
            raw_conf = 0.0
        confidence = max(0.0, min(1.0, raw_conf))
        overall_confidence = min(overall_confidence, confidence)
        cat_violations = []

        if choice == "violated":
            probs = ans.get("probabilities", {})
            v_file = (
                f"{primary_file} (+{len(diff_files) - 1} files, category-level)"
                if len(diff_files) > 1
                else primary_file
            )
            v_item = {
                "rule_id": f"REDLINE_{cat_name.upper()}",
                "file_path": v_file,
                "line_hint": "category-level (git-diff)",
                "violation_reason": (
                    f"Gemini Decisions API calibrated violation in [{cat_name}] "
                    f"(confidence={confidence:.4f}, probabilities={json.dumps(probs, ensure_ascii=False)})."
                ),
                "actionable_fix": (
                    f"Inspect changed files ({', '.join(diff_files[:5]) or primary_file}) under [{cat_name}] "
                    f"with read-only tools and remove the violating compatibility/boundary/lock/duplication defect."
                ),
            }
            cat_violations.append(v_item)
            all_violations.append(v_item)

        evaluated_categories[cat_name] = {
            "evaluated": True,
            "passed": choice == "passed",
            "violations": cat_violations,
        }

    if all_violations:
        verdict_str = "VIOLATED"
        summary_str = f"Detected {len(all_violations)} architectural redline violation(s) via Google Gemini Decisions API."
    elif missing_answers:
        verdict_str = "REQUIRES_APPROVAL"
        overall_confidence = 0.0
        summary_str = (
            f"Fail-closed: Decisions API response missing expected categories {missing_answers}."
        )
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
    elif dropped_rules:
        verdict_str = "REQUIRES_APPROVAL"
        summary_str = (
            f"{len(dropped_rules)} rule(s) exceeded prompt budget and were omitted: {dropped_rules}; manual check required."
        )
    elif diff_truncated:
        verdict_str = "REQUIRES_APPROVAL"
        summary_str = (
            f"All evaluated categories passed on partial diff, but diff exceeded {MAX_DIFF_CHARS} chars; manual check required."
        )
    else:
        verdict_str = "PASSED"
        summary_str = "All evaluated orthogonal categories passed Google Gemini Decisions API gatekeeper."

    verdict_obj = {
        "verdict": verdict_str,
        "confidence_score": round(overall_confidence, 4),
        "summary": summary_str,
        "engine": config.get("model", "gemini-decision-1"),
        "api_type": "Decisions API (Zero Output Token)",
        "tokens_evaluated": usage.get("total_input_tokens", 0),
        "diff_truncated": diff_truncated,
        "omitted_files": omitted_files,
        "dropped_rules": dropped_rules,
        "evaluated_categories": evaluated_categories,
        "violations": all_violations,
    }
    schema_errors = validate_verdict_schema(verdict_obj)
    if schema_errors:
        return fail_closed_verdict(
            "schema_error",
            f"Verdict failed schema validation: {schema_errors}",
            raw_verdict=verdict_str,
        )
    return verdict_obj


def evaluate_decisions(
    diff_text: str,
    activated_categories: list,
    plugin_dir: Path,
    diff_meta: dict = None,
) -> dict:
    """Calls Gemini Decisions API to evaluate activated architectural categories."""
    if not diff_text.strip():
        return fail_closed_verdict(
            "error",
            "No diff content provided to evaluate_decisions; refusing to fabricate PASSED.",
        )

    config = load_api_config(plugin_dir)
    api_key = config.get("api_key", "")
    if not api_key:
        return fail_closed_verdict(
            "error",
            "Missing GEMINI_API_KEY env var (or valid non-placeholder api_key).",
        )

    target_categories = [
        c.strip() for c in activated_categories if c and c.strip() in ARCH_QUESTIONS
    ]
    if not target_categories:
        target_categories = list(ARCH_QUESTIONS.keys())

    questions, dropped_rules = build_questions(plugin_dir, target_categories)
    diff_truncated = len(diff_text) > MAX_DIFF_CHARS
    trimmed_diff = diff_text[:MAX_DIFF_CHARS] if diff_truncated else diff_text
    diff_files = _extract_diff_file_paths(diff_text)
    omitted_files = (diff_meta or {}).get("omitted_files", [])

    payload = {
        "model": config.get("model", "gemini-decision-1"),
        "input": f"Code Diff to review:\n\n{trimmed_diff}",
        "questions": questions,
    }

    url = f"{config.get('endpoint', 'https://generativelanguage.googleapis.com/v1beta/decisions')}?key={api_key}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    timeout = config.get("timeout_seconds", 15)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_res = json.loads(resp.read().decode("utf-8"))
            return format_decision_verdict(
                raw_res,
                config,
                target_categories=target_categories,
                diff_files=diff_files,
                diff_truncated=diff_truncated,
                omitted_files=omitted_files,
                dropped_rules=dropped_rules,
            )
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "ignore")
        return fail_closed_verdict(
            "api_error",
            f"Decisions API HTTP error {e.code}",
            http_code=e.code,
            error_detail=err_body,
        )
    except Exception as e:
        return fail_closed_verdict(
            "network_error",
            f"Decisions API network error: {e}",
            error=str(e),
        )


def _load_diff_from_arg(target_arg: str, include_last_commit: bool = False) -> tuple[str, dict]:
    target = Path(target_arg)
    if target.is_dir():
        return get_git_diff(str(target), include_last_commit=include_last_commit)
    if target.is_file():
        return target.read_text(encoding="utf-8", errors="replace"), {
            "diff_source": "file",
            "omitted_files": [],
        }
    raise FileNotFoundError(f"Input path does not exist: {target_arg}")


def main():
    plugin_dir = Path(__file__).resolve().parents[3]
    args = sys.argv[1:]
    include_last_commit = "--last-commit" in args
    positional = [a for a in args if not a.startswith("--") or a == "--stdin"]

    diff_text = ""
    diff_meta: dict = {"diff_source": "stdin", "omitted_files": []}
    raw_categories = ""
    explicit_input_mode = False

    if not positional:
        diff_text, diff_meta = get_git_diff(".", include_last_commit=include_last_commit)
    elif positional[0] in ("-", "--stdin"):
        explicit_input_mode = True
        diff_text = sys.stdin.read()
        raw_categories = positional[1] if len(positional) > 1 else ""
    else:
        try:
            target_path = Path(positional[0])
            if target_path.is_file():
                explicit_input_mode = True
            diff_text, diff_meta = _load_diff_from_arg(positional[0], include_last_commit=include_last_commit)
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
    res = evaluate_decisions(diff_text, categories, plugin_dir, diff_meta=diff_meta)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if res.get("status") in ("error", "api_error", "network_error", "schema_error"):
        sys.exit(1)


if __name__ == "__main__":
    main()
