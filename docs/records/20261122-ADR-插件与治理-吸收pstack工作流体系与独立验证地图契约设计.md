# ADR：吸收 pstack 工作流体系与独立验证地图契约设计

- **日期**：2026-11-22
- **状态**：已落地（当时有效）
- **域**：agent-mind-governance.md, dashboard-and-workflows.md
- **取代**：无

---

## 1. 问题与目标

- **约束与现象**：直接安装上游 `cursor/plugins/pstack` 或新建平行插件 `a8-skills`，会与现有 `a8-agent-mind` 产生四重冲突：
  1. **规则与预算冲突**：上游 `setup-pstack` 写入 `pstack-models.mdc` 硬编码模型名，与 Antigravity `model: inherit` 及 `TOKENS.md`（`< 1 KB`）冲突；
  2. **技能膨胀**：上游含 `61` 个 `SKILL.md`（`58` 个在 `skills/` 下 + `3` 个在 `automations/benny/skills/` 下）、`22` 本 Playbook 与 `2` 个 Agent 共 `85` 个单元，全量暴露会撑爆技能路由与上下文预算；
  3. **平台流程打架**：上游绑定 Cursor `.cursor/`、GitHub PR 堆叠、`gh` 命令行、Slack/Linear/Tailscale 与 macOS 工具链，而 A8 立足 Windows 本地多仓构建打包、DevTools Git Diff 审核、`a8-judge`/`dsh-reviewer` 与双层文档闭环；
  4. **缺跨仓实证路由**：仅凭编译、静态检查或 Mock 测试绿灯易假绿交卷，原有常青文档也未沉淀“改动模块 → 真实运行表面与本地环境盲区”的执行地图。
- **目标与非目标**：
  - **目标**：去重拆解 `pstack v0.15.46` 全部 `85` 单元，以平实中文落入 A8 三层协同架构与五级防错漏斗，建立独立根级验证地图契约（`docs/verify.md`）与双端全栈基础设施，统一采用大陆程序员常用直白命名，并留存可比对升级的来源映射台账；
  - **非目标**：不安装 `pstack` 原插件、不另建平行插件、不引入模型硬编码、云端 PR 合入或公网控制面暴露。

## 2. 核心设计与结论

### 2.1 三层协同与权责划分

1. **常驻规则与预算守门（`plugins/a8-agent-mind/rules/`、`skills/a8-improve/`、`agents/docs-sync.md`）**：
   - `rules/mind-rules.md`（`<= 18,500 B`）：保留全部 7 处历史锚点，补入可逆改动先干再报、`a8-workflow` 路由指针、先定数据结构与并发所有权、先减后加与降低读者理解负担（30 秒内看懂从哪来、谁能改）、5 类注释白名单（压制真 Bug 的 Lint 抑制必删）、跨边界双自检、共享状态先物理隔离再谈锁、禁放宽窄兜底、同前提连败 2 次停笔证伪前提、`docs/` 唯二根文档契约，以及交卷必跑 `docs/verify.md` 并核对 `.qnt` 模型同步；
   - `rules/TOKENS.md`（`954 B` < `1,000 B`）：完善第 4 条子代理分层（大日志/全量测/剖析留隔离子代理，换向或重试新建干净子代理，主会话亲审 Diff）与第 5 条「按可验证单元推进」；
   - `skills/a8-improve/SKILL.md`（`<= 19,500 B`）：Phase 1 增加「6 个月保质期滤网（剔除 SHA/版本号/临时计数）」与「跨会话 `>= 2` 次重复错类交叉验证」；Phase 2 升格为 **5 级防线阶梯**（架构消除 > 编译器类型 > 静态 `scripts/lints/` > 语义 `*.decision.json`/行为单测 > 自然语言规则）并新增「规则-强制器配对体检」；Phase 4 采用 `templates/improve_card.html` 提案并新增 `📋 待自动化积压 (Backlog)`；Phase 5 新增 **破坏抓虫验证实证门**（拿历史错例或临时破坏样本实测报 `FAIL`）与禁改插件运行缓存或借复盘开 PR；
   - `agents/docs-sync.md`（原封保留 `subagent: true`、`mainAgent: false` 与单行 `tools: [...]`）：定位为每晚 20:00 定时任务与按需手工调用的慢轨全量梳理协议，规范四类文档职责，将 `docs/verify.md` 纳入源码核验同步范围（禁放宽地图判据遮掩回归）、检查 `.qnt` 模型漂移，**严禁改业务源码/测试/`进行中`记录及 `git commit/push`**；
   - **快慢双轨文档治理演进**：`stop_reflect.py` 移除 `EVERGREEN_SYNC_QUESTION` 与 `docs-sync` 回合跟踪——日间写完 `docs/records/` 或 `evergreen` 文档即直接放行（仅未写任何文档的非平凡改码触发 `DOCS_MAINTENANCE`，引导当前上下文顺手轻更新且禁起 `docs-sync`）；新增 `scripts/scan_docs_sync.mjs` 与 `templates/nightly-evergreen-docs-sync.sidecar.json`（每晚 20:00 自动跳过无变更仓与靶场，仅梳理有新增提交/脏文件/体检异常仓并留存于工作区）；
   - `plugin.json`：核查两仓无 `"1.3.0"` 硬编码后升级至 `1.4.0`。
