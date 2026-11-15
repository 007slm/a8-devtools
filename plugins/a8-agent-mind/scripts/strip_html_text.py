#!/usr/bin/env python3
"""
strip_html_text.py - Zero-dependency HTML/Email boilerplate stripper for Context Engineering.
Removes <style>, <script>, <head>, <svg>, VML/HTML comments, and excessive whitespace
from HTML or JSON-wrapped email payloads before feeding text into LLM context windows.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SKIP_TAGS = {"style", "script", "head", "title", "svg", "noscript", "template", "xml", "o:officeDocumentSettings"}
BLOCK_BREAK_TAGS = {
    "p", "div", "section", "article", "header", "footer", "aside", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "table", "hr", "br",
}
ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\u202a-\u202e\ufeff\u00ad]+")
VML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
STYLE_BLOCK_RE = re.compile(r"<(style|script|head|svg|xml)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
TAG_DETECT_RE = re.compile(r"<(?:!doctype|html|head|body|style|div|table|p|span|a|br)\b", re.IGNORECASE)


class _DenseTextExtractor(HTMLParser):
    """Streaming HTMLParser converting markup into compact, readable plain lines."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._skip_depth = 0
        self._parts: list[str] = []
        self._link_href: str | None = None
        self._link_label: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower in SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth > 0:
            return
        if lower in BLOCK_BREAK_TAGS:
            self._parts.append("\n")
        if lower == "li":
            self._parts.append("- ")
        elif lower == "a":
            href = dict(attrs).get("href") or ""
            href = href.strip()
            if href.startswith(("http://", "https://")) and len(href) <= 240:
                self._link_href = href
                self._link_label = []

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in SKIP_TAGS:
            if self._skip_depth > 0:
                self._skip_depth -= 1
            return
        if self._skip_depth > 0:
            return
        if lower == "a" and self._link_href is not None:
            label = " ".join("".join(self._link_label).split()).strip()
            href = self._link_href
            self._link_href = None
            self._link_label = []
            if label and href not in label:
                self._parts.append(f"[{label}]({href})")
            elif label:
                self._parts.append(label)
        elif lower in BLOCK_BREAK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if self._link_href is not None:
            self._link_label.append(data)
        else:
            self._parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.handle_data(html.unescape(f"&{name};"))

    def handle_charref(self, name: str) -> None:
        self.handle_data(html.unescape(f"&#{name};"))

    def get_text(self) -> str:
        raw = html.unescape("".join(self._parts))
        raw = ZERO_WIDTH_RE.sub("", raw).replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.split("\n")]
        collapsed: list[str] = []
        blank_streak = 0
        for ln in lines:
            if not ln:
                blank_streak += 1
                if blank_streak <= 1 and collapsed:
                    collapsed.append("")
            else:
                blank_streak = 0
                collapsed.append(ln)
        return "\n".join(collapsed).strip()


def strip_html_to_text(raw_html: str) -> str:
    """Strips HTML/VML/CSS boilerplate and returns compact line-oriented text."""
    if not raw_html or not raw_html.strip():
        return ""
    if not TAG_DETECT_RE.search(raw_html):
        cleaned = ZERO_WIDTH_RE.sub("", html.unescape(raw_html)).replace("\xa0", " ")
        return re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    pre_cleaned = VML_COMMENT_RE.sub(" ", raw_html)
    pre_cleaned = STYLE_BLOCK_RE.sub(" ", pre_cleaned)
    extractor = _DenseTextExtractor()
    extractor.feed(pre_cleaned)
    extractor.close()
    return extractor.get_text()


def _compact_json_node(node: object) -> object:
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(v, str) and (TAG_DETECT_RE.search(v) or len(v) > 2000 and "<" in v):
                out[k] = strip_html_to_text(v)
            else:
                out[k] = _compact_json_node(v)
        return out
    if isinstance(node, list):
        return [_compact_json_node(item) for item in node]
    return node


def extract_clean_content(raw_text: str, max_chars: int = 0) -> str:
    """Auto-handles plain HTML or JSON payloads and enforces an optional character budget."""
    stripped = raw_text.lstrip()
    result = ""
    if stripped.startswith(("{", "[")):
        try:
            parsed = json.loads(raw_text)
            compacted = _compact_json_node(parsed)
            result = json.dumps(compacted, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            result = strip_html_to_text(raw_text)
    else:
        result = strip_html_to_text(raw_text)

    if max_chars > 0 and len(result) > max_chars:
        return result[:max_chars].rstrip() + f"\n\n[truncated at {max_chars} chars]"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Strip high-noise HTML/CSS/VML tags into dense plain text.")
    parser.add_argument("--input", "-i", help="Input HTML/JSON/text file path (defaults to stdin).")
    parser.add_argument("--max-chars", type=int, default=0, help="Optional max output characters (0 = unlimited).")
    args = parser.parse_args()

    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    raw = Path(args.input).read_text(encoding="utf-8", errors="replace") if args.input else sys.stdin.read()
    print(extract_clean_content(raw, max_chars=args.max_chars))


if __name__ == "__main__":
    main()
