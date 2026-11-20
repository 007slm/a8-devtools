# ADR：双层文档体系（Evergreen + Records）与隔离 Curator 闭环架构

- **日期**：2026-11-20
- **状态**：部分失效（被 20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md 更新）
- **域**：agent-mind-governance.md
- **取代**：20261110-SPEC-插件与治理-基于GoogleDecisionsAPI的语义红线裁判与规则沉淀设计.md（第 2.5 节原单层文档索引规范）

> **[部分失效（2026-11-20 补标）]**
> 本文第 2～3 节确立的 `evergreen/` + `records/` + `deferred/` 双层分域架构、渐进式披露回链、`docs-curator` 闭环及 `AGENTS.md` 表格路由修复持续有效；原第 2 节登记 `docs/INDEX.md` 的过渡做法以及第 4 节关于“`stop_reflect.py` 仅从父会话 `transcript.jsonl` 解析变更文件”的已知边界限制，已分别被 [20261120 工作台与治理规范 SPEC](20261120-SPEC-工作台与插件看板-门户Hero概览与仓库治理文档浏览器.md)（废弃冗余 `INDEX.md`，`AGENTS.md` 直挂常青文档）与 [20261120 严格 Git 回合快照 ADR](20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md) 取代更新。

---

## 1. 问题与目标

- **要解决的问题**：实测单层按日期追加模式下，`e:/a8-turbo/docs` 膨胀至 89 个文件（`1,050.9 KB`）、`docs/INDEX.md` 达 `56,678 B`（超 Antigravity 单文件 `24 KB` 截断上限两倍以上），且过程文档与已废除方案互相打架；同时 `stop_reflect.py` 无法识别“只写记录未更新常青文档”，且 `judge_router.py` / `review.ps1` 原要求 5 列表而静默跳过 4 列表 `AGENTS.md`。
- **设计目标**：建立常青文档与按日期工作记录正交分离的双层体系，引入隔离上下文 `docs-curator` 以真实源码核验同步常青真源，并修通 `AGENTS.md` ↔ `a8-judge` / `dsh-reviewer` 路由。

## 2. 核心设计与结论

1. **双层主目录 + 暂缓区**：
   - `docs/evergreen/*.md`：按业务域沉淀当前生效、无损、零重复的系统真相，直挂根目录 `AGENTS.md`（`< 20,000 B`）；
   - `docs/records/YYYYMMDD-<TYPE>-<MODULE>-<SUBJECT>.md`：承载决策权衡、故障复盘与规格，不挂 `AGENTS.md`，全部登记至 `docs/INDEX.md`（常规局部改动仅靠单测与注释，严禁滥建）；
   - `docs/deferred/*.md`：未落地或暂停设计单独隔离；
   - **否决替代方案**：否决在常青文档用一行式墓碑表丢掉历史触发条件；否决主会话改码后顺手原地糊常青文档；否决把常规 Bug 一律建 `*.decision.json`。
2. **渐进式披露回链与 `docs-curator` 闭环**：
   - 常青文档在对应章节挂载指向关键 `../records/YYYYMMDD-....md` 的回链供按需下钻；
   - `stop_reflect.py` 按 `_classify_doc_path_role` 区分 `evergreen` / `record` / `deferred` / `index` / `non_doc`，当本轮改动记录或非文档源码却未更新常青文档时触发 `EVERGREEN_SYNC_QUESTION`，需要同步时指令主会话调用 `invoke_subagent(TypeName="docs-curator", Workspace="inherit", ...)`；
   - `docs-curator` 严格遵守 **真实源码与测试 > `docs/records/` > 既有 `docs/evergreen/`**，严禁篡改业务源码。
3. **打通 `AGENTS.md` 路由**：`judge_router.py` 与 `review.ps1` 支持 4/5/6+ 列表头语义映射，隔离 `.cowdiff` 类词条误污染 `assoc_paths`。

```mermaid
flowchart LR
    Main["主会话: 改码 + 写 records/ 工作记录"] --> Stop["Stop Hook: 判定 evergreen_sync_needed"]
    Stop -->|yes| Curator["docs-curator (隔离上下文): 核验源码 -> 更新 evergreen/ & INDEX.md"]
```

## 3. 当时验证范围

- **2026-11-20 验证**：`py -3 scripts/lints/check_stop_hook_invariants.py` 与 `run_repo_lints.py .` 全绿；`e:/a8-devtools` 首期分域迁移将全仓文档精炼为 4 篇常青文档并同步 `AGENTS.md` 与 `docs/INDEX.md`。

## 4. 对常青文档的影响

- 本决策核心架构已沉淀至 [agent-mind-governance.md](../evergreen/agent-mind-governance.md)；原 `transcript.jsonl` 感知局限说明已被后续 Git 快照 ADR 替代。