2. **按需单入口工作流与事前提示词深化（`skills/a8-workflow/` & `skills/a8-prompt/`，严控 7 大核心技能：3 自动内功 + 4 手动大招）**：
   - 技能层收敛为 **3 自动内功**（`a8-workflow`、`a8-judge`、`a8-ui-design`）+ **4 手动大招**（事前 `/a8-prompt` → 事中 `/a8-dsh-review` & `/a8-ui-verify` → 事后 `/a8-improve`）共 7 项（同步 `design.md`、`readme.md`）；新增 `skills/a8-prompt/SKILL.md`，禁改码、贴合仓地图答专家 4 问并重写“做深不做大”Prompt 即停；`a8-workflow/` 设 `SKILL.md`（§一.3 引向 `/a8-prompt`）+ 5 份场景指南（`guides/{analyze,bug-fix,perf,feature,long-task}.md`，附 `references/pstack-source-map.md`）：
     - `SKILL.md`：一两行小改免强开；提供不改码的「问路模式」与 §零 **自然语言直达路由**（一句自然语言直达进度恢复、机制/历史图解、爆炸半径、多方案比选、清注释/实证攻击），并含接单对齐门禁（复述目标、挑战复杂路线、模糊诉求引导 `/a8-prompt` 或隔离原型、切话题重置路由）、5 指南路由、`[实测/推断/待确认]` 标签、先查 `<repo>/docs/verify.md`、`swarm`/子代理隔离写区与干净派发、可逆先干边界及 **5 步 A8 统一收口**（输出 `<= 40` 行简报，长日志放 `logs/`）；
     - 5 份场景指南分别承担：只读机制/Git/本仓会话溯源与 5 级确信度（`analyze`）；查已有修复、真实表面双次复现、连败 2 次证伪前提与低成本路径务实 TDD（`bug-fix`）；无基线禁优化、单次 7 阶梯、多轮指标调优（`logs/<task>-perf.tsv`）与 **性能基准防伪 7 问核查**缺项判 `INCONCLUSIVE`（`perf`）；新功能 2 选 1/多方案融合/强类型与 `.qnt` 破坏抓虫、纯重构减负判据、`scratch/` 丢弃原型、像素对齐与 **5 类注释白名单（大改或清注释时派未参与写码的独立只读子代理扫描）**（`feature`）；4 要素规划、按磁盘物理副作用监工、`schedule` 无人值守、`logs/<task>-decisions.tsv` 防注入账本 + 独立 `Attention` 清单、长任务进度汇报与暂停/续跑/分级安全清理（`long-task`）。
