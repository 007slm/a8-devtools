---
name: a8-improve
description: "面向用户主动触发的工程经验复盘与规则库精炼技能。触发指令包括 /a8-improve、/复盘、/提升。不启动 Subagent，直接基于主会话第一现场：捕获五维纠偏信号，并由 Agent 自主决定按需抽查本机近期历史会话（transcript.jsonl）交叉验证候选项是否反复出现、是否值得沉淀（无需用户记参数），优先升格为 scripts/lints/ 机器检查，同时清理既有规则库中的无效、冲突与重复逻辑，输出交互式 Generative UI 卡片供人工编号确认落盘。"
---

# Experience & Rule Refinement (`a8-improve`)

本技能一体化负责两件事：**把会话中的真实纠偏沉淀为防线（优先机器检查，次选规则），同时审查清理规则库中失效、冲突或重复的旧条目**。

> **职责边界**：遵循**三线分离原则**——Rule 写提示词规范、Lint 在会话 `Stop` 后自动做机械检查、Decision 在 `commit` 之前做语义判定；经验复盘仅由用户主动调用 `/a8-improve` 触发（严禁自行弹卡或静默写盘，沉淀 Lint 时严禁把检查脚本路径塞回常驻 Rule 提示词）。  
> **按需参考**：生成复盘卡片、6 节确认清单、标准落盘格式或大改隔离盲测时，再读取 [`references/card-and-eval.md`](references/card-and-eval.md)。

---

## 5 条核心执行铁律 (Hard Rules)

1. **只源于用户真实意志**：每条候选必须可追溯至用户显式纠偏、静默改码（`Silent edit`）或明确拍板；**严禁** AI 凭“理论上算好实践”私加套话。
2. **严禁编造 Why**：用户给过原因则原样保留；未给原因时，AI 推演须标注 **`*inferred*:`** 并列入 `Needs your answer` 经确认后方可落盘。
3. **旧规失效则收紧重写，拒绝枚举堆砌**：已有规则覆盖但本次仍犯，直接升格强制器或收紧重写旧规则；禁止按文件/组件枚举堆砌，按第一性原理归并收敛。
4. **最高有效防线阶梯**：① **架构消除**（唯一所有权/收拢真源）> ② **编译器类型约束** > ③ **带改法提示的 `scripts/lints/`** > ④ **语义 `*.decision.json` / 行为单测**（项目级 `<repo>/scripts/lints/`、全局 `a8-agent-mind/decisions/`）> ⑤ 纯流程/协作/审美才写自然语言规则。
5. **物理判据 + 主会话停步**：禁用“尽量/适当/如前所述”，采用**“第一性原理主干（含`必须`/`严禁`） + （括号内 1 个具体物理判据或典型反例）”**；**绝对在主会话运行（No Subagent）**，提案后立即停步等人工按编号批准，严禁静默落盘。

---

## 触发变体契约 (Invocation Variants)

| 触发指令 | 行为模式 |
| :--- | :--- |
| `/a8-improve`、`/复盘`、`/提升` | 扫描本会话五维纠偏信号（无候选项直接说明“无新增纠偏”，严禁为交差硬翻历史凑数）→ 有候选时自主抽查最近 3～5 个相关历史会话佐证 → 同步体检 `.agents/rules/` + `mind-rules.md` 冗余/失效/冲突 → 输出卡片与清单后停步 |
| `写入` / `写入全部` / `写入 1, 3` | 仅将用户明确批准的新增、收紧、清理或检查条目写入真源规则或 `scripts/lints/` |

---

## 五阶段执行流水线 (Execution Pipeline)

### Phase 1：扫描五维纠偏信号 + 按需跨会话佐证

从第 1 轮对话扫描至本轮（跳过一次性文案、普通单次 Bug 与单纯需求澄清），每条锁定：用户原话/物理 Diff、Agent 原错法、期望做法、是否有 Why：

| 信号类型 | 识别线索 | 提取要点 |
| :--- | :--- | :--- |
| **1. Explicit correction** | 直接否定方案、指正误判或立规矩 | 原话规则，通常自带 Why |
| **2. Silent edit** | Agent 写盘后用户手动改了配置/源码 | 默认值错了，最终修改值即真实规则 |
| **3. Repeated nudge** | 连续微调至“行了” | 只记最终收敛阈值/边界，不记中间过程 |
| **4. Revert / Rejection** | 撤回、删防御代码或否决方案 | 反面红线；缺 Why 标 `*inferred*` 待拍板 |
| **5. Confirmed non-obvious** | 确认非显而易见设计抉择 | 仅当零背景新 Agent 极易选反时才记 |

