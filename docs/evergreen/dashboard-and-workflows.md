# 三端同源看板、代码审核与 Grok 每日提案联动（常青文档）

> **所属域**：前端单一构建产物、三端同源适配、提交前 Git Diff 代码审核与 Grok 每日提案闭环（专有术语见 [项目术语表](../glossary.md)）  
> **适用源码**：`modules/devtools/web/`、`modules/devtools/ui/`、`modules/devtools/src/agent_mind.rs`、`modules/devtools/src/brain_wiki.rs`、`modules/devtools/src/sidecar.rs`、`plugins/a8-agent-mind/sidecars/panel/main.mjs`、`plugins/a8-agent-mind/sidecars/panel/brain_wiki.mjs`  
> **相关记录（渐进式披露）**：
> - [A8 Brain 个人 LLM Wiki 知识大脑与 Antigravity 联动规范](../records/20261122-SPEC-工作台与插件看板-A8Brain个人LLMWiki知识大脑与Antigravity联动.md)
> - [三端同源 Dashboard 白屏根因与防踩坑指南](../records/20261114-BUG-工作台与插件看板-三端同源Dashboard白屏根因与防踩坑指南.md)
> - [Grok 每日 AI 提案面板与 Antigravity 联动契约](../records/20261115-SPEC-工作台与插件看板-Grok每日AI提案面板与Antigravity联动契约.md)
> - [提交前 Git Diff 人工代码审核工作台设计](../records/20261116-SPEC-工作台与插件看板-提交前GitDiff人工代码审核工作台设计.md)
> - [严格 Git 回合增量快照（PreInvocation + Stop）与无 Git 静默边界 ADR](../records/20261120-ADR-插件与治理-严格Git回合增量快照与无Git静默边界.md)
> - [门户 Hero 概览与仓库治理文档浏览器](../records/20261120-SPEC-工作台与插件看板-门户Hero概览与仓库治理文档浏览器.md)
> - [Markdown 架构图渲染引擎切换至 beautiful-mermaid (ELK) ADR](../records/20261120-ADR-工作台与插件看板-Markdown架构图引擎切换至beautiful-mermaid.md)
> - [吸收 pstack 工作流体系与独立验证地图契约设计 ADR](../records/20261122-ADR-插件与治理-吸收pstack工作流体系与独立验证地图契约设计.md)

---

## 1. 三端同源单一路径架构

```text
前端唯一源码: modules/devtools/web (React + Tailwind v4 + HeroUI v3)
    │  npm run build (tsc -b && vite build; base: './', format: 'iife', inlineDynamicImports: true)
    ▼
唯一静态产物: modules/devtools/ui/{index.html, preload.js, assets/index.js}
    ├──► 入口 1: a8-devtools.exe 桌面主窗 (Tauri IPC invoke)
    ├──► 入口 2: a8-devtools.exe 进程内 Web 看板 (127.0.0.1:18765, sidecar.rs)
    └──► 入口 3: plugins/a8-agent-mind/sidecars/panel/main.mjs (Antigravity Aux Pane, 托管/透传)
```

### 1.1 防白屏核心不变量（强制守恒）
1. **经典 IIFE 单包输出**：`vite.config.ts` 固定 `base: './'`、IIFE 单包 `assets/index.js`（CSS 运行时内联注入），并通过 `classicSidecarHtmlPlugin()` 剥离 `<script>` 与 `<link>` 的 `type="module"` 和 `crossorigin` 属性，防止自定义协议 WebView（`plugin://`、`vscode-webview://`、`Origin: null`）因 CORS 或 Hash 缓存失配白屏。
2. **`preload.js` 桥接与单一产物约束**：`index.html` 在主脚本前加载 `./preload.js`（`main.mjs` 优先读取宿主 `sidecar_sdk/preload.js`，非宿主环境回退 `public/preload.js` 静默兜底）；禁止再存在独立手写 `sidecars/panel/index.html` 独立副本，构建产物缺失时直接返回 `503`。
3. **顶层容错与环境隔离**：`main.tsx` 永久包裹 `RootErrorBoundary`；`App.tsx` 通过 `isStandaloneSidecar` 在独立看板模式下跳过桌面端 `get_workspaces` / `get_net_speed` 轮询。
4. **Origin 与鉴权分流边界（`sidecar.rs` & `main.mjs`）**：
   - 非 `/api/` 的 `GET` / `HEAD` 静态资源与 `OPTIONS` 预检**不经过 Origin 拦截**，下发 `Access-Control-Allow-Origin: *` 与 `Cache-Control: no-store`；
   - `/api/` 控制面仅放行无 `Origin`、`Origin: null`、本地自定义协议（`tauri:`、`plugin:`、`vscode-webview:`、`antigravity:`、`antigravity-sidecar:`、`file:`）及回环地址（`127.0.0.1`、`localhost`、`tauri.localhost`、`::1`），对外部网页 Origin（如 `https://evil.example.com`）严格返回 `403`；
   - `main.mjs` 在 `ANTIGRAVITY_SIDECAR_UI_TOKEN` 存在时对 `/_sidecar/*` 校验 `X-Sidecar-Token`；Rust 与 Node `POST` 接口均强制要求 `Content-Type: application/json`。