3. **独立根级验证地图契约（`<repo>/docs/verify.md`，`VERIFY`）与 `.html` 可视化指南全栈支撑**：
   - 两仓 `scripts/lints/check_work_records.mjs` 扩白名单 `ALLOWED_ROOT_DOCS = Set(['glossary.md', 'verify.md'])`（均 `<= 20,000 B`）；
   - `stop_reflect.py`（`_classify_doc_path_role`）显式将 `docs/glossary.md` 与 `docs/verify.md` 归为 `"evergreen"` 防 Stop Hook 死循环（`evergreen/` 下仅 `.md` 归 `"evergreen"`，`.html` 归 `"other_doc"`；`check_stop_hook_invariants.py` 增补第 20 项不变量）；`judge_router.py`（`get_relevant_docs_for_files`）显式跳过 `.html`/`.htm` 防撑爆裁判上下文；
   - Rust（`agent_mind.rs`：`classify_repo_doc_tier`、`scan_repo_docs`、`tier_rank`）与 Sidecar（`main.mjs`：`classifyRepoDocTier`、`scanRepoDocs`、`tierRank`）递归扫描 `docs/**/*.{md,html}`，对称识别 `verify.md` -> `("verify", "VERIFY")` 与 `.html` -> `doc_type = "HTML"`（提取 `<title>`、`estimated_tokens = 0`、同 tier 置顶），排序为 `glossary (0) -> verify (1) -> evergreen (2) -> record (3) -> deferred (4) -> other (5)`，`is_allowed_repo_governance_rel` 对 `docs/**/*.{md,html}` 仅只读放行、禁止写入；
   - 前端 `RepoDocsBrowser.tsx` 渲染 violet 细线「验证地图」Tag 与 blue 细线「可视化」Tag，对 `.html` 采用 `<iframe sandbox="allow-scripts" srcDoc=...>` 沙箱预览、同步宿主 `data-theme="light|dark"` 并支持全屏切换；`AgentMindView.tsx` 同步 `scopedDocTierCounts` / `repoDocsStatsByRepo`、卡片「验证地图」角标、「常青文档」Tab 计数与 `onOpenDocLink` 跳转；
   - 落盘资产：`E:\a8-devtools\docs\evergreen\AI-研发工作流可视化指南.html`（四大能力、6 步顺序、7 大核心技能分工［3 自动内功 + 4 手动大招］与 8 种实战话术）、`E:\a8-devtools\docs\verify.md`（6 模块 + D1~D6 + 4 类本地环境盲区）与 `E:\a8-turbo\docs\verify.md`（8 模块 + S1~S7 + BeX5 只读红线 + Quint `.qnt` + 4 类盲区 + 7 条基准核查规范），两仓 `docs/glossary.md` 均补入「验证地图」词条。

### 2.2 被否决的备选方案与重评触发条件

| 被否决方案 | 否决原因 | 现行替代选择 |
| :--- | :--- | :--- |
| 直接装 `pstack` 或新建 `a8-skills` 暴露 58+ 技能 | 模型硬编码与 `TOKENS.md`/`model: inherit` 冲突；技能碎片化撑爆上下文；夹带 Cursor/GitHub PR/Slack/macOS 异构流程 | 常驻 `mind-rules` + `TOKENS` 守底线，单入口 `a8-workflow` 按需读 1 份场景指南 |
| 用 `docs/verify/` 子目录拆碎验证地图 | 割裂“改动模块 → 验证面”全局路由，增加子代理多文件检索成本与断链风险 | 单仓单篇 `< 20,000 B` 根级 `docs/verify.md`（`VERIFY`） |
| 把操作指南与验证卡并入 `docs/evergreen/*.md` | 将系统设计真相与实机运行命令/端口/测试桩混写，导致常青文档超 20KB 且被脚本修改频繁刷脏 | 四区职责隔离：`glossary` / `verify` / `evergreen` / `records` |

