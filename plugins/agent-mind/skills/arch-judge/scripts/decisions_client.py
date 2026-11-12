#!/usr/bin/env python3
"""
decisions_client.py - Native caller for Google Gemini Decisions API (gemini-decision-1).
Evaluates Git Diff against the 4 orthogonal architectural redlines with zero text tokens and calibrated probabilities.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

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
            )
        }
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
            )
        }
    },
    "concurrency_and_performance": {
        "type": "choice",
        "instructions": (
            "Evaluate Concurrency and Performance: no method-level排他锁 on hot read paths, zero phantom polling."
        ),
        "criteria": {
            "passed": (
                "No coarse-grained method-level synchronized locks on hot read paths; uses fine-grained or lock-free "
                "mechanisms; zero phantom polling/probing."
            ),
            "violated": (
                "Method-level synchronized lock used on hot data read path, or phantom polling/probing introduced."
            )
        }
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
            )
        }
    }
}

def load_api_config(plugin_dir: Path) -> dict:
    """Loads API key and settings from config.json or environment."""
    config = {
        "api_key": os.environ.get("GEMINI_API_KEY", ""),
        "model": "gemini-decision-1",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/decisions",
        "timeout_seconds": 15,
        "confidence_threshold": 0.85
    }
    config_file = plugin_dir / "config.json"
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                disk_conf = json.load(f)
                config.update(disk_conf)
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to parse {config_file}: {e}\n")
    return config

def evaluate_decisions(diff_text: str, activated_categories: list, plugin_dir: Path) -> dict:
    """Calls Gemini Decisions API to evaluate activated architectural categories."""
    config = load_api_config(plugin_dir)
    api_key = config.get("api_key")
    if not api_key:
        return {
            "status": "error",
            "message": "Missing GEMINI_API_KEY. Configure in config.json or set GEMINI_API_KEY env."
        }

    # Filter questions to only activated categories (or all 4 if none specified)
    target_categories = activated_categories if activated_categories else list(ARCH_QUESTIONS.keys())
    questions = {
        cat: ARCH_QUESTIONS[cat]
        for cat in target_categories
        if cat in ARCH_QUESTIONS
    }

    if not questions:
        return {"status": "skipped", "message": "No categories to evaluate."}

    # Truncate diff safely if huge
    trimmed_diff = diff_text[:30000] if len(diff_text) > 30000 else diff_text

    payload = {
        "model": config.get("model", "gemini-decision-1"),
        "input": f"Code Diff to review:\n\n{trimmed_diff}",
        "questions": questions
    }

    url = f"{config.get('endpoint', 'https://generativelanguage.googleapis.com/v1beta/decisions')}?key={api_key}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    timeout = config.get("timeout_seconds", 15)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_res = json.loads(resp.read().decode("utf-8"))
            return format_decision_verdict(raw_res, config)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "ignore")
        return {
            "status": "api_error",
            "http_code": e.code,
            "error_detail": err_body
        }
    except Exception as e:
        return {
            "status": "network_error",
            "error": str(e)
        }

def format_decision_verdict(api_response: dict, config: dict) -> dict:
    """Transforms Decisions API raw output into ArchitectureVerdict schema."""
    answers = api_response.get("answers", {})
    usage = api_response.get("usage", {})

    violations = []
    overall_confidence = 1.0
    passed_all = True

    for cat_name, ans in answers.items():
        choice = ans.get("choice")
        confidence = ans.get("confidence", 0.0)
        overall_confidence = min(overall_confidence, confidence)

        if choice == "violated":
            passed_all = False
            violations.append({
                "rule_id": f"REDLINE_{cat_name.upper()}",
                "category": cat_name,
                "confidence": confidence,
                "probabilities": ans.get("probabilities", {}),
                "summary": f"Gemini Decisions API detected redline breach in category [{cat_name}]"
            })

    verdict_str = "PASSED" if passed_all else "VIOLATED"
    summary_str = (
        "All evaluated orthogonal categories passed Google Gemini Decisions API gatekeeper."
        if passed_all else
        f"Detected {len(violations)} redline violation(s) via Google Gemini Decisions API."
    )

    return {
        "verdict": verdict_str,
        "confidence_score": round(overall_confidence, 4),
        "summary": summary_str,
        "engine": "gemini-decision-1",
        "api_type": "Decisions API (Zero Output Token)",
        "tokens_evaluated": usage.get("total_input_tokens", 0),
        "evaluated_categories": answers,
        "violations": violations
    }

def main():
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    if len(sys.argv) > 1 and sys.argv[1] not in ("-", "--stdin"):
        diff_file = Path(sys.argv[1])
        diff_text = diff_file.read_text(encoding="utf-8", errors="replace") if diff_file.exists() else ""
    elif not sys.stdin.isatty():
        diff_text = sys.stdin.read()
    else:
        diff_text = "diff --git a/Test.java b/Test.java\n+ void doJob() { int x = 0; }"

    categories = sys.argv[2].split(",") if len(sys.argv) > 2 else []
    res = evaluate_decisions(diff_text, categories, plugin_dir)
    print(json.dumps(res, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
