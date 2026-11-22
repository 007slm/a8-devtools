#!/usr/bin/env python3
"""Unit tests for judge_router.py and decisions_client.py backend-only filtering & token hygiene."""

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = SCRIPTS_DIR.parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import decisions_client as dc
import judge_router as jr


class TestJudgePipeline(unittest.TestCase):
    def test_filters_frontend_html_and_markdown_but_keeps_backend(self):
        filtered = [
            "docs/evergreen/AI-研发工作流可视化指南.html",
            "docs/evergreen/agent-mind-governance.md",
            "AGENTS.md",
            "plugins/a8-agent-mind/skills/a8-commit/SKILL.md",
            "modules/devtools/web/src/components/AgentMindView.tsx",
            "modules/devtools/web/src/utils/api.ts",
            "modules/devtools/web/src/styles/app.css",
            "frontend/src/pages/Home.vue",
            "web/src/index.jsx",
            "index.html",
        ]
        for path in filtered:
            self.assertFalse(jr._is_relevant_source_file(path), f"should filter non-backend file: {path}")

        kept = [
            "modules/devtools/src/main.rs",
            "modules/cowfs/src/state.rs",
            "plugins/a8-agent-mind/skills/a8-judge/scripts/decisions_client.py",
            "plugins/a8-agent-mind/sidecars/panel/main.mjs",
            "scripts/lints/check_work_records.mjs",
            "Cargo.toml",
            "backend/service/OrderService.java",
            "cmd/server/main.go",
        ]
        for path in kept:
            self.assertTrue(jr._is_relevant_source_file(path), f"should keep backend file: {path}")

    def test_deleted_file_diff_is_folded_to_tombstone(self):
        deleted_lines = "\n".join(f"-old_line_{i} = {i}" for i in range(500))
        raw_diff = (
            "diff --git a/plugins/a8-agent-mind/hooks/stop_reflect.py b/plugins/a8-agent-mind/hooks/stop_reflect.py\n"
            "deleted file mode 100644\n"
            "index 1111111..0000000\n"
            "--- a/plugins/a8-agent-mind/hooks/stop_reflect.py\n"
            "+++ /dev/null\n"
            "@@ -1,500 +0,0 @@\n"
            f"{deleted_lines}\n"
            "diff --git a/modules/devtools/src/main.rs b/modules/devtools/src/main.rs\n"
            "index 2222222..3333333 100644\n"
            "--- a/modules/devtools/src/main.rs\n"
            "+++ b/modules/devtools/src/main.rs\n"
            "@@ -1,2 +1,2 @@\n"
            "-fn old() {}\n"
            "+fn new() {}\n"
        )
        extracted = jr._extract_diff_sections(raw_diff)
        self.assertIn("stop_reflect.py", extracted)
        self.assertIn("[DELETED FILE:", extracted)
        self.assertNotIn("old_line_250", extracted)
        self.assertIn("+fn new() {}", extracted)
        self.assertLess(len(extracted), 1000)

    def test_doc_context_excludes_verify_and_glossary_and_stays_compact(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "docs" / "evergreen").mkdir(parents=True)
            (ws / "AGENTS.md").write_text(
                "| 文档路径 | 类型 | 域/模块 | 关联源码 | 核心用途 |\n"
                "| :--- | :--- | :--- | :--- | :--- |\n"
                "| [项目术语表](docs/glossary.md) | GLOSSARY | 术语 | 全仓库 | 共享术语 |\n"
                "| [验证地图](docs/verify.md) | VERIFY | 验证 | `modules/devtools/` | 验证命令 |\n"
                "| [核心架构](docs/evergreen/core.md) | EVERGREEN | 核心 | `modules/devtools/` | 边界与不变量 |\n",
                encoding="utf-8",
            )
            (ws / "docs" / "glossary.md").write_text("# Glossary\n" + ("词条定义说明文字。" * 300), encoding="utf-8")
            (ws / "docs" / "verify.md").write_text("# Verify\n```powershell\ncargo test\n```\n" + ("实机执行命令说明。" * 400), encoding="utf-8")
            (ws / "docs" / "evergreen" / "core.md").write_text(
                "# 核心架构\n\n## 1. 核心红线与有意权衡\n"
                "- 模块间保持严格单向依赖，底层内核禁止引入上层 UI 宿主框架。\n"
                "- 热点读路径禁止方法级大锁，采用细粒度锁或原子状态交换。\n\n"
                "## 2. 详细历史背景\n" + ("很长的无关细节描述段落内容。" * 400),
                encoding="utf-8",
            )
            ctx = jr.load_documented_decisions_context(ws, ["modules/devtools/src/main.rs"])
            self.assertNotIn("docs/verify.md", ctx)
            self.assertNotIn("docs/glossary.md", ctx)
            self.assertIn("docs/evergreen/core.md", ctx)
            self.assertIn("严格单向依赖", ctx)
            self.assertLessEqual(len(ctx), 2600)

    def test_all_four_categories_pack_into_single_question_batch(self):
        all_dec, errs = jr.load_all_decisions(PLUGIN_DIR, workspace_dir=PLUGIN_DIR.parents[1])
        self.assertEqual(errs, [])
        dec_by_id = {d["id"]: d for d in all_dec}
        dyn_rules = jr.load_rules(PLUGIN_DIR, workspace_dir=PLUGIN_DIR.parents[1])
        rules_by_cat = {c: [] for c in jr.ALL_CATEGORIES}
        for r in dyn_rules:
            if r.get("category") in rules_by_cat:
                rules_by_cat[r["category"]].append(r)
        qpool = {}
        for cat in jr.ALL_CATEGORIES:
            for k, v in dc._build_category_question_parts(cat, dec_by_id[cat], rules_by_cat[cat]):
                qpool[k] = v
        batches = dc._pack_question_batches(qpool)
        self.assertEqual(len(batches), 1, f"All 4 core categories must fit in 1 batch, got {len(batches)}")

    def test_pure_frontend_and_doc_diff_activates_zero_categories(self):
        frontend_diff = (
            "diff --git a/modules/devtools/web/src/App.tsx b/modules/devtools/web/src/App.tsx\n"
            "--- a/modules/devtools/web/src/App.tsx\n"
            "+++ b/modules/devtools/web/src/App.tsx\n"
            "@@ -1,2 +1,3 @@\n"
            "+try { console.log('ui'); } catch (e) {}\n"
            "diff --git a/docs/evergreen/AI-研发工作流可视化指南.html b/docs/evergreen/AI-研发工作流可视化指南.html\n"
            "--- a/docs/evergreen/AI-研发工作流可视化指南.html\n"
            "+++ b/docs/evergreen/AI-研发工作流可视化指南.html\n"
            "@@ -1,2 +1,2 @@\n"
            "+<div>legacy compat</div>\n"
        )
        rules = jr.load_rules(PLUGIN_DIR, workspace_dir=PLUGIN_DIR.parents[1])
        decisions, _ = jr.load_all_decisions(PLUGIN_DIR, workspace_dir=PLUGIN_DIR.parents[1])
        res = jr.analyze_diff(frontend_diff, rules, decisions=decisions, workspace_dir=PLUGIN_DIR.parents[1])
        self.assertEqual(res["diff_length"], 0)
        self.assertEqual(res["changed_files"], [])
        self.assertEqual(res["activated_categories"], [])


if __name__ == "__main__":
    unittest.main()