- **重评触发条件**：① 任一仓库 `docs/verify.md` 随模块扩张逼近 `18,000 B` 无法再压时，再以它作总索引按子系统拆分子卡；② Antigravity 支持按阶段目录原生懒加载子技能，或上游 `pstack` 大改阶段架构时，按第 2.3 节比对流程重审。

### 2.3 上游 `pstack` 版本锚点、归类来源表与升级比对方法

- **版本锚点**：仓库 `https://github.com/cursor/plugins/tree/main/pstack`（**MIT License**，作者 `Lauren Tan`），版本 **`v0.15.46`**，基准 Commit SHA **`0b46ec399d55f2829e88822998f53b84944837d3`**（`2026-11-19T22:12:08Z`）。
- **盘点基数与处置汇总**：实盘总基数 **85 单元**（`61` 个 `SKILL.md`［`34` 功能 + `24` `principle-*` + `3` Benny］+ `22` Playbook + `2` Agent）；汇总：**吸收 34 + 合并 11 + 部分吸收 33 + 拒绝 7 = 85**（`skills/sharpen/SKILL.md` 升为独立技能 `a8-prompt` 即 `吸收`，全量映射表与 MIT 原文见 [`pstack-source-map.md`](../../plugins/a8-agent-mind/skills/a8-workflow/references/pstack-source-map.md)）。

| A8 落地文件 | 借鉴的上游单元（上游原始名称） | 吸收的核心机制 |
| :--- | :--- | :--- |
| `rules/mind-rules.md` & `TOKENS.md` | `bro`、`unslop`、`no-comments`、`comment-sicko`、`principle-{never-block-on-the-human,foundational-thinking,subtract-before-you-add,minimize-reader-load,type-system-discipline,boundary-discipline,separate-before-serializing-shared-state,attack-the-premise,prove-it-works,guard-the-context-window,sequence-verifiable-units}` | 可逆先干、中文去水、5 类注释白名单与删遮 Bug 抑制、边界双自检、先物理隔离再锁、禁放宽窄兜底、连败 2 次证伪前提、子代理分层与按单元推进 |
| `a8-workflow/SKILL.md` | `poteto-mode`、`in-your-own-words`、`opening-a-pr`、`shipping`、`poteto-agent`、`principle-build-the-lever`、`swarm` | 接单复述与引向 `/a8-prompt`、切话题重置、`[实测/推断/待确认]`、先查验证地图、`swarm` 隔离与干净派发、5 步 A8 收口与 `<= 40` 行简报 |
| `a8-prompt/SKILL.md` | `sharpen` | 贴合仓地图答专家 4 问，改写“做深不做大”Prompt 后立即停步 |
| `guides/analyze.md` | `investigation`、`how`、`teach`、`why`、`recall`、`blast-radius`、`runtime-forensics`、`trace-forensics`、`triage-issue-reports` | 严格只读禁改码、渐进图解、Git/本仓会话溯源、5 级确信度、活进程剖析与离线转表还原 `file:line`、5 分类定责 |
| `guides/bug-fix.md` | `bug-fix`、`reproduce-and-fix-issues`、`tdd`、`principle-{attack-the-premise,fix-root-causes,test-behavior-not-implementation}` | 查已有修复、真实表面双次独立复现、二分排错、连败 2 次证伪前提、低成本路径务实 TDD 与双反证防假绿 |
| `guides/perf.md` | `perf-issue`、`hillclimb`、`benchmark-checklist`、`principle-explain-the-number` | 基线与剖析轮分离、7 阶梯优化、多轮调优双停步谓词与冻结桩、7 项防伪核查与 `INCONCLUSIVE` 裁决 |
| `guides/feature.md` | `feature`、`architect`、`arena`、`refactoring`、`prototype`、`visual-parity`、`interrogate`、`statechart`、`create/maintain-formal-verification-skill`、`typescript-best-practices`、`principle-{redesign-from-first-principles,exhaust-the-design-space}` | 跨边界 2 选 1 与多方案融合、4 维并发检查、强类型/不变量（Quint `.qnt` 或随机序列+破坏抓虫）、纯重构减负判据、`scratch/` 原型、像素 0 差异、5 类注释与对抗核验 |
| `guides/long-task.md` | `multi-phase-plan`、`autonomous-run`、`autopilot-full`、`figure-it-out`、`show-me-your-work`、`ketchup`、`pause-safely`、`session-pickup`、`worktree-cleanup` | 4 要素规划、按磁盘副作用监工、禁软化门禁、`schedule` 循环、`decisions.tsv` 防注入 + `Attention` 清单、长任务进度汇报、暂停/续跑与 `wip:N`/`scratch:N` 安全清理 |
| `skills/a8-improve/SKILL.md` | `correct`、`reflect`、`automate-me`、`eval`、`authoring-a-skill`、`principle-encode-lessons-in-structure` | 6 个月保质期滤网、跨会话 `>= 2` 次立类、5 级防线阶梯与配对体检、`Backlog`、破坏抓虫实证门、禁改运行缓存与开 PR、大改盲测提示 |
| `docs-sync.md` & `docs/verify.md` | `create-verification-skill`、`maintain-verification-skill`、`technical-writing`、`maintain-formal-verification-skill` | 验证地图契约、真实表面执行卡、本地环境盲区与基准核查、四类文档纯洁性、中文去水与 `.qnt` 模型漂移核查 |

