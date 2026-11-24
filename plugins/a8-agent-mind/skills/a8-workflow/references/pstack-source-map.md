# 上游 `pstack` v0.15.48 来源映射表与升级比对指南

> 本映射表记录 `a8-workflow` 与 `a8-agent-mind` 吸收改编上游 `pstack` 的 MIT 许可证、全部 86 个核心单元映射、剥离/不采纳清单与升级比对方法（上游原始路径列按原仓库文件名保留，仅用于后续差异比对）。

## 一、 上游版本锚点与 MIT License

- **上游仓库**：`https://github.com/cursor/plugins/tree/main/pstack`（作者 `Lauren Tan` / poteto）
- **版本与基准 Commit**：`v0.15.48`，SHA `9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc`（`2026-11-23T18:41:29-06:00`）
- **盘点基数**：`62` 个 `SKILL.md`（`35` 功能 + `24` `principle-*` + `3` Benny）+ `22` 个 Playbook + `2` 个 Agent = **86 单元**（另并入核对 37 份配套参考）。

```text
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 二、 86 个上游单元逐项映射总表（0 遗漏）

> **缩写**：`@wf`=`plugins/a8-agent-mind/skills/a8-workflow/SKILL.md`；`@ana`/`@bug`/`@perf`/`@feat`/`@long`=`.../a8-workflow/guides/{analyze,bug-fix,perf,feature,long-task}.md`；`@prompt`=`.../skills/a8-prompt/SKILL.md`；`@brain`=`.../skills/a8-brain/SKILL.md`；`@trace`=`.../skills/a8-trace/SKILL.md`；`@rules`=`plugins/a8-agent-mind/rules/mind-rules.md`；`@tokens`=`.../rules/TOKENS.md`；`@improve`=`.../skills/a8-improve/SKILL.md`；`@sync`=`.../agents/docs-sync.md`；`@ui`=`.../skills/a8-ui-design/SKILL.md`；`<repo>`=目标仓根。上游路径相对 `pstack/` 保持原文。  
> **统计**：吸收 29 + 合并 11 + 部分吸收 29 + 剥离 10 + 拒绝 7 = **86 项**（瘦身后剔除高耗 Token 流程与多工作区隔离逻辑，后者完全交由 Antigravity 原生 `swarm` 处理）。

### 2.1 顶层功能与方法技能（35 个，`skills/*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 剥离与拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|1|`skills/architect/SKILL.md`|架构|吸收|`@feat` §1|跨边界先比2套签名所有权方案择优|
|2|`skills/arena/SKILL.md`|架构|剥离|—|高耗 Token（多方案并发实现+对抗打分）；仅用户显式要求时手做，严禁自动触发|
|3|`skills/automate-me/SKILL.md`|复盘|部分吸收|`@improve` P1/2|当前会话有候选项时抽查近期历史佐证；拒建个人 `<name>-mode`|
|4|`skills/benchmark-checklist/SKILL.md`|性能|吸收|`@perf` §3|必过防伪7问（需做基准对比时，缺关键项判 `INCONCLUSIVE`）|
|5|`skills/blast-radius/SKILL.md`|调研|吸收|`@ana` §3|查跨模块/协议/时序盲区，按需轻量验真并标5级确信度|
|6|`skills/bro/SKILL.md`|表达|部分吸收|`@rules` §1|剥 `/bro` 命令，留短句直白说事实|
|7|`skills/correct/SKILL.md`|复盘|吸收|`@improve` P1/2/5|同错归类；5级防线；破坏抓虫验证；删冗余规|
|8|`skills/create-formal-verification-skill/SKILL.md`|高危|剥离|—|仅极端状态机按需自建 `.qnt`，日常不常驻流程；拒批建 `.cursor/`|
|9|`skills/create-verification-skill/SKILL.md`|验证|合并|`<repo>/docs/verify.md`, `@wf`|运行面/防污染/盲区理念由 `verify.md` 承接|
|10|`skills/figure-it-out/SKILL.md`|长程|吸收|`@long` §1,3|立靶定完成判据→高风险先行→单步验绿→终点复验|
|11|`skills/how/SKILL.md`|调研|合并|`@ana` §1|只读梳理调用链、数据结构与所有权|
|12|`skills/in-your-own-words/SKILL.md`|接单|合并|`@wf` §1|长/模糊需求先用2~3句复述目标边界与最小范围|
|13|`skills/interrogate/SKILL.md`|审查|剥离|—|高耗 Token（独立对抗找茬子代理）；日常由本地门禁与 `/a8-dsh-review` 替代|
|14|`skills/ketchup/SKILL.md`|汇报|剥离|—|长任务低频汇报模板已瘦身移除，日常统一走 `@wf` §4 <=40 行简报|
|15|`skills/ketchup-video/SKILL.md`|汇报|拒绝|—|字幕 MP4 渲染太重，违背 A8 极简文本原则|
|16|`skills/maintain-formal-verification-skill/SKILL.md`|维护|部分吸收|`@sync`, `@rules` §6|有 `.qnt` 模型仓改源码时核对模型漂移，严分漂移与真Bug|
|17|`skills/maintain-verification-skill/SKILL.md`|维护|部分吸收|`@wf` §4, `@sync`|核对 `docs/verify.md` 与真脚本，禁放宽断言遮掩真回归|
|18|`skills/make-bot-ui/SKILL.md`|集成|拒绝|—|Grok Webhook 与 Tailscale 公网暴露违背安全边界|
|19|`skills/no-comments/SKILL.md`|清理|部分吸收|`@feat` §3, `@rules` §2|主会话按5类白名单清多余注释，约束转类型/Lint；不另派子代理|
|20|`skills/poteto-help/SKILL.md`|引导|拒绝|—|Cursor 帮助菜单；A8 收口为 `/a8-workflow` 与 `readme.md`|
|21|`skills/poteto-mode/SKILL.md`|总控|部分吸收|`@wf` 全文|复述/路由/小步验绿/收口；瘦身去重并拒模型硬编码|
|22|`skills/recall/SKILL.md`|回忆|部分吸收|`@ana` §2|结合当前 `git log` 与文档记录核对现状，不凭记忆断言|
|23|`skills/reflect/SKILL.md`|复盘|合并|`@improve` P1/2/5|6月保质期/剔SHA版本/积压区/禁改缓存与开PR|
|24|`skills/setup-pstack/SKILL.md`|配置|拒绝|—|写 `pstack-models.mdc`，与 `model: inherit` 冲突|
|25|`skills/sharpen/SKILL.md`|接单|吸收|`@prompt` 全文|独立手动技能 `/a8-prompt`：贴合仓内地图答专家4问并重写深层Prompt停步|
|26|`skills/show-me-your-work/SKILL.md`|审计|吸收|`@trace` 全文|独立手动技能 `/a8-trace`：面向日常开发交付的7列 TSV 决策账本（含备选/弯路回退/证据）+ Attention 关注点|
|27|`skills/statechart/SKILL.md`|状态图|部分吸收|`@feat` §1, `@rules` §3.1|用显式枚举/状态机建模（Mermaid 表达）；拒 `pele`+Java|
|28|`skills/swarm/SKILL.md`|并发|剥离|—|多代理与工作区隔离完全交由 Antigravity 原生 `swarm` 标准逻辑，插件不介入|
|29|`skills/tdd/SKILL.md`|开发|部分吸收|`@bug` §4, `@feat` §1|仅限后端修 Bug 与新功能（纯逻辑/状态机/核心接口）先红后绿；前端完全免 TDD，重Mock场景明文跳过走最小真实面|
|30|`skills/teach/SKILL.md`|讲解|部分吸收|`@ana` §1|从最小两块出发逐边展开渐进图解，禁表演词|
|31|`skills/technical-writing/SKILL.md`|文档|部分吸收|`@sync`|四类文档职责纯洁/先条件后动作；拒英文 STE 语法|
|32|`skills/typescript-best-practices/SKILL.md`|编码|部分吸收|`@feat` §1, `@rules` §2|判别联合/边界解析/强类型建模；不另设独立技能|
|33|`skills/unslop/SKILL.md`|表达|部分吸收|`@wf` §4, `@rules` §1|中文去水（禁套话/一概念一词/禁黑话）；剥英文条款|
|34|`skills/why/SKILL.md`|调研|合并|`@ana` §2|查 `git log` 与记录动机，严分引文/`[推断]`/空白|
|86|`skills/reframe/SKILL.md`|定名|部分吸收|`@brain` Mode 4|并入 `/a8-brain` Mode 4（消歧+3～6 核心术语+1～2 跨领域类比断裂点+重写并衔接 Wiki 复利）；裁剪原版 8～12 术语与强制逐链打开核验开销|

### 2.2 工程原则技能（24 个，`skills/principle-*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 剥离与拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|35|`skills/principle-attack-the-premise/SKILL.md`|修Bug|吸收|`@bug` §3, `@rules` §4|同前提连败2次停笔写前提并实验证伪，禁第3补丁|
|36|`skills/principle-boundary-discipline/SKILL.md`|边界|合并|`@rules` §3.2, `@feat` §1|双自检：仅跨边界解析一次、纯逻辑抽零框架纯函数|
|37|`skills/principle-build-the-lever/SKILL.md`|工具|吸收|`@rules` §4, `@long` §2|批改先通1样本再写可复跑脚本自证交付|
|38|`skills/principle-encode-lessons-in-structure/SKILL.md`|治理|合并|`@rules` §5, `@improve`|同要求写第2遍即升格 Lint/类型/断言，不堆文字|
|39|`skills/principle-exhaust-the-design-space/SKILL.md`|原型|剥离|—|高耗 Token（多方案并发原型）；仅用户显式要求对比探索时手做|
|40|`skills/principle-experience-first/SKILL.md`|体验|部分吸收|`@ui`, `@feat`|维护与用户体验高于偷懒，打磨核心体验不堆半成品|
|41|`skills/principle-explain-the-number/SKILL.md`|性能|吸收|`@perf` §1,3|先剖析定限速器再调优，明确噪声底线|
|42|`skills/principle-fix-root-causes/SKILL.md`|修Bug|合并|`@bug` §3, `@rules` §2|审触发态合法性（非法态从源头灭，禁下游判空）|
|43|`skills/principle-foundational-thinking/SKILL.md`|设计|吸收|`@feat` §1, `@rules` §2|写逻辑前定核心数据结构、所有权与状态不变量|
|44|`skills/principle-guard-the-context-window/SKILL.md`|预算|合并|`@tokens` §4, `@wf` §3|大日志外放 `logs/`，不刷屏撑爆主上下文|
|45|`skills/principle-laziness-protocol/SKILL.md`|编码|部分吸收|`@rules` §2, `@feat` §2|偏向删减与最小有效Diff，合重复判定到唯一真源|
|46|`skills/principle-make-operations-idempotent/SKILL.md`|状态|吸收|`@rules` §2, `@feat` §1|按物理现状差量收敛；锁/临时档原子替换|
|47|`skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`|重构|合并|`@feat` §2, `@rules` §3.1|同波迁调用方与新契约测试，删旧接口与护旧死测试|
|48|`skills/principle-minimize-reader-load/SKILL.md`|可读|吸收|`@feat` §2, `@rules` §2|删单调用包装/缩可变作用域，一眼看懂谁能改|
|49|`skills/principle-model-the-domain/SKILL.md`|建模|合并|`@feat` §1, `@rules` §2|枚举/联合/查表替散落分支；局部直白保持朴素|
|50|`skills/principle-never-block-on-the-human/SKILL.md`|协作|部分吸收|`@wf` §3, `@rules` §1|路线对齐且可逆直接干完汇报；不可逆/偏好才停|
|51|`skills/principle-outcome-oriented-execution/SKILL.md`|迁移|部分吸收|`@long`, `@feat`|既定分阶段重构直奔终态，不造一次性中间兼容层|
|52|`skills/principle-prove-it-works/SKILL.md`|验收|吸收|`@wf` §3, `@rules` §4/6|禁拿编译/假Mock算验证；轻量单测优先，触及外契约再跑最小实机表面|
|53|`skills/principle-redesign-from-first-principles/SKILL.md`|架构|吸收|`@feat` §1, `@rules` §2|接新需求先通读，按第一天就需此功能重设计传导|
|54|`skills/principle-separate-before-serializing-shared-state/SKILL.md`|并发|部分吸收|`@rules` §3.3|并发读写共享状态优先物理拆分消除共享，仅真不变量才用细粒度锁|
|55|`skills/principle-sequence-verifiable-units/SKILL.md`|拆解|吸收|`@wf` §3, `@tokens` §5|绿态→改一单元→即验绿→下一步；顺序自带自证|
|56|`skills/principle-subtract-before-you-add/SKILL.md`|重构|吸收|`@feat` §2, `@rules` §2|先删死码与冗余包装，瘦到底线再建新结构|
|57|`skills/principle-test-behavior-not-implementation/SKILL.md`|测试|吸收|`@bug` §4, `@feat` §1|双反证查假测（改错仍绿=废，改私有红=绑实现）|
|58|`skills/principle-type-system-discipline/SKILL.md`|类型|吸收|`@feat` §1, `@rules` §2|禁编非法态；专用类型隔离；入口解析一次|

### 2.3 Benny 自动化包技能（3 个，`automations/benny/skills/*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 剥离与拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|59|`automations/benny/skills/reproduce-and-fix-issues/SKILL.md`|复现|部分吸收|`@bug` §1~2|剥 Slack/Linear 与重型双复现；留已有修复验真与最轻量真实复现|
|60|`automations/benny/skills/setup-benny/SKILL.md`|安装|拒绝|—|绑定 Cursor `.cursor/automations/benny/` 与 Slack/Linear|
|61|`automations/benny/skills/triage-issue-reports/SKILL.md`|分诊|剥离|—|团队工单分诊流在个人多仓研发低频，已从 `@ana` 瘦身移除|

### 2.4 Playbooks（22 个，上游原目录 `skills/poteto-mode/playbooks/*.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 剥离与拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|62|`skills/poteto-mode/playbooks/authoring-a-skill.md`|技能|部分吸收|`@improve`, `@rules`|验 frontmatter 与真实路径；指针代抄写，只写决策指令|
|63|`skills/poteto-mode/playbooks/autonomous-run.md`|长程|吸收|`@long` §3|立谓词→`schedule`唤醒→不进全退→修挡路小错→禁松谓词|
|64|`skills/poteto-mode/playbooks/autopilot-full.md`|长程|部分吸收|`@long` §2|拒云PR合入；留状态落盘与门禁自检|
|65|`skills/poteto-mode/playbooks/autopilot-stack.md`|长程|拒绝|—|仅 `autopilot-full` 堆叠 PR 不合入变体，A8 无此流|
|66|`skills/poteto-mode/playbooks/babysit.md`|盯盘|拒绝|—|GitHub PR 轮询；A8 用本地审核（仅取窄回退反例入规则）|
|67|`skills/poteto-mode/playbooks/bug-fix.md`|修Bug|吸收|`@bug` 全文|轻量真实复现→二分探因→先红后绿→清残余→同表面复验|
|68|`skills/poteto-mode/playbooks/eval.md`|评测|部分吸收|`@improve` 附录|防观察者效应盲测思路（脱敏+查真实读档），大改可选|
|69|`skills/poteto-mode/playbooks/feature.md`|功能|吸收|`@feat` §1,3|追影响→选形→定数据状态→小步实现→主会话注释白名单收口|
|70|`skills/poteto-mode/playbooks/hillclimb.md`|性能|部分吸收|`@perf` §2|仅用户显式要求多轮压榨指标时启用：冻桩+单变量试+平台期切策略|
|71|`skills/poteto-mode/playbooks/investigation.md`|调研|吸收|`@ana` §1|严格只读不改码、按结构/对比答，错前提直驳|
|72|`skills/poteto-mode/playbooks/multi-phase-plan.md`|规划|部分吸收|`@long` §1|小改免方案；4要素计划待批开跑|
|73|`skills/poteto-mode/playbooks/opening-a-pr.md`|收口|部分吸收|`@wf` §4|剔 PR/`gh`/`/deslop`；剥无关改动、<=40行简报、日志外放|
|74|`skills/poteto-mode/playbooks/pause-safely.md`|暂停|吸收|`@long` §3|停原子边界关子任务、禁不可逆、留续跑备忘|
|75|`skills/poteto-mode/playbooks/perf-issue.md`|性能|吸收|`@perf` §1|纯净基线+独立剖析，禁猜源码；7阶梯由廉入贵达标止|
|76|`skills/poteto-mode/playbooks/prototype.md`|原型|剥离|—|多方案探索易耗大量 Token，仅用户显式要求做原型对比时手做|
|77|`skills/poteto-mode/playbooks/refactoring.md`|重构|吸收|`@feat` §2|剥新功能；行为锚→先减后加→同波删旧→等价跑→减负判留|
|78|`skills/poteto-mode/playbooks/runtime-forensics.md`|取证|吸收|`@ana` §4, `@perf`|禁猜源码，抓活进程剖析/堆/CDP，提炼并回标行号|
|79|`skills/poteto-mode/playbooks/session-pickup.md`|续跑|吸收|`@long` §3|读账本/本仓记录/`git` 作权威起点不重做，只验继承声明|
|80|`skills/poteto-mode/playbooks/shipping.md`|核验|部分吸收|`@wf` §4|拒 GitHub 栈合入；高风险改动在 `/a8-commit` 前由独立门禁与裁判核验|
|81|`skills/poteto-mode/playbooks/trace-forensics.md`|取证|吸收|`@ana` §4, `@perf`|读已捕获档不重跑，寻热点回标行号|
|82|`skills/poteto-mode/playbooks/visual-parity.md`|对齐|剥离|—|高耗 Token 像素循环；视觉验收统一交由用户显式调用 `/a8-ui-verify`|
|83|`skills/poteto-mode/playbooks/worktree-cleanup.md`|清理|剥离|—|工作区隔离与清理完全交由 Antigravity 原生 `swarm` 标准逻辑，插件不介入|

### 2.5 Agents（2 个，`agents/*.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 剥离与拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|84|`agents/poteto-agent.md`|派发|部分吸收|`@wf` §3, `@tokens`|拒新增冗余代理；按需派发时保持上下文干净、不刷长日志|
|85|`agents/comment-sicko.md`|清理|部分吸收|`@feat` §3, `@rules` §2|拒独立人设代理（省 Token）；5类注释白名单并入主会话收口自查|

## 三、 不采纳/剥离清单与 A8 替代对照

|被拒绝或剥离的上游能力|拒绝/剥离原因|A8 现行替代实现|
|:---|:---|:---|
|`setup-pstack` / `pstack-models.mdc` 模型表|与 Antigravity `model: inherit` 及 `TOKENS.md` 冲突|Antigravity 原生模型继承与 `TOKENS.md` 分层|
|`make-bot-ui` / `setup-benny`(Slack/Tailscale)|引入公网暴露、SaaS 凭据与 Cursor Automations 强绑定|本地 `logs/grok-proposals/`、`:18765` Origin 校验与 `schedule`|
|`babysit` / `autopilot-stack` / PR 堆叠队列|A8 面向本地多仓构建打包，不用云代理堆叠 PR 合入|本地门禁 + DevTools Diff 审核 + `/a8-commit` / `/a8-dsh-review`|
|`arena` / `interrogate` / `visual-parity` / 多方案原型|高耗 Token 的并发实现、对抗找茬或浏览器循环，严禁自动触发|仅用户显式点名时执行（UI 验证走 `/a8-ui-verify`，深审走 `/a8-dsh-review`）|
|`swarm` / `worktree-cleanup`|工作区隔离应完全交由宿主平台原生机制，避免规则冗余干预|Antigravity 原生 `swarm` 标准逻辑（本插件不介入）|
|`ketchup-video`、`poteto-help`、`.cursor/skills/verify-*`|视频管线重、命令碎片化，与 A8 单入口冲突|`/a8-workflow` + `<repo>/docs/verify.md` + `/a8-trace`|
|`poteto-agent.md` / `comment-sicko.md` 独立代理|增加 `check_plugin_agents.py` 维护面与人设/Token 噪音|并入 `@wf` §3 与 `@feat` §3 主会话条款|
|`pele@1.9.0`+Java、`xcrun simctl`、英文 STE 语法|绑定特定外部渲染链、macOS 或纯英文修辞限制|Mermaid、中文与 `glossary.md`|

## 四、 未来 `pstack` 升级比对指南

1. **网页对比**：`https://github.com/cursor/plugins/compare/9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc...main`
2. **本地局部拉取与 Diff**（放系统临时目录，不污染仓库；兼容旧版 Git 无 `sparse-checkout` 子命令的场景）：
   ```powershell
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   $tmp = Join-Path $env:TEMP "pstack-upstream-diff"
   if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
   git clone --filter=blob:none --no-checkout https://github.com/cursor/plugins.git $tmp
   git -C $tmp checkout HEAD -- pstack
   git -C $tmp log --oneline 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc..HEAD -- pstack
   git -C $tmp diff --stat 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc..HEAD -- pstack
   git -C $tmp log -p 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc..HEAD -- pstack
   ```
3. **同步步骤**：① 盘点新增/变更/删废单元及新 Tag/SHA；② 剥离平台耦合、高耗 Token 流程与英文语法，按平实中文合入；③ 守住 `mind-rules.md <= 20,000 B`、`TOKENS.md < 1,000 B`、`a8-workflow/*.md` 远低于 `20,000 B`；④ 更新本映射表锚点、映射表并清理 `$tmp`；⑤ 运行 `E:\a8-devtools\scripts\lints\` 全部 4 项检查全绿。