**两道准入滤网**：
- **6 个月保质期**：只留 6 个月后仍实质改变决策的规律，剔除 Commit SHA、临时计数与一次性文案。
- **按需跨会话佐证**：**仅当**本会话已有候选项时，自主抽查 `<appDataDir>/brain/<cid>/.system_generated/logs/transcript.jsonl` 最近 3～5 个相关历史会话（每会话抽最近 200 行关键摘要）：`>= 2` 会话复现定性为顽疾/稳定偏好优先提案；单次偶发未立规入 `Skipped`。无候选项时直接如实回复零新增（用户点名翻历史除外）。

### Phase 2：5 级防线阶梯与规则体检

逐条按防线阶梯从高到低裁决（能停高层不下沉）：

```text
可跨场景迁移的通用工程偏好 / 架构因果律？
├── 否 ──► Skipped（单行说明原因，推翻权留给用户）
└── 是
    ├── 现有 AGENTS.md / redline.md / mind-rules.md 已覆盖？
    │   ├── 同向（有规仍犯）──► 升格机械防线或收紧重写既有原理（禁并行新增）
    │   ├── 矛盾 ──► Conflicts（并列旧规与新纠偏交用户二选一）
    │   └── 未覆盖 ──► 继续
    ├── ① 架构消除 / ② 编译器类型能封死？ ──► 架构/类型改造（暂不动业务码入 Backlog）
    ├── ③ scripts/lints/ 能精准拦截（报错点出改法）？ ──► Make it a Lint（存量多支持 --diff）
    ├── ④ 适合 *.decision.json 或行为单测？ ──► Make it a Decision / 行为单测
    └── ⑤ 纯流程/协作/审美 ──► 区分作用域并控体积：
        ├── 单仓专属 ──► <repo>/.agents/rules/redline.md（禁入 AGENTS.md/全局）
        ├── 跨仓通用 ──► E:\a8-devtools\plugins\a8-agent-mind\rules\mind-rules.md
        └── 归属模糊 ──► Needs your answer
```

**规则-强制器配对体检（每次同步执行）**：检查 `.agents/rules/` 与 `mind-rules.md`：① 有规仍犯（缺强制器）→ 提案升格机械防线或收紧判据；② 已被架构/类型/Lint 100% 封死的冗余自然语言规则 → **主动提案删除**；③ 过时/重复/含“尽量、适当、注意”的软弱条目 → 重写判据或建议移除。

### Phase 3：第一性原理归因与自测

对拟写入规则文档的条目执行三步（自测细节与落盘条目模板见 [`references/card-and-eval.md`](references/card-and-eval.md) §一）：
1. **第一性原理抽象与归并**：向上追问本质，优先融入并收紧既有原理条目，严禁按具体组件枚举堆砌；
2. **结构定式**：采用“第一性原理主干（含`必须`/`严禁`并保留适用前提）+（括号内 1 个具体物理判据或典型反例）”；
3. **零上下文自测与时间戳注释**：屏蔽本轮回忆检验新 Agent 是否仍会重犯，落盘带 `<!-- YYYY-MM-DD: "原话摘录" -->` 便于审计溯源。

### Phase 4：生成复盘卡片 + 结构化确认清单并停步

需要输出提案时，**按需读取 [`references/card-and-eval.md`](references/card-and-eval.md) §二～§三**：
1. 参照 [`templates/improve_card.html`](templates/improve_card.html) 生成 `<Artifact Directory Path>/improve_card.html` 并以 `<agent-embed>` 嵌入（遵循宿主语义变量与 `<= 450px` 紧凑约束）；
2. 在卡片下方输出 6 节确认清单（空节省略；零新增时直报“零膨胀状态良好”），附确认提示后**立即停步**。

### Phase 5：按批准项精准落盘

1. **严守真源写盘**：仅写入用户明确批准的编号项及已确认的 `*inferred*` Why；只改仓库真源目录（如 `E:\a8-devtools\plugins\a8-agent-mind\` 或 `<repo>/.agents/rules/`），**严禁改 `plugins/cache/`，严禁擅自开 PR、推送远端或改无关业务代码**；
2. **呈现物理 Diff**：落盘后给出 Diff 与变更摘要；
3. **破坏抓虫实证与存量处置**：新落地 `scripts/lints/` 或 `*.decision.json` 必须做正反双证（正常代码跑绿 + 临时破坏样本实测报 `FAIL`，验完即删样本）；命中存量违规时如实汇报数量与位置，询问“先 `--diff`/Warn”还是“立即修存量”，严禁擅自改业务码。

*(大幅修订 `mind-rules.md` / `a8-improve` / `a8-workflow` 需隔离盲测时，按需查阅 [`references/card-and-eval.md`](references/card-and-eval.md) §四。)*