---

## 2. 独立一级入口：提交前 Git Diff 代码审核（`CodeReviewTab`）

- **独立并列定位**：作为一级入口与「心智治理（`AgentMindView`）」并列（桌面左侧主导航 + 独立 Web 顶栏切换 `心智治理` | `代码审核`，支持 `?tab=code-review` 直达）。
- **控制面契约**：Tauri Command `get_repo_git_diff` ↔ HTTP `POST /api/agent-mind/git/diff`，入参 `{ repo_code, scope?: "all" | "staged" | "unstaged" }`，返参 `GitReviewDiffDto`。
- **非 Git 仓库健康标识（`has_git`）**：
  - `agent_mind.rs`（`HostProjectCardDto.has_git` via `has_git_repo`）与 `main.mjs`（`parseReposMd` `has_git` via `hasGitRepo`）通过无进程遍历项目路径祖先目录的 `.git` 判定是否为 Git 仓库，且显式跳过驱动器根目录（如 `C:\.git`）防误判；
  - 当 `has_git === false` 时，`AgentMindView.tsx`（「仓库地图」卡片、详情页横幅与「规则规范」作用域选择器）以及 `CodeReviewTab.tsx`（仓库下拉选项 `<repo> (无 Git)` 与旁侧 `未检测到 .git` 琥珀徽章）均显式提示该仓库未受 Git 管理，提交前代码审核与 `/a8-commit` 提交门禁不可用。
- **安全与性能边界**：
  - `resolve_registered_repo_root` 仅允许 `repos.md` 白名单内已登记仓库，拒绝任意路径注入；
  - 零黑窗执行 `git`（Rust `0x08000000` / Node `windowsHide: true`），统一附带 `-c core.quotePath=false` 防中文路径转义；
  - `scope` 为 `all` 或 `unstaged` 时扫描 `git ls-files --others --exclude-standard`，探测前 8 KB 是否含 `\0` 识别二进制，纯文本合成为标准 Unified Diff；
  - 截断保护：单文件 Diff 上限 `300 KB`，未追踪文件上限 `256 KB` / `2500` 行，超限置 `truncated = true`。
- **交互与反馈闭环**：`gitDiff.ts` 支持 `Split`（行内字符级高亮）与 `Unified` 视图、单文件聚焦（首屏 350 行按需展开）及 `React.memo` 隔离；行号槽位点击/`Shift+点击` 框选跨行批注（按 `a8_code_review_v1:<repoCode>` 缓存至 `localStorage`），`formatReviewFeedbackMarkdown` 汇总为 Markdown 供复制回传 Antigravity。

---

## 3. Grok 每日 AI 提案面板与 Antigravity 联动

- **存储与 Frontmatter 契约**：每日提案存于 `<a8-devtools_root>/logs/grok-proposals/<YYYY-MM-DD>.md`（纳入 `.gitignore`；长 HTML 邮件先经 `plugins/a8-agent-mind/scripts/strip_html_text.py` 降噪）。Frontmatter 字段含 `date`、`title`、`source_subject`、`source_date`、`proposal_count`、`status`（4 态：`pending` / `in_progress` / `adopted` / `dismissed`）、`summary`（缺失时解析器从文件名与正文自动推断）。
- **控制面接口（`agent_mind.rs` / `sidecar.rs` / `main.mjs`）**：
  - `get_agent_mind_overview` (`GET /api/agent-mind/overview`)：同时返回 `proposals`、`proposals_dir` 与 `telemetry`；
  - `read_grok_proposal` (`POST /api/agent-mind/proposal/read`)、`update_grok_proposal_status` (`.../proposal/status`)、`delete_grok_proposal` (`.../proposal/delete`)、`open_grok_proposals_dir` (`.../proposal/open-dir`)、`advance_proposal_in_antigravity` (`.../proposal/advance`，若原状态为 `pending` 自动流转为 `in_progress`)。
