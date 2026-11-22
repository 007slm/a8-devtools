#!/usr/bin/env python3
"""
stop_reflect.py - Post-turn Stop Hook for a8-agent-mind.
Evaluates finished, settled turns using L0 pre-filtering + Google Gemini Decisions API:
1. Suppresses reflection completely on unsettled turns (planning commands, pending-approval
   artifacts, ask_question/exit_plan_mode pauses, or active non-daemon background tasks/subagents),
   preserving unconsumed taste signals via a monotonic user-step watermark until code lands.
2. Enforces docs/ maintenance gate when repository non-doc files are modified without docs/ edits
   (only skipped when Decisions API explicitly returns choice=="no" >= threshold).
3. Surfaces ASK_USER_UI only when real repo code landed AND Decisions API confirms a novel,
   high-level engineering taste principle distinct from concrete bug-fix details (never auto-writes
   rules or decision files silently).
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
JUDGE_SCRIPTS_DIR = PLUGIN_DIR / "skills" / "a8-judge" / "scripts"
if str(JUDGE_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(JUDGE_SCRIPTS_DIR))

from decisions_client import append_harness_metric, call_decisions_api, load_api_config  # noqa: E402

TASTE_CORRECTION_SIGNALS = (
    "红线", "规范", "铁律", "原则", "品味", "过度设计", "过度了",
    "工程做法", "坏味道", "反模式", "严禁", "禁止", "一律", "绝不",
    "记住", "立个规矩", "改回", "撤回", "推翻", "重做", "别搞", "不要搞",
    "常用单词", "常用的单词", "生僻", "晦涩",
    "over-engineer", "anti-pattern", "redline", "never do",
)

PLANNING_COMMAND_PREFIXES = (
    "/plan", "/grill-me", "/a8-improve", "/复盘", "/提升",
)

STOP_HOOK_MARKER = "Stop hook blocked termination:"
TASTE_CONFIDENCE_FLOOR = 0.90
DISTINCT_CONFIDENCE_FLOOR = 0.85
RULES_DIGEST_MAX_CHARS = 2800

USER_REQUEST_RE = re.compile(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", re.DOTALL)
EXTRA_META_RE = re.compile(
    r"<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>.*?</(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>",
    re.DOTALL,
)
TASK_START_RE = re.compile(r"Tool is running as a background task with task id:\s*([^\s\"']+)")
TASK_DESC_RE = re.compile(r"Task Description:\s*(.+)")
TASK_FINISH_RE = re.compile(r'Task id\s+"([^"]+)"\s+finished')
TASK_STATUS_ID_RE = re.compile(r"Task:\s*([^\s\r\n]+)")
SENDER_RE = re.compile(r"sender=([^\s\]]+)")
SUBAGENT_CREATED_RE = re.compile(r'"conversationId"\s*:\s*"([^"]+)"')
SUBAGENT_LIST_PREFIX_RE = re.compile(r"You have \d+ active subagent\(s\):\s*(?=\[)")

SECRET_PATTERNS = (
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
    re.compile(r"\bsk-(?:proj-|ant-|live-|test-)?[0-9A-Za-z_-]{16,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}\b"),
    re.compile(r"\bgithub_pat_[0-9A-Za-z_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bBearer\s+[0-9A-Za-z._\-+/=]{16,}\b"),
    re.compile(r"(https?://)[^/\s:@]+:[^@\s]+@"),
)

SECRET_KV_RE = re.compile(
    r"(?i)\b((?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key|deepseek[_-]?api[_-]?key|gemini[_-]?api[_-]?key))\s*([:=])\s*([\"']?)([^\s\"';,]{8,})\3"
)

PROMPT_INJECTION_PATTERNS = (
    re.compile(r"(?i)\bignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions\b"),
    re.compile(r"(?i)\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+instructions\b"),
    re.compile(r"(?i)<\s*(?:system|instructions)\s*>"),
)


def _redact_secrets(text: str) -> tuple[str, bool]:
    """Masks plaintext API keys, tokens, and inline credentials before external API calls."""
    if not text:
        return "", False
    redacted = text
    found = False
    for pat in SECRET_PATTERNS:
        if pat.pattern.startswith("(https?://)"):
            new_text, count = pat.subn(r"\1[REDACTED]@", redacted)
        else:
            new_text, count = pat.subn("[REDACTED]", redacted)
        if count:
            found = True
            redacted = new_text

    def _kv_repl(match: re.Match[str]) -> str:
        nonlocal found
        key_name, sep, quote, val = match.groups()
        upper_val = val.upper()
        if (
            val.startswith("${")
            or "REDACTED" in upper_val
            or "MASKED" in upper_val
            or set(val) <= {"*"}
        ):
            return match.group(0)
        found = True
        return f"{key_name}{sep}{quote}[REDACTED]{quote}"

    redacted = SECRET_KV_RE.sub(_kv_repl, redacted)
    return redacted, found


def _sanitize_external_pastes(text: str) -> tuple[str, bool]:
    """Strips/isolates pasted email headers, long external quotes, and third-party prompt injections."""
    if not text:
        return "", False
    lines = text.splitlines()
    email_headers = sum(
        1 for ln in lines[:15]
        if re.match(r"^(?:From|Sent|To|Cc|Subject|Date)\s*:\s*\S+", ln.strip(), re.I)
    )
    has_external = email_headers >= 2

    cleaned_lines: list[str] = []
    quote_run: list[str] = []

    def _flush_quotes() -> None:
        nonlocal has_external
        if len(quote_run) >= 4:
            has_external = True
            cleaned_lines.append(f"[EXTERNAL_PASTE_OMITTED: {len(quote_run)} quoted lines]")
        else:
            cleaned_lines.extend(quote_run)
        quote_run.clear()

    for ln in lines:
        if ln.lstrip().startswith(">"):
            quote_run.append(ln)
            continue
        if quote_run:
            _flush_quotes()
        if any(pat.search(ln) for pat in PROMPT_INJECTION_PATTERNS):
            has_external = True
            cleaned_lines.append("[UNTRUSTED_EXTERNAL_DIRECTIVE_OMITTED]")
            continue
        cleaned_lines.append(ln)
    if quote_run:
        _flush_quotes()

    out = "\n".join(cleaned_lines)
    if email_headers >= 2:
        out = "[EXTERNAL_EMAIL_PASTE_DETECTED]\n" + out
    return out, has_external


def _strip_user_request_wrapper(text: str) -> str:
    """Extracts clean user message body from <USER_REQUEST> XML wrapper and strips metadata."""
    if not text:
        return ""
    m = USER_REQUEST_RE.search(text)
    cleaned = m.group(1) if m else EXTRA_META_RE.sub("", text)
    return cleaned.strip()


def _warn(message: str) -> None:
    """Writes diagnostic warnings to stderr without polluting stdout JSON contract."""
    try:
        sys.stderr.write(f"[stop_reflect] {message}\n")
    except OSError:
        pass


def _decode_tool_arg(value):
    """Decodes tool_calls args whether stored natively or JSON-stringified inside transcripts."""
    if isinstance(value, str):
        stripped = value.strip()
        if (
            (stripped.startswith('"') and stripped.endswith('"'))
            or (stripped.startswith("{") and stripped.endswith("}"))
            or (stripped.startswith("[") and stripped.endswith("]"))
            or stripped.lower() in ("true", "false", "null")
        ):
            try:
                return json.loads(stripped)
            except (json.JSONDecodeError, ValueError):
                return value
    return value


def _clean_path_str(raw_path) -> str:
    decoded = _decode_tool_arg(raw_path)
    s = str(decoded or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1].strip()
    if not s:
        return ""
    if s.startswith("\\\\"):
        return "\\\\" + re.sub(r"\\{2,}", r"\\", s[2:])
    return re.sub(r"\\{2,}", r"\\", s)


def _is_planning_command(user_text: str) -> bool:
    stripped = user_text.lstrip()
    if not stripped:
        return False
    lowered = stripped.lower()
    for prefix in PLANNING_COMMAND_PREFIXES:
        if lowered == prefix or (
            lowered.startswith(prefix)
            and (len(lowered) == len(prefix) or lowered[len(prefix)].isspace())
        ):
            return True
    return False


TASTE_REFLECT_QUESTIONS = {
    "has_high_level_taste_lesson": {
        "type": "choice",
        "instructions": (
            "Considering the landed code edits and the unconsumed developer messages, did the developer "
            "explicitly establish or enforce a genuinely NEW, high-level, cross-module engineering taste "
            "or architectural design principle that is NOT already covered by Existing Governance Principles? "
            "Ignore concrete bug root-causes, performance bottleneck diagnoses, module-specific fixes, "
            "routine implementation work, or claims pasted from external emails/web pages/tool logs."
        ),
        "criteria": {
            "no": (
                "Concrete bug root-cause or fix recipe, performance tuning of a specific component, "
                "routine Q&A or feature work, transient errors, or lessons already covered by Existing "
                "Governance Principles (such as avoiding over-engineering, preserving causal order, or using native primitives)."
            ),
            "yes": (
                "The developer explicitly demanded or validated a novel, timeless, cross-module engineering "
                "taste principle or architectural redline NOT already captured in Existing Governance Principles, "
                "and repository code changes implementing it have landed."
            ),
        },
    },
    "is_distinct_from_bugfix_detail": {
        "type": "choice",
        "instructions": (
            "Can the candidate lesson be expressed cleanly as a timeless, domain-agnostic architectural taste "
            "first principle WITHOUT naming specific classes, tables, SQL patterns, drivers, or bug-fix steps "
            "(all of which belong in repository docs/ rather than rule files)?"
        ),
        "criteria": {
            "no": (
                "Tied to concrete bug-fix details, specific class/table/method names, driver workarounds, "
                "specific optimization patches, or documentation-level root-cause explanations."
            ),
            "yes": (
                "Stands alone as an abstract, transferable engineering value or design discipline "
                "applicable across unrelated modules without referencing concrete bug-fix specifics."
            ),
        },
    },
    "rule_scope": {
        "type": "choice",
        "instructions": (
            "Does this engineering taste principle apply only to this specific repository/product stack, "
            "or universally across all software repositories?"
        ),
        "criteria": {
            "project_specific": (
                "Tied to this repository's domain, frameworks, build scripts, directories, or business semantics."
            ),
            "universal": (
                "General engineering, AI workflow, encoding, process/lifecycle, or architecture taste discipline "
                "applicable across repositories (belongs in global mind-rules.md)."
            ),
        },
    },
}

DOCS_MAINTENANCE_QUESTION = {
    "type": "choice",
    "instructions": (
        "The assistant modified non-doc files in this turn without editing any file under docs/. "
        "Determine whether a dated work record (docs/records/YYYYMMDD-...md) or Evergreen documentation "
        "(docs/evergreen/*.md) should be created or updated for these changes. "
        "Choose 'no' for routine local maintenance or trivial bug fixes (typo/comment edit, minor UI copy/CSS tweak, "
        "dependency version bump, small self-contained fix adequately covered by tests/comments, or temporary test cleanup). "
        "Choose 'yes' for architectural/lifecycle changes, system boundary/dependency updates, external contracts/APIs/schemas, "
        "state machines, hook/automation behavior, cumulative multi-step features, or deep root-cause investigations."
    ),
    "criteria": {
        "no": (
            "Routine local maintenance or trivial bug fix (typo/comment, minor UI tweak, dependency version bump, "
            "small self-contained fix covered by tests/comments, or temporary test cleanup) clearly needing no docs/."
        ),
        "yes": (
            "Non-trivial architectural, lifecycle, boundary, contract, schema, state-machine, hook/workflow behavior, "
            "multi-step feature delivery, or deep root-cause investigation needing docs/."
        ),
    },
}


def _state_root() -> Path:
    base = os.environ.get("PLUGIN_DATA", "").strip()
    root = Path(base) if base else Path(tempfile.gettempdir()) / "a8-agent-mind-hooks"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _state_file_path() -> Path:
    return _state_root() / "stop_reflect_state.json"


def _conv_state_path(conv_id: str) -> Path:
    digest = hashlib.sha256(conv_id.encode("utf-8")).hexdigest()[:16]
    return _state_root() / f"state_{digest}.json"


def _normalize_conv_state_entry(raw) -> dict:
    if isinstance(raw, dict):
        try:
            step = int(raw.get("last_taste_step", -1))
        except (TypeError, ValueError):
            step = -1
        return {
            "last_fp": str(raw.get("last_fp") or ""),
            "last_taste_step": step,
        }
    if isinstance(raw, str):
        return {"last_fp": raw, "last_taste_step": -1}
    return {"last_fp": "", "last_taste_step": -1}


def _load_legacy_state_map() -> dict:
    sf = _state_file_path()
    if not sf.is_file():
        return {}
    try:
        data = json.loads(sf.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        _warn(f"Failed to read legacy state file {sf}: {exc}")
        return {}


def _load_state() -> dict:
    """Aggregates legacy state and per-conversation atomic shard files."""
    merged = _load_legacy_state_map()
    root = _state_root()
    for shard in sorted(root.glob("state_*.json")):
        try:
            data = json.loads(shard.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            _warn(f"Failed to read state shard {shard}: {exc}")
            continue
        if isinstance(data, dict):
            cid = str(data.get("conv_id") or "")
            if cid:
                merged[cid] = _normalize_conv_state_entry(data)
    return merged


def _load_conv_state(conv_id: str) -> dict:
    """Loads per-conversation state shard with legacy fallback to avoid cross-session TOCTOU."""
    shard = _conv_state_path(conv_id)
    if shard.is_file():
        try:
            data = json.loads(shard.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return _normalize_conv_state_entry(data)
        except (OSError, json.JSONDecodeError) as exc:
            _warn(f"Failed to parse state shard {shard}: {exc}")
    legacy = _load_legacy_state_map()
    return _normalize_conv_state_entry(legacy.get(conv_id))


def _atomic_write_json(target: Path, payload: dict) -> None:
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(target.parent),
            prefix=f"{target.stem}.",
            suffix=".tmp",
            delete=False,
        ) as tf:
            tmp_path = tf.name
            json.dump(payload, tf, ensure_ascii=False, indent=2)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, target)
        tmp_path = ""
    except OSError as exc:
        _warn(f"Failed to persist state atomically to {target}: {exc}")
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError as cleanup_exc:
                _warn(f"Failed to clean temp state file {tmp_path}: {cleanup_exc}")


def _prune_state_shards(root: Path, max_files: int = 50, pattern: str = "state_*.json") -> None:
    try:
        shards = sorted(
            root.glob(pattern),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError as exc:
        _warn(f"Failed to enumerate state shards in {root}: {exc}")
        return
    for old_shard in shards[max_files:]:
        try:
            old_shard.unlink(missing_ok=True)
        except OSError as exc:
            _warn(f"Failed to prune old state shard {old_shard}: {exc}")


def _baseline_path(conv_id: str) -> Path:
    digest = hashlib.sha256(conv_id.encode("utf-8")).hexdigest()[:16]
    return _state_root() / f"baseline_{digest}.json"


def _run_git(cwd: Path, args: list[str], text: bool = False, timeout: float = 4.0) -> tuple[int, bytes | str]:
    kwargs: dict = {
        "cwd": str(cwd),
        "capture_output": True,
        "timeout": timeout,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    if text:
        kwargs["text"] = True
        kwargs["encoding"] = "utf-8"
        kwargs["errors"] = "replace"
    try:
        proc = subprocess.run(["git", "-C", str(cwd), "-c", "core.quotepath=false", *args], **kwargs)
        return proc.returncode, proc.stdout
    except (OSError, subprocess.SubprocessError):
        return 1, "" if text else b""


def _resolve_git_root(workspace: Path) -> Path | None:
    if not workspace.exists():
        return None
    target = workspace if workspace.is_dir() else workspace.parent
    rc, out = _run_git(target, ["rev-parse", "--show-toplevel"], text=True)
    if rc != 0:
        return None
    top = str(out or "").strip()
    if not top:
        return None
    try:
        resolved = Path(top).resolve()
    except OSError:
        resolved = Path(top)
    if resolved == resolved.parent:
        return None
    return resolved


def _capture_git_snapshot(git_root: Path) -> dict | None:
    rc_head, out_head = _run_git(git_root, ["rev-parse", "--verify", "HEAD"], text=True)
    head_sha = str(out_head or "").strip() if rc_head == 0 else ""

    rc_st, raw_st = _run_git(git_root, ["status", "--porcelain=v1", "-z", "-uall"], text=False)
    if rc_st != 0 or not isinstance(raw_st, (bytes, bytearray)):
        return None

    entries: dict[str, dict] = {}
    tokens = bytes(raw_st).split(b"\0")
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        idx += 1
        if len(tok) < 4:
            continue
        xy = tok[:2].decode("utf-8", errors="replace")
        rel = tok[3:].decode("utf-8", errors="replace").replace("\\", "/").strip()
        if xy[0] in ("R", "C") or xy[1] in ("R", "C"):
            if idx < len(tokens):
                idx += 1
        if not rel:
            continue
        mtime_ns: int | None = None
        size: int | None = None
        try:
            st = (git_root / rel).lstat()
            mtime_ns = int(st.st_mtime_ns)
            size = int(st.st_size)
        except OSError:
            pass
        entries[rel] = {"xy": xy, "mtime_ns": mtime_ns, "size": size}

    return {"head_sha": head_sha, "entries": entries}


def _collect_git_roots(payload: dict) -> list[Path]:
    raw_candidates: list[str] = []
    ws_list = payload.get("workspacePaths")
    if isinstance(ws_list, list):
        raw_candidates.extend(str(w) for w in ws_list if str(w).strip())
    if not raw_candidates and str(payload.get("cwd") or "").strip():
        raw_candidates.append(str(payload.get("cwd")))

    roots: list[Path] = []
    seen: set[str] = set()
    for raw in raw_candidates:
        root = _resolve_git_root(Path(raw))
        if root is None:
            continue
        key = str(root).lower()
        if key not in seen:
            seen.add(key)
            roots.append(root)
    return roots


def _extract_turn_key(transcript_path: str, last_user_input: str) -> str:
    tp = Path(transcript_path) if transcript_path else None
    if tp and tp.is_file():
        tail_lines: deque[str] = deque(maxlen=260)
        try:
            with tp.open("r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.strip():
                        tail_lines.append(line)
            last_step: int | None = None
            for i, raw in enumerate(tail_lines):
                try:
                    st = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(st, dict):
                    continue
                st_type = str(st.get("type") or "")
                st_source = str(st.get("source") or "")
                st_content = str(st.get("content") or "")
                if _is_stop_hook_boundary_step(st_type, st_content):
                    continue
                if st_type == "USER_INPUT" or st_source == "USER_EXPLICIT":
                    try:
                        last_step = int(st.get("step_index", i))
                    except (TypeError, ValueError):
                        last_step = i
            if last_step is not None:
                return f"step:{last_step}"
        except OSError:
            pass
    cleaned = _strip_user_request_wrapper(last_user_input or "")
    digest = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()[:16]
    return f"input:{digest}"


def capture_turn_baseline(payload: dict) -> dict:
    """Captures once-per-turn Git working-tree baseline on PreInvocation; silent {} for non-Git workspaces."""
    conv_id = str(payload.get("conversationId") or "default")
    turn_key = _extract_turn_key(str(payload.get("transcriptPath") or ""), str(payload.get("lastUserInput") or ""))
    bpath = _baseline_path(conv_id)
    if bpath.is_file():
        try:
            existing = json.loads(bpath.read_text(encoding="utf-8"))
            if isinstance(existing, dict) and existing.get("turn_key") == turn_key:
                return {}
        except (OSError, json.JSONDecodeError):
            pass

    roots = _collect_git_roots(payload)
    if not roots:
        return {}

    snaps: dict[str, dict] = {}
    for root in roots:
        snap = _capture_git_snapshot(root)
        if snap is not None:
            snaps[str(root)] = snap

    if not snaps:
        return {}

    _atomic_write_json(
        bpath,
        {
            "conv_id": conv_id,
            "turn_key": turn_key,
            "roots": snaps,
        },
    )
    _prune_state_shards(bpath.parent, 50, pattern="baseline_*.json")
    return {}


def _diff_commit_paths(git_root: Path, old_head: str, new_head: str) -> list[str]:
    if not new_head or old_head == new_head:
        return []
    if old_head:
        rc, raw = _run_git(git_root, ["diff", "--name-only", "-z", old_head, new_head], text=False)
    else:
        rc, raw = _run_git(
            git_root,
            ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--root", new_head],
            text=False,
        )
    if rc != 0 or not isinstance(raw, (bytes, bytearray)):
        return []
    paths: list[str] = []
    for tok in bytes(raw).split(b"\0"):
        rel = tok.decode("utf-8", errors="replace").replace("\\", "/").strip()
        if rel:
            paths.append(rel)
    return paths


def _collect_git_turn_changes(payload: dict, turn_key: str) -> tuple[list[str], str, list[Path]]:
    """Computes net files changed in the current turn via Git baseline delta; empty for non-Git repos."""
    roots = _collect_git_roots(payload)
    if not roots:
        return [], "", []

    conv_id = str(payload.get("conversationId") or "default")
    bpath = _baseline_path(conv_id)
    if not bpath.is_file():
        return [], "", roots
    try:
        baseline = json.loads(bpath.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], "", roots
    if not isinstance(baseline, dict) or baseline.get("turn_key") != turn_key:
        return [], "", roots

    base_roots = baseline.get("roots") or {}
    changed_files: list[str] = []
    stat_chunks: list[str] = []
    seen_files: set[str] = set()

    for root in roots:
        base_snap = base_roots.get(str(root))
        if not isinstance(base_snap, dict):
            continue
        curr_snap = _capture_git_snapshot(root)
        if curr_snap is None:
            continue

        base_entries = base_snap.get("entries") or {}
        curr_entries = curr_snap.get("entries") or {}
        changed_rels: list[str] = []
        seen_rel: set[str] = set()

        for rel, curr_meta in curr_entries.items():
            base_meta = base_entries.get(rel)
            if base_meta is None or base_meta != curr_meta:
                if rel not in seen_rel:
                    seen_rel.add(rel)
                    changed_rels.append(rel)

        for rel in _diff_commit_paths(root, str(base_snap.get("head_sha") or ""), str(curr_snap.get("head_sha") or "")):
            if rel not in seen_rel:
                seen_rel.add(rel)
                changed_rels.append(rel)

        if not changed_rels:
            continue

        for rel in changed_rels:
            full_str = str(root / rel)
            norm_key = full_str.replace("\\", "/").lower()
            if norm_key not in seen_files:
                seen_files.add(norm_key)
                changed_files.append(full_str)

        head_sha = str(curr_snap.get("head_sha") or "")
        if head_sha:
            rc_stat, out_stat = _run_git(
                root,
                ["diff", "--stat=100,80", "HEAD", "--", *changed_rels[:60]],
                text=True,
            )
            if rc_stat == 0 and str(out_stat or "").strip():
                stat_chunks.append(str(out_stat).strip())
        untracked = [r for r in changed_rels if (curr_entries.get(r) or {}).get("xy") == "??"]
        if untracked:
            stat_chunks.append("New untracked: " + ", ".join(untracked[:20]))

    diff_stat = "\n".join(stat_chunks)[:1600]
    return changed_files, diff_stat, roots


def _save_conv_state(conv_id: str, last_fp: str, last_taste_step: int) -> None:
    shard = _conv_state_path(conv_id)
    _atomic_write_json(
        shard,
        {
            "conv_id": conv_id,
            "last_fp": last_fp,
            "last_taste_step": int(last_taste_step),
        },
    )
    _prune_state_shards(shard.parent, 50)


def _get_conv_state(state: dict, conv_id: str) -> dict:
    """Normalizes legacy string entries into {'last_fp': str, 'last_taste_step': int}."""
    return _normalize_conv_state_entry(state.get(conv_id))


def _normalize_path_parts(raw_path: str) -> list[str]:
    norm = raw_path.replace("\\", "/").strip().lower()
    return [p for p in norm.split("/") if p]


def _is_ephemeral_artifact_path(
    parts: list[str],
    workspace_roots_parts: list[list[str]] | None = None,
) -> bool:
    if not parts:
        return False
    joined = "/".join(parts)
    if ".gemini/antigravity/brain" in joined or ".gemini/config/sidecars" in joined:
        return True
    rel_parts = parts
    in_workspace = False
    for ws_parts in workspace_roots_parts or ():
        if ws_parts and len(parts) > len(ws_parts) and parts[:len(ws_parts)] == ws_parts:
            rel_parts = parts[len(ws_parts):]
            in_workspace = True
            break
    if "logs" in rel_parts or "scratch" in rel_parts:
        return True
    if not in_workspace:
        rel_joined = "/".join(rel_parts)
        if "appdata/local/temp" in rel_joined or rel_joined.startswith("tmp/"):
            return True
    return False


def _is_pending_approval_artifact(tc_args: dict, clean_path: str) -> bool:
    meta = _decode_tool_arg(tc_args.get("ArtifactMetadata"))
    if isinstance(meta, dict) and meta.get("RequestFeedback") is True:
        return True
    parts = _normalize_path_parts(clean_path)
    joined = "/".join(parts)
    return ".gemini/antigravity/brain" in joined and parts[-1:] == ["implementation_plan.md"]


def _apply_user_guards(summary: dict, raw_user_text: str, fp_seed: str) -> dict:
    cleaned_body = _strip_user_request_wrapper(raw_user_text)
    cleaned_user, has_ext = _sanitize_external_pastes(cleaned_body)
    redacted_user, has_sec = _redact_secrets(cleaned_user)
    summary["user_text"] = redacted_user
    summary["unconsumed_user_text"] = redacted_user
    summary["has_external_paste"] = has_ext
    summary["has_secret_redacted"] = has_sec
    summary["has_taste_signal"] = any(
        kw in redacted_user.lower() for kw in TASTE_CORRECTION_SIGNALS
    )
    summary["is_planning_command"] = _is_planning_command(cleaned_body)
    summary["is_unsettled_turn"] = summary["is_planning_command"]
    summary["turn_fingerprint"] = hashlib.sha256(fp_seed.encode("utf-8")).hexdigest()[:16]
    return summary


def _is_stop_hook_boundary_step(st_type: str, st_content: str) -> bool:
    """Matches genuine Stop hook continuation injections without letting assistant/tool prose hijack boundaries."""
    if st_type in ("PLANNER_RESPONSE", "TOOL_RESULT", "GENERIC", "ERROR_MESSAGE"):
        return False
    if st_content.lstrip().startswith(STOP_HOOK_MARKER):
        return True
    return bool(re.search(r"<SYSTEM_MESSAGE>\s*" + re.escape(STOP_HOOK_MARKER), st_content))


DATED_DOC_NAME_RE = re.compile(r"^\d{8}-")


def _classify_doc_path_role(
    raw_path: str,
    workspace_roots_parts: list[list[str]] | None = None,
    has_evergreen_dir: bool = False,
) -> str:
    """Classifies an edited path into evergreen / record / deferred / other_doc / skip / non_doc."""
    parts = _normalize_path_parts(raw_path)
    if not parts:
        return "skip"
    if parts[-1] == "agents.md" or _is_ephemeral_artifact_path(parts, workspace_roots_parts):
        return "skip"
    rel_parts = parts
    for ws_parts in workspace_roots_parts or ():
        if ws_parts and len(parts) > len(ws_parts) and parts[:len(ws_parts)] == ws_parts:
            rel_parts = parts[len(ws_parts):]
            break
    if "docs" in rel_parts:
        docs_idx = rel_parts.index("docs")
        sub = rel_parts[docs_idx + 1:]
        if not sub:
            return "skip"
        if len(sub) == 1 and sub[0] in ("glossary.md", "verify.md"):
            return "evergreen"
        if sub[0] == "evergreen":
            return "evergreen" if sub[-1].endswith(".md") else "other_doc"
        if sub[0] == "records":
            return "record"
        if sub[0] in ("deferred", "archive"):
            return "deferred"
        if has_evergreen_dir and DATED_DOC_NAME_RE.match(sub[-1]):
            return "record"
        return "evergreen" if sub[-1].endswith(".md") else "other_doc"
    return "non_doc"


def _extract_recent_turn_summary(
    transcript_path: str,
    last_user_input: str,
    last_taste_step: int = -1,
    workspace_paths: list[str] | None = None,
) -> dict:
    workspace_roots_parts = [
        _normalize_path_parts(str(ws))
        for ws in (workspace_paths or [])
        if str(ws).strip()
    ]
    raw_user_text = _strip_user_request_wrapper(last_user_input or "")[:1200]
    summary = {
        "edited_files": [],
        "all_edited_files": [],
        "diff_stat": "",
        "failed_commands": [],
        "has_taste_signal": False,
        "has_secret_redacted": False,
        "has_external_paste": False,
        "last_boundary_is_stop_hook": False,
        "is_planning_command": False,
        "has_pending_approval_artifact": False,
        "asked_user_question": False,
        "has_running_async_work": False,
        "is_unsettled_turn": False,
        "latest_user_step_index": last_taste_step,
        "turn_key": _extract_turn_key(transcript_path, last_user_input),
        "user_text": raw_user_text,
        "unconsumed_user_text": raw_user_text,
        "assistant_tail": "",
        "turn_fingerprint": "",
    }

    tp = Path(transcript_path) if transcript_path else None
    if not tp or not tp.is_file():
        return _apply_user_guards(summary, raw_user_text, f"{raw_user_text}|no-transcript")

    tail_lines: deque[str] = deque(maxlen=260)
    try:
        with tp.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.strip():
                    tail_lines.append(line)
    except OSError as exc:
        _warn(f"Failed to read transcript {tp}: {exc}")
        return _apply_user_guards(summary, raw_user_text, f"{raw_user_text}|read-error")

    steps: list[dict] = []
    malformed_lines = 0
    for raw in tail_lines:
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                steps.append(obj)
        except json.JSONDecodeError:
            malformed_lines += 1
    if malformed_lines:
        _warn(f"Skipped {malformed_lines} malformed JSONL line(s) in {tp}")

    last_user_idx = -1
    last_boundary_is_stop_hook = False
    unconsumed_user_msgs: list[str] = []
    latest_user_step = last_taste_step
    last_real_user_raw = ""
    last_real_user_step = -1

    for i, st in enumerate(steps):
        st_type = str(st.get("type") or "")
        st_source = str(st.get("source") or "")
        st_content = str(st.get("content") or "")
        is_stop_hook_msg = _is_stop_hook_boundary_step(st_type, st_content)
        is_real_user = (
            (st_type == "USER_INPUT" or st_source == "USER_EXPLICIT")
            and not is_stop_hook_msg
        )
        if is_real_user or is_stop_hook_msg:
            last_user_idx = i
            last_boundary_is_stop_hook = is_stop_hook_msg
        if is_real_user:
            step_idx = st.get("step_index", i)
            try:
                step_num = int(step_idx)
            except (TypeError, ValueError):
                step_num = i
            body = _strip_user_request_wrapper(st_content)[:1200]
            if body:
                last_real_user_raw = body
                last_real_user_step = step_num
                if step_num > last_taste_step:
                    unconsumed_user_msgs.append(body)
            if step_num > latest_user_step:
                latest_user_step = step_num

    if last_boundary_is_stop_hook:
        raw_user_text = ""
    elif last_real_user_raw:
        raw_user_text = last_real_user_raw
        if raw_user_text != _strip_user_request_wrapper(last_user_input or "")[:1200]:
            candidate = _strip_user_request_wrapper(last_user_input or "")[:1200]
            if candidate and last_real_user_step <= last_taste_step:
                raw_user_text = candidate
                unconsumed_user_msgs.append(candidate)
                latest_user_step = max(latest_user_step, last_taste_step + 1)
    elif raw_user_text and last_real_user_step < 0:
        # Fallback payload input when transcript contains no USER_INPUT step
        unconsumed_user_msgs.append(raw_user_text)
        latest_user_step = max(latest_user_step, last_taste_step + 1)

    recent_steps = steps[last_user_idx:] if last_user_idx >= 0 else steps[-30:]
    failed_cmds: list[str] = []
    assistant_texts: list[str] = []
    step_indices: list[str] = []

    has_pending_approval = False
    asked_user_question = False
    running_tasks: set[str] = set()
    active_subagents: set[str] = set()
    daemon_cmds: set[str] = set()
    last_cmd_was_daemon = False

    for st in recent_steps:
        if "step_index" in st:
            step_indices.append(str(st["step_index"]))
        st_type = str(st.get("type") or "")
        st_status = str(st.get("status") or "")
        st_content = str(st.get("content") or "")

        for tc in st.get("tool_calls") or []:
            name = str(tc.get("name") or "")
            args = tc.get("args") or {}
            if name in ("edit_file", "write_file"):
                p = _clean_path_str(args.get("Path"))
                if _is_pending_approval_artifact(args, p):
                    has_pending_approval = True
            elif name in ("ask_question", "exit_plan_mode"):
                asked_user_question = True
            elif name == "run_command":
                is_daemon_val = _decode_tool_arg(args.get("IsDaemon"))
                is_daemon = is_daemon_val is True or str(is_daemon_val).strip().lower() == "true"
                cmd_line = str(_decode_tool_arg(args.get("CommandLine")) or "").strip()
                if is_daemon and cmd_line:
                    daemon_cmds.add(cmd_line)
                last_cmd_was_daemon = is_daemon
                if st_status == "ERROR" and cmd_line:
                    failed_cmds.append(cmd_line[:160])
            elif name == "manage_task":
                action = str(_decode_tool_arg(args.get("Action")) or "").strip().lower()
                tid = str(_decode_tool_arg(args.get("TaskId")) or "").strip()
                if action == "kill" and tid:
                    running_tasks.discard(tid)
            elif name == "send_message":
                rec = str(_decode_tool_arg(args.get("Recipient")) or "").strip()
                if rec:
                    active_subagents.add(rec)
            elif name == "manage_subagents":
                action = str(_decode_tool_arg(args.get("Action")) or "").strip().lower()
                if action == "kill_all":
                    active_subagents.clear()
                elif action == "kill":
                    cids = _decode_tool_arg(args.get("ConversationIds"))
                    if isinstance(cids, list):
                        for cid in cids:
                            active_subagents.discard(str(cid).strip())

        if "All your subagents and background tasks have been stopped" in st_content:
            running_tasks.clear()
            active_subagents.clear()

        if st_status == "RUNNING" or "Tool is running as a background task with task id:" in st_content:
            m_tid = TASK_START_RE.search(st_content)
            if m_tid:
                tid = m_tid.group(1).strip()
                m_desc = TASK_DESC_RE.search(st_content)
                desc = m_desc.group(1).strip() if m_desc else ""
                is_daemon_task = (desc and desc in daemon_cmds) or (last_cmd_was_daemon and not desc)
                if not is_daemon_task:
                    running_tasks.add(tid)
                last_cmd_was_daemon = False

        for tid in TASK_FINISH_RE.findall(st_content):
            running_tasks.discard(tid.strip())
        for sender_id in SENDER_RE.findall(st_content):
            sid = sender_id.strip()
            running_tasks.discard(sid)
            active_subagents.discard(sid)

        if "Status: DONE" in st_content or "Status: FAILED" in st_content or "Status: KILLED" in st_content:
            for tid in TASK_STATUS_ID_RE.findall(st_content):
                running_tasks.discard(tid.strip())

        if "Created the following subagent:" in st_content and st_status != "ERROR":
            for cid in SUBAGENT_CREATED_RE.findall(st_content):
                active_subagents.add(cid.strip())

        m_sub = SUBAGENT_LIST_PREFIX_RE.search(st_content)
        if m_sub:
            try:
                sub_items, _ = json.JSONDecoder().raw_decode(st_content, m_sub.end())
                if isinstance(sub_items, list):
                    for item in sub_items:
                        if isinstance(item, dict) and item.get("conversationId"):
                            cid = str(item["conversationId"]).strip()
                            if str(item.get("state") or "").lower() == "running":
                                active_subagents.add(cid)
                            else:
                                active_subagents.discard(cid)
            except json.JSONDecodeError as exc:
                _warn(f"Failed to decode active subagent list JSON: {exc}")

        if st_status == "ERROR" and st_type == "TOOL_RESULT":
            txt = st_content.strip()[:160]
            if txt and txt not in failed_cmds:
                failed_cmds.append(txt)
        if st_type == "PLANNER_RESPONSE" and st_content.strip():
            assistant_texts.append(st_content.strip()[:800])

    cleaned_user, has_ext_user = _sanitize_external_pastes(raw_user_text)
    redacted_user, sec_user = _redact_secrets(cleaned_user)

    unconsumed_window = "\n---\n".join(unconsumed_user_msgs[-3:])[:2400]
    cleaned_unconsumed, has_ext_unconsumed = _sanitize_external_pastes(unconsumed_window)
    redacted_unconsumed, sec_unconsumed = _redact_secrets(cleaned_unconsumed)

    redacted_cmds: list[str] = []
    sec_cmd = False
    for cmd in failed_cmds[:8]:
        r_cmd, had = _redact_secrets(cmd)
        sec_cmd = sec_cmd or had
        redacted_cmds.append(r_cmd)

    raw_tail = "\n".join(assistant_texts[-2:])[:1800]
    cleaned_tail, has_ext_tail = _sanitize_external_pastes(raw_tail)
    redacted_tail, sec_tail = _redact_secrets(cleaned_tail)

    is_planning_cmd = (not last_boundary_is_stop_hook) and _is_planning_command(raw_user_text)
    has_running_async = bool(running_tasks or active_subagents)
    is_unsettled = is_planning_cmd or has_pending_approval or asked_user_question or has_running_async

    summary["failed_commands"] = redacted_cmds
    summary["user_text"] = redacted_user
    summary["unconsumed_user_text"] = redacted_unconsumed
    summary["assistant_tail"] = redacted_tail
    summary["has_external_paste"] = has_ext_user or has_ext_unconsumed or has_ext_tail
    summary["has_secret_redacted"] = sec_user or sec_unconsumed or sec_cmd or sec_tail
    summary["last_boundary_is_stop_hook"] = last_boundary_is_stop_hook
    summary["is_planning_command"] = is_planning_cmd
    summary["has_pending_approval_artifact"] = has_pending_approval
    summary["asked_user_question"] = asked_user_question
    summary["has_running_async_work"] = has_running_async
    summary["is_unsettled_turn"] = is_unsettled
    summary["latest_user_step_index"] = latest_user_step
    summary["has_taste_signal"] = (
        (not last_boundary_is_stop_hook)
        and any(kw in redacted_unconsumed.lower() for kw in TASTE_CORRECTION_SIGNALS)
    )
    fp_seed = f"{last_user_idx}|{'-'.join(step_indices[-6:])}"
    summary["turn_fingerprint"] = hashlib.sha256(fp_seed.encode("utf-8")).hexdigest()[:16]
    return summary


def _classify_doc_maintenance(
    edited_files: list[str],
    workspace_paths: list[str] | None = None,
) -> dict:
    """Classifies edited files across Evergreen docs, dated records, deferred docs, and non-doc code."""
    workspace_roots_parts = [
        _normalize_path_parts(str(ws))
        for ws in (workspace_paths or [])
        if str(ws).strip()
    ]
    has_evergreen_dir = any(
        (Path(str(ws)) / "docs" / "evergreen").is_dir()
        for ws in (workspace_paths or [])
        if str(ws).strip()
    )
    evergreen_files: list[str] = []
    record_files: list[str] = []
    deferred_files: list[str] = []
    non_doc_files: list[str] = []
    for raw_path in edited_files:
        role = _classify_doc_path_role(
            raw_path,
            workspace_roots_parts=workspace_roots_parts,
            has_evergreen_dir=has_evergreen_dir,
        )
        if role == "evergreen":
            evergreen_files.append(raw_path)
        elif role == "record":
            record_files.append(raw_path)
        elif role == "deferred":
            deferred_files.append(raw_path)
        elif role == "non_doc":
            non_doc_files.append(raw_path)
    return {
        "evergreen_files": evergreen_files,
        "record_files": record_files,
        "deferred_files": deferred_files,
        "non_doc_files": non_doc_files,
    }


def _analyze_doc_maintenance(
    edited_files: list[str],
    workspace_paths: list[str] | None = None,
) -> tuple[bool, bool, list[str]]:
    """Backwards-compatible wrapper returning (has_evergreen_maintenance, needs_docs_check, non_doc_files)."""
    c = _classify_doc_maintenance(edited_files, workspace_paths)
    has_evergreen = bool(c["evergreen_files"])
    needs_check = (not has_evergreen) and (bool(c["non_doc_files"]) or bool(c["record_files"]))
    return has_evergreen, needs_check, c["non_doc_files"]


def _load_record_excerpts(workspace: str, record_files: list[str], max_total_chars: int = 2400) -> str:
    """Reads bounded, sanitized excerpts of edited dated work records for Decisions API context."""
    chunks: list[str] = []
    used = 0
    ws_path = Path(workspace) if workspace else None
    for raw in record_files[:3]:
        p = Path(raw)
        if not p.is_file() and ws_path:
            p = ws_path / raw
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")[:1200]
        except OSError:
            continue
        cleaned, _ = _sanitize_external_pastes(text)
        redacted, _ = _redact_secrets(cleaned)
        block = f"[{raw}]\n{redacted.strip()}"
        if used + len(block) > max_total_chars:
            remain = max_total_chars - used - 4
            if remain > 60:
                chunks.append(block[:remain].rstrip() + "...")
            break
        chunks.append(block)
        used += len(block) + 2
    return "\n\n".join(chunks)


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


def _load_existing_rules_digest(workspace: str) -> str:
    """Loads bounded headings/clauses from mind-rules.md and repo redline.md to avoid duplicate rules."""
    candidates = [
        ("global/mind-rules.md", PLUGIN_DIR / "rules" / "mind-rules.md"),
        ("repo/.agents/rules/redline.md", Path(workspace) / ".agents" / "rules" / "redline.md"),
    ]
    chunks: list[str] = []
    total_len = 0
    for label, path in candidates:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            _warn(f"Failed to read governance rule file {path}: {exc}")
            continue
        text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        lines: list[str] = [f"[{label}]"]
        for raw_ln in text.splitlines():
            ln = raw_ln.strip()
            if not ln or ln.startswith(">") or ln == "---":
                continue
            if ln.startswith("#") or ln.startswith("-") or re.match(r"^\d+\.", ln):
                lines.append(ln[:180])
        block = "\n".join(lines)
        remaining = RULES_DIGEST_MAX_CHARS - total_len
        if remaining <= 40:
            break
        if len(block) > remaining:
            block = block[:remaining].rstrip() + "..."
        chunks.append(block)
        total_len += len(block) + 2
    return "\n\n".join(chunks)


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
        f"[a8-agent-mind Stop Hook -> ASK_USER_UI] 代码已落地且检测到潜在高维工程品味/立规信号"
        f"（作用域参考：{rec_label}，置信度 {scope_conf:.2f}）。\n"
        f"动手生成卡片前，请先完成 3 项严格自检（任意一项不满足则**不要生成 `reflect_card.html`**，直接静默收尾）：\n"
        f"1. 确认当前任务确已改码并验证完结，而非处于 `/plan`、讨论对齐或等待执行中；\n"
        f"2. 核对 `{universal_rule}` 与 `{project_rule}`（若存在），若既有第一性原理已覆盖且未失效，不得重复提议；\n"
        f"3. 确认提炼内容不是具体模块的 Bug 根因、性能调优细节或特定类名/表名/API 修法（这类排障细节应归入 `docs/`，严禁当成红线规则）。\n"
        f"仅当上述 3 项全部通过时，才参考 `{PLUGIN_DIR / 'skills' / 'a8-improve' / 'templates' / 'improve_card.html'}`，"
        f"在 `{card_path}` 生成不含具体类名/表名/修补步骤的 1~2 句第一性原理确认卡并用 `<agent-embed>` 展示：\n"
        f"- 选项 1：写入全局通用规范（跨仓库适用） -> `{universal_rule}`\n"
        f"- 选项 2：写入本项目专属红线 -> `{project_rule}`\n"
        f"- 选项 3：沉淀为结构化 Decision（全局 `{global_decision_dir}` 或项目 `{lint_dir}`）\n"
        f"- 选项 4：转化为确定性项目 Lint 检查 -> `{lint_dir}`\n"
        f"- 选项 5：仅本次处理，不写入规则\n"
        f"停步等待用户确认，严禁未经批准擅自写入规则/Decision；后续回合未再次收到本唤醒消息前，严禁预判自造 `reflect_card.html`。"
    )


def _build_reason_docs_sync(
    workspace: str,
    non_doc_files: list[str],
    choice: str,
    conf: float,
    threshold: float,
    api_error: str = "",
) -> str:
    records_dir = Path(workspace) / "docs" / "records"
    evergreen_dir = Path(workspace) / "docs" / "evergreen"
    verify_doc = Path(workspace) / "docs" / "verify.md"
    agents_map = Path(workspace) / "AGENTS.md"
    preview = ", ".join(non_doc_files[:6])
    if len(non_doc_files) > 6:
        preview += f" 等共 {len(non_doc_files)} 个文件"
    if api_error:
        judge_desc = f"Decisions API 未返回明确免检结论（{api_error}）"
    else:
        judge_desc = (
            f"Decisions API 未明确判定免检（docs_maintenance={choice}, confidence={conf:.2f}"
            f", 豁免阈值={threshold:.2f}）"
        )
    return (
        f"[a8-agent-mind Stop Hook -> DOCS_MAINTENANCE] 目标仓库：{workspace}。本轮修改了非文档文件（{preview}），"
        f"但未检测到 `docs/records/` 或 `docs/evergreen/` 的同步维护；{judge_desc}。\n"
        f"按快慢双轨文档治理规范，请直接在当前上下文闭环：\n"
        f"1. 若触及架构/生命周期变更、系统边界、外部契约/Schema、状态机、验证入口或非平凡功能/深层排障，请直接利用当前上下文：\n"
        f"   - 在 `{records_dir}` 写入精炼工作记录（`YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`）；\n"
        f"   - 顺手轻量化同步对应的 `{evergreen_dir}` 常青文档（若涉及验证入口或顶层模块表，一并更新 `{verify_doc}` 与 `{agents_map}`，严控单文件 `< 20KB`）；即使本次更新不够全面也无需焦虑，每晚 20:00 的定时常青文档梳理任务会全量扫描补齐；\n"
        f"   - 严禁为此额外启动 `docs-sync` 子代理。\n"
        f"2. 若经核实确属常规局部改动或简单 Bug 修复（测试与行内注释已充分覆盖），请向用户简明说明免建档理由后结束。"
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
    conv_state = _load_conv_state(conv_id)

    ws_paths = payload.get("workspacePaths") if isinstance(payload.get("workspacePaths"), list) else None
    turn = _extract_recent_turn_summary(
        str(payload.get("transcriptPath") or ""),
        str(payload.get("lastUserInput") or ""),
        last_taste_step=conv_state["last_taste_step"],
        workspace_paths=ws_paths,
    )

    if turn["is_unsettled_turn"]:
        return {}

    git_changed, diff_stat, git_roots = _collect_git_turn_changes(payload, turn["turn_key"])
    if not git_roots or not git_changed:
        return {}

    raw_edited = git_changed
    turn["all_edited_files"] = raw_edited
    turn["edited_files"] = raw_edited[:20]
    turn["diff_stat"] = diff_stat
    turn["turn_fingerprint"] = hashlib.sha256(
        f"{turn['turn_fingerprint']}|{','.join(raw_edited)}".encode("utf-8")
    ).hexdigest()[:16]

    workspace = _pick_workspace(payload, raw_edited) or str(git_roots[0])
    effective_ws_paths = [str(r) for r in git_roots]
    classified = _classify_doc_maintenance(raw_edited, effective_ws_paths)
    non_doc_files = classified["non_doc_files"]
    record_files = classified["record_files"]
    # 快轨不阻断：只要本轮写过 docs/records/ 或更新过常青/地图/术语/AGENTS，即视作已完成日常文档职责；
    # 常青文档未覆盖全的部分交由当前会话顺手补充或每晚 20:00 定时任务兜底整理。
    has_any_doc_maintenance = bool(classified["evergreen_files"]) or bool(record_files)
    needs_docs_check = (not has_any_doc_maintenance) and bool(non_doc_files)

    taste_candidate_eligible = (
        (not turn["last_boundary_is_stop_hook"])
        and bool(non_doc_files)
        and turn["has_taste_signal"]
    )

    if not needs_docs_check and not taste_candidate_eligible:
        return {}

    if conv_state["last_fp"] == turn["turn_fingerprint"]:
        return {}

    guard_tags: list[str] = []
    if turn.get("has_secret_redacted"):
        guard_tags.append("secrets_redacted=true")
    if turn.get("has_external_paste"):
        guard_tags.append("external_paste_isolated=true")
    guard_line = f"Security guards: {', '.join(guard_tags)}\n" if guard_tags else ""

    rules_section = ""
    if taste_candidate_eligible:
        rules_digest = _load_existing_rules_digest(workspace)
        if rules_digest:
            rules_section = f"Existing Governance Principles:\n{rules_digest}\n\n"

    record_section = ""
    if record_files:
        rec_excerpts = _load_record_excerpts(workspace, record_files)
        if rec_excerpts:
            record_section = f"Edited dated work record(s):\n{rec_excerpts}\n\n"

    diff_stat_section = f"Git diff stat:\n{turn['diff_stat']}\n\n" if turn.get("diff_stat") else ""
    user_section = turn["unconsumed_user_text"] if taste_candidate_eligible else turn["user_text"]
    input_summary = (
        f"{guard_line}"
        f"{rules_section}"
        f"{record_section}"
        f"{diff_stat_section}"
        f"User input:\n{user_section}\n\n"
        f"Edited files ({len(turn['edited_files'])}): {', '.join(turn['edited_files']) or 'none'}\n"
        f"Failed commands ({len(turn['failed_commands'])}): {'; '.join(turn['failed_commands']) or 'none'}\n\n"
        f"Assistant summary:\n{turn['assistant_tail']}"
    )[:10000]

    questions: dict = {}
    if taste_candidate_eligible:
        questions.update(TASTE_REFLECT_QUESTIONS)
    if needs_docs_check:
        questions["docs_maintenance_needed"] = DOCS_MAINTENANCE_QUESTION

    config = load_api_config(PLUGIN_DIR)
    threshold = float(config.get("confidence_threshold", 0.85))
    api_res = call_decisions_api(input_summary, questions, PLUGIN_DIR, config=config)

    if not api_res.get("ok"):
        append_harness_metric(
            {
                "source": "stop_hook",
                "mode": "API_ERROR",
                "repo": Path(workspace).name or "workspace",
                "verdict": "continue" if needs_docs_check else "error",
                "confidence": 0.0,
                "docs_choice": "unknown" if needs_docs_check else "",
                "api_calls_count": 1,
            }
        )
        _save_conv_state(conv_id, turn["turn_fingerprint"], conv_state["last_taste_step"])
        if not needs_docs_check:
            return {}
        err_reason = _build_reason_docs_sync(
            workspace,
            non_doc_files,
            "unknown",
            0.0,
            threshold,
            api_error=str(api_res.get("summary") or "Decisions API 不可用"),
        )
        return {
            "decision": "continue",
            "reason": err_reason,
        }

    answers = (api_res.get("response") or {}).get("answers") or {}
    taste_ans = answers.get("has_high_level_taste_lesson") or {}
    distinct_ans = answers.get("is_distinct_from_bugfix_detail") or {}
    scope_ans = answers.get("rule_scope") or {}

    taste_conf = _safe_confidence(taste_ans)
    distinct_conf = _safe_confidence(distinct_ans)
    scope_conf = _safe_confidence(scope_ans)

    next_taste_step = (
        max(conv_state["last_taste_step"], turn["latest_user_step_index"])
        if taste_candidate_eligible
        else conv_state["last_taste_step"]
    )
    _save_conv_state(conv_id, turn["turn_fingerprint"], next_taste_step)

    reasons: list[str] = []
    triggered_modes: list[str] = []

    taste_threshold = max(threshold, TASTE_CONFIDENCE_FLOOR)
    if (
        taste_candidate_eligible
        and taste_ans.get("choice") == "yes"
        and taste_conf >= taste_threshold
        and distinct_ans.get("choice") == "yes"
        and distinct_conf >= DISTINCT_CONFIDENCE_FLOOR
    ):
        scope_choice = (
            scope_ans.get("choice")
            if scope_ans.get("choice") in ("universal", "project_specific")
            else "project_specific"
        )
        artifact_dir = str(payload.get("artifactDirectoryPath") or "")
        triggered_modes.append("ASK_USER_UI")
        reasons.append(_build_reason_ask_ui(workspace, artifact_dir, scope_choice, scope_conf))

    docs_choice = ""
    docs_conf = 0.0
    if needs_docs_check:
        docs_ans = answers.get("docs_maintenance_needed") or {}
        docs_choice = str(docs_ans.get("choice") or "").strip()
        docs_conf = _safe_confidence(docs_ans)
        is_trivial_exempt = docs_choice == "no" and docs_conf >= threshold
        if not is_trivial_exempt:
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

    usage = (api_res.get("response") or {}).get("usage") or {}
    tokens_evaluated = int(usage.get("total_input_tokens", 0) or 0)
    metric_conf = docs_conf if needs_docs_check and docs_conf > 0 else min(taste_conf, distinct_conf)
    append_harness_metric(
        {
            "source": "stop_hook",
            "mode": "+".join(triggered_modes) if triggered_modes else "PASS",
            "repo": Path(workspace).name or "workspace",
            "verdict": "continue" if reasons else "allow",
            "confidence": round(metric_conf, 4),
            "docs_choice": docs_choice,
            "lesson_choice": str(taste_ans.get("choice") or "").strip(),
            "tokens_evaluated": tokens_evaluated,
            "api_calls_count": 1,
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
        is_pre_invocation = "--pre-invocation" in sys.argv[1:]
        if "--dry-run" in sys.argv[1:]:
            dry_idx = sys.argv.index("--dry-run")
            if dry_idx + 1 >= len(sys.argv):
                print("{}")
                return
            raw = Path(sys.argv[dry_idx + 1]).read_text(encoding="utf-8", errors="replace")
        else:
            raw = sys.stdin.read()

        if not raw.strip():
            print("{}")
            return

        payload = json.loads(raw)
        if not isinstance(payload, dict):
            print("{}")
            return

        result = capture_turn_baseline(payload) if is_pre_invocation else evaluate_stop_payload(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        _warn(f"Unhandled error in stop_reflect: {exc!r}")
        print("{}")


if __name__ == "__main__":
    main()
