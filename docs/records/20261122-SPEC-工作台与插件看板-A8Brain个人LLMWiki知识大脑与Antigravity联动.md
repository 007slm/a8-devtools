# SPEC：A8 Brain 个人 LLM Wiki 知识大脑与 Antigravity 联动

- **日期**：2026-11-22
- **状态**：已落地（当时有效）
- **域**：dashboard-and-workflows.md, agent-mind-governance.md
- **取代**：无

---

## 1. 问题与目标

- **约束与现象**：日常从 Twitter、技术文章与实践中获得的跨项目经验（Skill 用法、多 Agent 协作模式、学习原则等）既不适合写成独立 Skill，也不归属单一代码仓库；需要一个既可随时记录浏览、又能被技能低 Token 精准调取的个人知识库，且整理分类建链不引入额外外部大模型 API Key 成本。
- **目标与非目标**：落地基于 LLM Wiki 分层架构的 `A8 Brain` 知识库（默认存 `plugins/a8-agent-mind/wiki/` 并纳入 `.gitignore`，支持 `config.json` `wiki_dir` 改指向外部目录）、三端同源一级入口「知识大脑 (`BrainWikiView.tsx`)」及纯手动触发技能 `/a8-brain`；明确不做重型向量数据库检索、不自动在日常编码会话中加载知识库。

## 2. 核心设计与结论

- **最终决定 / 契约**：
  - 采用 `SCHEMA.md` + `index.md` + `log.md` + `raw/`（只增不改原正文的随手记收件箱）+ `pages/`（Antigravity 维护的互链知识页）五件套布局，首次访问幂等自举；
  - Rust（`modules/devtools/src/brain_wiki.rs` + `sidecar.rs`）与 Node Sidecar（`plugins/a8-agent-mind/sidecars/panel/brain_wiki.mjs` + `main.mjs`）提供 8 个完全对称控制面接口，严格白名单限制仅可读写 `SCHEMA.md`、`index.md`、`log.md`、`raw/*.md`（最深 2 层）与 `pages/**/*.md`（最深 3 层），经 `canonicalize`/`realpathSync` 防逃逸，禁止删除核心元数据文件；
  - 链接解析器自动跳过围栏代码块与行内反引号，提取 `[[slug]]`/`[[slug|label]]` 与相对 `.md` 链接，计算正向引用、反向引用（Backlinks）、断链与孤立页面；
  - 复用 `launch_antigravity_conversation`（Sidecar 宿主走 `window.sidecar.agent.startConversation`，桌面/`:18765` 走 `language_server.exe agentapi new-conversation`）实现一键回 Antigravity 整理（Ingest）、头脑风暴（Brainstorm）与体检（Lint）；
  - 新增纯手动技能 `plugins/a8-agent-mind/skills/a8-brain/SKILL.md`，先读 `index.md` 再精读 2～5 篇命中条目控制 Token；前端抽取共享 `MarkdownArticle.tsx` 与 `antigravityLauncher.ts`，并修补 `AgentMindModelConfigPanel.tsx` 保存 `config.json` 时保留 `wiki_dir` 字段。
- **否决备选与代价**：否决在工作台内直连外部 LLM API 做自动整理（需额外配置与计费且与 Antigravity 工具链割裂）；否决引入本地向量库/Embedding 服务（对百篇级个人知识库过重，`index.md` 索引渐进阅读已足够精准且可人工审阅）。
- **重评触发条件**：当个人 `pages/` 条目数超过 300 篇导致单份 `index.md` 超过 `16 KB` 影响定位效率时，再引入按主题拆分的二级索引文件。

## 3. 当时验证范围

- **已验证**：`cargo check --workspace`、`cargo test --workspace`（含 `brain_wiki` 5 项路径安全/防代码块误提取/反向引用断链孤立图谱/删保护与重名去重/`config.json` 键保留单测）、`modules/devtools/web` `npm run build`（`tsc -b && vite build` 经典 IIFE 产物核验）、Sidecar 实机 HTTP 接口与 `Origin: https://evil.example.com` `403` / 路径穿越 `400` 边界实测，以及全仓 4 项 `scripts/lints/` 机械门禁。
- **未覆盖 / 依赖边界**：未通过无头浏览器自动化点击验证交互桌面 Tauri 窗口渲染及真实 Antigravity `language_server.exe` 会话拉起（遵循高耗动作不自动触发纪律，留待人工实机点击或显式 `/a8-ui-verify`）。

## 4. 对常青文档的影响

- 已在 `docs/evergreen/dashboard-and-workflows.md` 新增「5. 个人知识大脑（`A8 Brain` LLM Wiki 与 Antigravity 联动）」契约，并在 `docs/evergreen/agent-mind-governance.md`、`docs/glossary.md` 与 `AGENTS.md` 同步登记 `/a8-brain` 与术语定义。