- **文件名路径安全边界（`resolve_safe_proposal_file`）**：拒绝含 `/`、`\`、`:`、`..`、`~`、`\0` 或尾随 `.`/空格 的单段文件名之外输入，仅允许 `.md` 后缀并经 `canonicalize` / `realpathSync` 断言位于 `logs/grok-proposals` 内。
- **「回到 Antigravity 推进」跨端链路**：
  - **划词批注**：`ProposalDetailAnnotator.tsx` 支持划词 `批注` / `划删` / `替换`（缓存 `a8_proposal_annotations_v1:<file_name>`），`buildProposalAdvancePrompt` 自动打包注入会话 Prompt；
  - **Sidecar 宿主内**：直接调 `window.sidecar.agent.startConversation` + `window.sidecar.ui.toggleConversation`；
  - **桌面端 / `:18765`**：脱离宿主环境时扫描 `%USERPROFILE%\.gemini\antigravity\daemon\hub_*.json`（按 mtime 倒序），经 Win32 `OpenProcess` + `GetExitCodeProcess` + `QueryFullProcessImageNameW` 校验 `language_server.exe` 存活及 `127.0.0.1:<httpPort>` TCP 探活后注入环境变量，以 `CREATE_NO_WINDOW` 执行 `language_server.exe agentapi new-conversation`，再经 `EnumWindows`（局部 `LPARAM` 无静态竞态）+ `SetForegroundWindow` 置前（未运行则 `ShellExecuteW` 拉起）。

---

## 4. 门户 Hero 概览与双层治理文档浏览器

- **统一门户 Hero（`PortalHero.tsx`）**：采用 `rounded-2xl` 纯白/深色细线容器与 `icon` / `eyebrow` / `title` / `description` / `badge` / `metrics` / `actions` 插槽，已集成至 `Hosts`（`App.tsx`）、`CodeReviewTab`（`CodeReviewTab.tsx`）及 `AgentMindView.tsx` 的 `rules`、`reviews`、`proposals`、`projects` 四个核心视图。
- **双端同构 `README` 与 `docs/` 扫描契约（零兼容单一解析）**：
  - **仓库 `README` 探测**：Rust（`agent_mind.rs` `detect_repo_readme` → `HostProjectCardDto.readme_rel_path`）与 Sidecar（`main.mjs` `detectRepoReadme` → `parseReposMd` `readme_rel_path`）按 `["README.md", "readme.md"]` 顺序探测已登记仓库根目录常规文件，缺失时返回空串；
  - **递归扫描 `docs/`**：`scan_repo_docs` ↔ `scanRepoDocs` 递归扫描 `repos.md` 已登记仓库的 `docs/**/*.{md,html}`（跳过 `.git`、`node_modules`、`target`、`.cowdiff`、`.cowlink`），输出 `RepoDocEntryDto` 挂载至 `AgentMindOverviewDto.repo_docs`（`.html` 可视化指南提取 `<title>`、固定 `doc_type = "HTML"`、`estimated_tokens = 0`，并在同一 tier 内排在 `.md` 之前）；
  - `parse_doc_meta` ↔ `parseRepoDocMeta`：`.md` 仅扫描前 20 行提取首个 `#` 标题（缺失回退文件名）与唯一标准前缀 `- **状态**：`（最长 48 字符，已移除 `决策状态` 等非标旧头兜底），并从文件名 `YYYYMMDD-<TYPE>` 提取 `date` 与 `doc_type`；
  - `classify_repo_doc_tier` ↔ `classifyRepoDocTier`：严格按 `docs/glossary.md`（`glossary` / `GLOSSARY`）、`docs/verify.md`（`verify` / `VERIFY`）、`evergreen/`（`evergreen` / `EVERGREEN`）、`deferred/`（`deferred` / `DEFERRED`）、`records/` 或带日期前缀（当状态以 `已废弃` 或 `已暂缓` 开头时自动归入 `deferred`，其余归 `record`；`doc_type` 取文件名解析值或回退 `RECORD`）以及 `other`（`DOC`）六类归档（其中 `.html` 固定 `HTML`，其余 `evergreen`、`glossary`、`verify` 强制使用固定 `doc_type`）；统计 `size_bytes` 与 `estimated_tokens`（前端仅对非 `.html` 且 `size_bytes >= 20000` 显示 `ShieldAlert` 24 KB 截断预警），排序优先级为 **`repo` 升序 → tier 优先级（`glossary (0) -> verify (1) -> evergreen (2) -> record (3) -> deferred (4) -> other (5)`）→ `HTML` 优先 → `date` 降序 → `modified_ts` 降序 → `rel_path` 升序**。