- **明确不吸收模块清单及原因**：① `setup-pstack`（硬编码模型名违背 `model: inherit`）；② `make-bot-ui` / `setup-benny`（Slack/Linear/Tailscale 公网暴露与 Cursor 绑定）；③ `autopilot-stack` / `babysit`（云端 PR 堆叠与 GitHub 轮询，A8 用本地审核 + `a8-judge`/`dsh-reviewer`）；④ `ketchup-video` / `poteto-help` / `.cursor/skills/verify-*`（MP4 管线重、命令碎片化）；⑤ `poteto-agent` / `comment-sicko` 独立人设 Agent（避免扩大 `check_plugin_agents.py` 维护面）；⑥ `pele@1.9.0`+Java、`xcrun simctl`、英文 STE 语法（改用 `beautiful-mermaid`、Quint `.qnt`、`worktree`/`CowFS` 与平实中文）。
- **未来 `pstack` 升级增量比对与跟进**：
  - GitHub 对比 URL：`https://github.com/cursor/plugins/compare/0b46ec399d55f2829e88822998f53b84944837d3...main#files_bucket`
  - 本地稀疏拉取比对命令（放 `%TEMP%` 执行，不污染仓库）：
    ```bash
    git clone --filter=blob:none --sparse https://github.com/cursor/plugins.git && cd plugins && git sparse-checkout set pstack && git log -p 0b46ec399d55f2829e88822998f53b84944837d3..HEAD -- pstack
    ```
  - 增量评估步骤：对照 `pstack-source-map.md` 盘点新增/修改/删废单元及新 Tag/SHA -> 剥离平台耦合与英文修辞后按平实中文并入对应层 -> 校验各文件字节上限 -> 更新 `pstack-source-map.md` 与本仓门禁。

## 3. 当时验证范围