- **只读与写入隔离边界（`is_allowed_repo_governance_rel` ↔ `isAllowedRepoGovernanceRel`）**：
  - 仓库作用域调用 `read_agent_mind_file`（`POST /api/agent-mind/read`）传入 `repo_code` + `rel_path` 且 `writable == false` 时，放行仓库根目录 `README.md`（大小写不敏感匹配 `readme.md`）、`docs/**/*.{md,html}`（含 `docs/glossary.md`、`docs/verify.md` 与 `docs/evergreen/*.html` 可视化指南）与 `scripts/lints/*.py|.mjs` 的只读读取；
  - 写入边界（`writable == true`）仍严格锁定 `AGENTS.md`/`GEMINI.md`、`.agents/rules/*.md` 与 `scripts/lints/*.decision.json`，严禁经由面板或文档浏览器修改仓库 `README.md` 或 `docs/`（含 `docs/verify.md`）。
- **仓库详情三段结构与 Tag 化文档浏览器（`AgentMindView.tsx` & `RepoDocsBrowser.tsx`）**：
  - **仓库卡片与详情三段主导航（`projects`）**：Hero 统计区与卡片计数由 `repoDocsStatsByRepo`（以及 `rules` 视图下的 `scopedDocTierCounts`）汇总；卡片角标展示 `README`/`无 README`、`术语表`（`docCounts.glossary > 0`）、**`验证地图`**（`docCounts.verify > 0`，violet 细线标签）、`常青 N`（`docCounts.evergreen > 0`）与非常青 `docs M`（精确统计 `total - evergreen - glossary - verify`，以及 `无 Git` 预警）；点击进入仓库详情默认打开 **`主页`**（首屏直呈仓库 `README.md`，`onOpenDocLink` 点击 `docs/glossary.md`、`docs/verify.md` 或 `docs/evergreen/` 链接自动切至 `'evergreen'` 页签，其余 `docs/` 切至 `'docs'` 页签），副栏右侧提供 **`仓库地图档案`** 抽屉按钮（滑出阅读/编辑 `repos/*.md`，含未保存退出守卫）；顶栏右侧可切换 **`常青文档`**（`<RepoDocsBrowser variant="evergreen" />`，纳入 `evergreen | glossary | verify` 三类文档，计数为三者之和且置顶 `术语表` 与 `验证地图`）与 **`docs 文档`**（`<RepoDocsBrowser variant="docs" />`，过滤排除 `evergreen`、`glossary`、`verify`，角标精确统计 `total - evergreen - glossary - verify`）；
  - **去分类 Tab、左栏一键收起、Tag 化表达与 `.html` 沙箱预览（`RepoDocsBrowser.tsx`）**：`RepoDocEntry['doc_tier']` 支持 `'glossary' | 'verify' | 'evergreen' | 'record' | 'deferred' | 'other'`；在 `rules` 视图的 `治理文档` 子标签（`variant="all"`，全局模式显示 `showRepoBadge`）与仓库详情复用同一浏览器组件，移除冗余分类分页 Tab，仅在 `variant !== 'evergreen'` 或文档数 `> 6` 时展示搜索框（匹配标题、路径、类型、Tag 标签、状态、日期或仓库），左侧列表通过统一 Tag（`可视化`［blue 细线，对应 `.html`］ / `术语表` / `验证地图`［violet 细线］ / `常青` / `已废弃` / `暂缓` / `ADR` / `BUG` / `SPEC` / `DOC`，叠加 `部分失效` 徽标）直观表达类型与时效状态；对 `.html` 可视化指南采用 `<iframe sandbox="allow-scripts" srcDoc=...>` 沙箱隔离渲染（不授予 `allow-same-origin` 防访问宿主 IPC/DOM），经 `MutationObserver` + `applyHostThemeToHtmlDoc` 自动同步宿主 `data-theme="light|dark"`，并提供全屏切换按钮（支持 `Escape` 退出）；阅读区顶栏左侧提供 `PanelLeftClose` / `PanelLeftOpen`（`listOpen` 状态）按钮，支持一键收起左侧文档列表切换为 `lg:col-span-12` 全宽沉浸阅读；
  - **失效警示与跨层回链下钻**：对状态以 `已废弃` 或 `部分失效` 开头的工作记录在阅读区顶部渲染 `ShieldAlert` 失效告警横幅；`variant="evergreen"` 传入完整 `allRepoDocs` 池，点击常青文档内相对回链（如 `../records/...md`）可原位下钻阅读记录全文并通过顶栏 `返回` 历史栈回退。
- **Markdown 架构图渲染（`MermaidBlock.tsx`）**：采用 `beautiful-mermaid`（ELK 折线自动布局）同步渲染纯 SVG，经 `sanitizeAndNormalizeSvg` 剥离外链字体 `@import`、切换本机字体栈并拦截 `<script` 标签，同时支持拖拽平移、多档缩放/全屏与导出 `diagram.svg`。

---

## 5. 个人知识大脑（`A8 Brain` LLM Wiki 与 Antigravity 联动）

- **一级独立入口与双端同构**：在桌面端左侧导航与独立看板/Sidecar 顶栏并列提供 **`知识大脑`**（`brain` / `?tab=brain`，`BrainWikiView.tsx`），共用安全零 HTML 注入渲染器 `MarkdownArticle.tsx`（支持 `[[slug|label]]` 双向链接可点击芯片跳转与断链标识）与统一唤起器 `antigravityLauncher.ts`。
- **存储、自举与 `config.json` 配置**：默认位于 `plugins/a8-agent-mind/wiki/`（已 `.gitignore` 仅本地保存），首次访问幂等自举 `SCHEMA.md`、`index.md`、`log.md`、`raw/`、`pages/`；支持通过 `set_brain_wiki_dir`（`POST /api/agent-mind/brain/set-dir`）仅改写 `config.json` 的 `wiki_dir` 字段指向任意外部目录/私有仓（`AgentMindModelConfigPanel.tsx` 保存模型参数时保留 `wiki_dir` 等附加键）。
- **控制面与安全边界（`brain_wiki.rs` ↔ `brain_wiki.mjs`）**：
  - 8 个对称接口：`get_brain_wiki_overview`（`GET /api/agent-mind/brain/overview`）、`read_brain_wiki_file`（`.../brain/read`）、`create_brain_raw_note`（`.../brain/raw/create`）、`save_brain_wiki_file`（`.../brain/save`）、`delete_brain_wiki_file`（`.../brain/delete`）、`open_brain_wiki_dir`（`.../brain/open-dir`）、`set_brain_wiki_dir`（`.../brain/set-dir`）、`launch_brain_in_antigravity`（`.../brain/launch`，复用 `launch_antigravity_conversation` 支持 `ingest` / `brainstorm` / `lint` 三模式）；
  - 路径白名单与防逃逸：仅放行 `SCHEMA.md`、`index.md`、`log.md`、`raw/*.md`（最深 2 层）与 `pages/**/*.md`（最深 3 层），经 `canonicalize` / `realpathSync` 断言位于知识库根目录内，禁止删除 3 个核心元数据文件；链接解析自动跳过代码块与行内代码，并统计反向引用（Backlinks）、断链与孤立页面。

---

## 6. 交付验证标准与非目标

- **交付必查清单**：改前端后 `npm run build` 检查 `modules/devtools/ui/index.html` 无 `type="module"`/`crossorigin` 且含 `preload.js` + `assets/index.js`；改服务端后校验无 Origin / `Origin: null` / `plugin://` 返回 `200`，外部 Origin 调用 `/api/*` 返回 `403`；若更新 `main.mjs` 须重启插件 Sidecar 进程。
- **非目标**：不为插件 Sidecar 单独维护另一套 HTML/前端工程；不允许 `get_repo_git_diff`、提案读取或 `RepoDocsBrowser` 写入越出白名单目录。