- **已验证（2026-11-22 统一命名重整后在本会话实测通过）**：
  - **Rust 编译与测试**：`cargo check --workspace` 与 `cargo test --workspace` 退出码 `0`（覆盖 `docs/**/*.{md,html}` 与 `docs/verify.md` 只读放行/写拦截、`scan_repo_docs` 6 级排序及 `.html` 同 tier 置顶断言）；`modules/devtools/web` 执行 `npm run build` 后，核实 `modules/devtools/ui/index.html` 仅含 `./preload.js` 与 `<script defer src="./assets/index.js"></script>`（无 `type="module"`/`crossorigin`）；
  - **两仓静态、路由、Sidecar 与不变量门禁全部 `[PASS]`**：`E:\a8-devtools` 下 `check_work_records.mjs`、`check_workspace_hygiene.mjs`、`check_swallowed_exceptions.mjs`、`check_plugin_agents.py`、`check_stop_hook_invariants.py`（20 项不变量，含 `docs-sync` 与 `docs/verify.md`）、`judge_router.py .`、插件 Sidecar 本地探活及 `E:\a8-turbo\scripts\lints\run_lints.py` 全部退出码 `0`；
  - **文件体积核验**：本 ADR、`mind-rules.md`、`TOKENS.md`、`a8-improve/SKILL.md`、`a8-prompt/SKILL.md`、`a8-workflow/*.md`、`docs/evergreen/*.md`、双仓 `docs/verify.md` 与 `AGENTS.md` 均 `< 20,000 B`。
- **未覆盖 / 依赖边界**：
  - 新 `a8-workflow`（含 `perf` 调优、`long-task` 账本与多阶段协同）尚未在真实 `E:\a8-turbo` CDC/gRPC 长任务中实战跑完，实战体验待后续任务检验；
  - 前端 `RepoDocsBrowser.tsx` 与 `AgentMindView.tsx` 更新后已完成 `npm run build` 与 Sidecar HTTP 接口校验，但本轮未拉起桌面端 `a8-devtools.exe` 实机目视复核深浅色切换与点击跳转；
  - 本机 `@oxlint/binding-win32-x64-msvc` 异常导致 `npm run lint`（`oxlint`）未跑通；`Stop` Hook 第 20 项测试使用 Mock `call_decisions_api`，线上 API 真实网络表现及 `a8-turbo` S1~S7 实机表面（Oracle/BeX5/Native）未在本轮重跑。

## 4. 对常青文档的影响

- 更新 [agent-mind-governance.md](../evergreen/agent-mind-governance.md)：挂载本 ADR 与 [AI-研发工作流可视化指南.html](../evergreen/AI-研发工作流可视化指南.html) 入口，同步 5 级防线阶梯、`TOKENS.md`、7 大核心技能（3 自动内功 + 4 手动大招）、`judge_router.py` 跳过 `.html`、`a8-improve` 滤网与 `improve_card.html`、**快慢双轨文档治理**（日间 `stop_reflect.py` 写入工作记录直放行与当前上下文轻更新 + 每晚 20:00 `scan_docs_sync.mjs`/`docs-sync` 定时全量梳理，含 20 项不变量）、`.qnt` 模型漂移核查及 `check_work_records.mjs` 双根文档白名单。
- 更新 [dashboard-and-workflows.md](../evergreen/dashboard-and-workflows.md)：挂载本 ADR 回链，第 4 节对照源码同步更新 `docs/**/*.{md,html}` 双端扫描、`classify_repo_doc_tier` / `classifyRepoDocTier` 与 `tier_rank` 6 级排序（`docs/verify.md` 对应 `tier = 'verify'`、`.html` 同 tier 置顶）、`is_allowed_repo_governance_rel` 只读/写守卫、`AgentMindView.tsx` 卡片角标/「常青文档」Tab 汇总/跳转，以及 `RepoDocsBrowser.tsx`「可视化」/「验证地图」标签与 `.html` `iframe` 沙箱预览。
- 更新 [AGENTS.md](../../AGENTS.md) 与 [verify.md](../verify.md)：`AGENTS.md` 第 2 节纳入 7 大核心技能与 `docs-sync`，第 3 节索引表挂载 [验证地图](../verify.md)（`VERIFY`）与 [AI-研发工作流可视化指南.html](../evergreen/AI-研发工作流可视化指南.html)（`VISUAL`），第 4 节交卷门槛纳入 `docs/verify.md`；`verify.md` 同步 D3 `.html` 沙箱预览判据与 D5 `docs-sync.md` / `judge_router.py .` 实测命令。
