# 上游 `pstack` v0.15.46 来源映射表与升级比对指南

> 本映射表记录 `a8-workflow` 与 `a8-agent-mind` 吸收改编上游 `pstack` 的 MIT 许可证、全部 85 个核心单元映射、不采纳清单与升级比对方法（上游原始路径列按原仓库文件名保留，仅用于后续差异比对）。

## 一、 上游版本锚点与 MIT License

- **上游仓库**：`https://github.com/cursor/plugins/tree/main/pstack`（作者 `Lauren Tan` / poteto）
- **版本与基准 Commit**：`v0.15.46`，SHA `0b46ec399d55f2829e88822998f53b84944837d3`（`2026-11-19T22:12:08Z`）
- **盘点基数**：`61` 个 `SKILL.md`（`34` 功能 + `24` `principle-*` + `3` Benny）+ `22` 个 Playbook + `2` 个 Agent = **85 单元**（另并入核对 37 份配套参考）。

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

## 二、 85 个上游单元逐项映射总表（0 遗漏）

> **缩写**：`@wf`=`plugins/a8-agent-mind/skills/a8-workflow/SKILL.md`；`@ana`/`@bug`/`@perf`/`@feat`/`@long`=`.../a8-workflow/guides/{analyze,bug-fix,perf,feature,long-task}.md`；`@prompt`=`.../skills/a8-prompt/SKILL.md`；`@rules`=`plugins/a8-agent-mind/rules/mind-rules.md`；`@tokens`=`.../rules/TOKENS.md`；`@improve`=`.../skills/a8-improve/SKILL.md`；`@sync`=`.../agents/docs-sync.md`；`@ui`=`.../skills/a8-ui-design/SKILL.md`；`<repo>`=目标仓根。上游路径相对 `pstack/` 保持原文。  
> **统计**：吸收 34 + 合并 11 + 部分吸收 33 + 拒绝 7 = **85 项**。

### 2.1 顶层功能与方法技能（34 个，`skills/*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|1|`skills/architect/SKILL.md`|架构|吸收|`@feat` §1|跨边界先比>=2套签名所有权方案择优|
|2|`skills/arena/SKILL.md`|架构|部分吸收|`@feat` §1|3~6判据+并发方案+独立打分手工融合；拒厂商配对|
|3|`skills/automate-me/SKILL.md`|复盘|部分吸收|`@improve` P1/2|跨会话>=2次才立规；拒建个人 `<name>-mode`|
|4|`skills/benchmark-checklist/SKILL.md`|性能|吸收|`@perf` §3|必过防伪7问(含5+交替)，缺项判无效|
|5|`skills/blast-radius/SKILL.md`|调研|吸收|`@ana` §1.3|查DB/协议/时序盲区，写脚本证安全标5级确信|
|6|`skills/bro/SKILL.md`|表达|部分吸收|`@rules` §1|剥 `/bro` 命令，留短句直白说事实|
|7|`skills/correct/SKILL.md`|复盘|吸收|`@improve` P1/2/5|同错>=2立类；5级防线；破坏抓虫验证；删冗余规|
|8|`skills/create-formal-verification-skill/SKILL.md`|高危|部分吸收|`@feat` §1.5|紧贴源码+破坏抓虫+`sync_commit`；拒批建 `.cursor/`|
|9|`skills/create-verification-skill/SKILL.md`|验证|合并|`<repo>/docs/verify.md`, `@wf`|运行面/防污染/盲区理念由 `verify.md` 承接|
|10|`skills/figure-it-out/SKILL.md`|长程|吸收|`@long` §1,3|立靶定谓词→风险先行建桩→单步验证→TSV→终验|
|11|`skills/how/SKILL.md`|调研|合并|`@ana` §1.1|只读子代理梳调用链、数据结构与所有权|
|12|`skills/in-your-own-words/SKILL.md`|接单|合并|`@wf` §1|长/模糊需求先用2~3句复述目标边界与最小范围|
|13|`skills/interrogate/SKILL.md`|审查|部分吸收|`@feat` §5|只读实跑命令击穿意图，丢猜想；拒厂商硬派|
|14|`skills/ketchup/SKILL.md`|汇报|部分吸收|`@long` §4|首句报待拍板，先图后逐条真状态+选项推荐风险|
|15|`skills/ketchup-video/SKILL.md`|汇报|拒绝|—|字幕 MP4 渲染太重，违背 A8 极简文本原则|
|16|`skills/maintain-formal-verification-skill/SKILL.md`|维护|部分吸收|`@feat` §1.5, `@sync`|从 `sync_commit` diff 重对齐模型，严分漂移与真Bug|
|17|`skills/maintain-verification-skill/SKILL.md`|维护|部分吸收|`@wf` §4, `@sync`|核对地图与真脚本，禁放宽断言遮掩真回归|
|18|`skills/make-bot-ui/SKILL.md`|集成|拒绝|—|Grok Webhook 与 Tailscale 公网暴露违背安全边界|
|19|`skills/no-comments/SKILL.md`|清理|部分吸收|`@feat` §5, `@rules` §2|清多余/借口注释，约束转类型Lint；不留独立命令|
|20|`skills/poteto-help/SKILL.md`|引导|拒绝|—|Cursor 帮助菜单；A8 收口为 `/a8-workflow` 与 `readme.md`|
|21|`skills/poteto-mode/SKILL.md`|总控|部分吸收|`@wf` 全文|复述/路由/写待办/切话题重置；拒模型硬编码|
|22|`skills/recall/SKILL.md`|回忆|部分吸收|`@ana` §1.2|锁本仓对话日志倒序捞取，拿当前 `git`/记录核对|
|23|`skills/reflect/SKILL.md`|复盘|合并|`@improve` P1/2/5|6月保质期/剔SHA版本/积压区/禁改缓存与开PR|
|24|`skills/setup-pstack/SKILL.md`|配置|拒绝|—|写 `pstack-models.mdc`，与 `model: inherit` 冲突|
|25|`skills/sharpen/SKILL.md`|接单|吸收|`@prompt` 全文|独立手动技能 `/a8-prompt`：贴合仓内地图答专家4问并重写深层Prompt停步|
|26|`skills/show-me-your-work/SKILL.md`|审计|吸收|`@long` §4|只追加 `decisions.tsv`(防注入)，查轨迹列关注风险清单|
|27|`skills/statechart/SKILL.md`|状态图|部分吸收|`@feat` §1.5|人话图+最短反例重放；拒 `pele`+Java(用Mermaid/Quint)|
|28|`skills/swarm/SKILL.md`|并发|部分吸收|`@wf` §3, `@long` §2|对接原生 `swarm`：定规则/固定回报/禁长日志；拒云表|
|29|`skills/tdd/SKILL.md`|修Bug|吸收|`@bug` §4|低成本本地先红后绿；沉重/假Mock跳过走真实E2E|
|30|`skills/teach/SKILL.md`|讲解|部分吸收|`@ana` §1.1|并行机理历史；先两块每次加一边渐进图；禁表演词|
|31|`skills/technical-writing/SKILL.md`|文档|部分吸收|`@sync`|四类文档职责纯洁/先条件后动作；拒英文 STE 语法|
|32|`skills/typescript-best-practices/SKILL.md`|编码|部分吸收|`@feat` §1.4, `@rules`|判别联合/边界解析/包装隔离/Schema派生；不另设技能|
|33|`skills/unslop/SKILL.md`|表达|部分吸收|`@wf` §4, `@rules` §1|中文去水(禁套话/一概念一词/禁黑话)；剥英文条款|
|34|`skills/why/SKILL.md`|调研|合并|`@ana` §1.2|查 `git log` 与记录动机，严分引文/`[推断]`/空白|

### 2.2 工程原则技能（24 个，`skills/principle-*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|35|`skills/principle-attack-the-premise/SKILL.md`|修Bug|吸收|`@bug` §3, `@rules` §4|同前提连败2次停笔写前提并实验证伪，禁第3补丁|
|36|`skills/principle-boundary-discipline/SKILL.md`|边界|合并|`@rules` §3.2, `@feat` §1|双自检：是否跨边界、纯逻辑能否抽零框架纯函数|
|37|`skills/principle-build-the-lever/SKILL.md`|工具|吸收|`@wf` §3, `@long`|批改先通1样本再写可复跑脚本自证交付|
|38|`skills/principle-encode-lessons-in-structure/SKILL.md`|治理|合并|`@rules` §5, `@improve`|同要求写第2遍即升格 Lint/类型/断言，不堆文字|
|39|`skills/principle-exhaust-the-design-space/SKILL.md`|原型|部分吸收|`@feat` §3|无先例关键交互/分叉隔离做2~3案同屏对比后再定|
|40|`skills/principle-experience-first/SKILL.md`|体验|部分吸收|`@ui`, `@feat`|维护与用户体验高于偷懒，打磨3点不堆10半成品|
|41|`skills/principle-explain-the-number/SKILL.md`|性能|吸收|`@perf` §3|测前立推翻门槛噪声底线，剖析定限速器报区间|
|42|`skills/principle-fix-root-causes/SKILL.md`|修Bug|合并|`@bug` §3, `@rules` §2|审触发态合法性(非法从源头灭，禁下游判空)|
|43|`skills/principle-foundational-thinking/SKILL.md`|设计|吸收|`@feat` §1.4, `@rules` §2|写逻辑前定核心结构与并发所有权，底座桩先于特性|
|44|`skills/principle-guard-the-context-window/SKILL.md`|预算|合并|`@tokens` §4, `@wf` §3|大日志/全仓扫/剖析留隔离子代理，主收结论行号|
|45|`skills/principle-laziness-protocol/SKILL.md`|编码|部分吸收|`@rules` §2, `@feat` §2|偏向删减与最小有效Diff，合重复判定到唯一真源|
|46|`skills/principle-make-operations-idempotent/SKILL.md`|状态|吸收|`@feat` §1.4, `@rules` §2|按物理现状差量收敛；锁/临时档带陈旧凭证原子替换|
|47|`skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`|重构|合并|`@feat` §2, `@rules` §3.1|同波迁调用方与新契约测试，删护旧细节死测试|
|48|`skills/principle-minimize-reader-load/SKILL.md`|可读|吸收|`@feat` §2, `@rules` §2|删单调用包装/缩可变作用域，30秒看懂谁能改|
|49|`skills/principle-model-the-domain/SKILL.md`|建模|合并|`@feat` §1.4, `@rules` §2|枚举/联合/查表替散落分支；局部直白保持朴素|
|50|`skills/principle-never-block-on-the-human/SKILL.md`|协作|部分吸收|`@wf` §3, `@rules` §1|路线对齐且可逆直接干完汇报；不可逆/偏好才停|
|51|`skills/principle-outcome-oriented-execution/SKILL.md`|迁移|部分吸收|`@long`, `@feat`|既定分阶段重构直奔终态，不造一次性中间兼容层|
|52|`skills/principle-prove-it-works/SKILL.md`|验收|吸收|`@wf` §3, `@rules` §4/6|禁拿编译/Mock/缓存算验证，必跑真实目标核对产出|
|53|`skills/principle-redesign-from-first-principles/SKILL.md`|架构|吸收|`@feat` §1, `@rules` §2|接新需求先通读，按第一天就需此功能重设计传导|
|54|`skills/principle-separate-before-serializing-shared-state/SKILL.md`|并发|吸收|`@wf` §3, `@long` §2|多写入者先按文件/`worktree`/`CowFS` 物理拆再归并|
|55|`skills/principle-sequence-verifiable-units/SKILL.md`|拆解|吸收|`@wf` §3, `@tokens` §5|绿态→改一单元→即验绿→下一步；顺序自带自证|
|56|`skills/principle-subtract-before-you-add/SKILL.md`|重构|吸收|`@feat` §2, `@rules` §2|先删死码与冗余包装，瘦到底线再建新结构|
|57|`skills/principle-test-behavior-not-implementation/SKILL.md`|测试|吸收|`@bug` §4|双反证查假测(改错仍绿=废，改私有红=绑实现)|
|58|`skills/principle-type-system-discipline/SKILL.md`|类型|吸收|`@feat` §1.4, `@rules` §2|禁编非法态；专用类型隔离；入口解析；Schema派生|

### 2.3 Benny 自动化包技能（3 个，`automations/benny/skills/*/SKILL.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|59|`automations/benny/skills/reproduce-and-fix-issues/SKILL.md`|复现|部分吸收|`@bug` §1~2|剥 Slack/Linear；已有修复验真、双次复现、禁注假态|
|60|`automations/benny/skills/setup-benny/SKILL.md`|安装|拒绝|—|绑定 Cursor `.cursor/automations/benny/` 与 Slack/Linear|
|61|`automations/benny/skills/triage-issue-reports/SKILL.md`|分诊|部分吸收|`@ana` §1.5|剥 Slack 建单；问题5分类与顺链查真源头定责|

### 2.4 Playbooks（22 个，上游原目录 `skills/poteto-mode/playbooks/*.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|62|`skills/poteto-mode/playbooks/authoring-a-skill.md`|技能|部分吸收|`@improve`, `@rules`|验 frontmatter 与真实路径；指针代抄写，只写决策指令|
|63|`skills/poteto-mode/playbooks/autonomous-run.md`|长程|吸收|`@long` §3|立谓词→`schedule`唤醒→不进全退→修挡路小错→禁松谓词|
|64|`skills/poteto-mode/playbooks/autopilot-full.md`|长程|部分吸收|`@long` §2|拒云PR合入；吸状态落盘/副作用判卡/改阈值复核|
|65|`skills/poteto-mode/playbooks/autopilot-stack.md`|长程|拒绝|—|仅 `autopilot-full` 堆叠 PR 不合入变体，A8 无此流|
|66|`skills/poteto-mode/playbooks/babysit.md`|盯盘|拒绝|—|GitHub PR 轮询；A8 用本地审核(仅取窄回退反例入规则)|
|67|`skills/poteto-mode/playbooks/bug-fix.md`|修Bug|吸收|`@bug` 全文|真实面复现→二分探因→先红后绿→清残余→先败后过实录|
|68|`skills/poteto-mode/playbooks/eval.md`|评测|部分吸收|`@improve` 附录|防观察者效应盲测思路(脱敏+查真实读档)，大改可选|
|69|`skills/poteto-mode/playbooks/feature.md`|功能|吸收|`@feat` §1,5|追影响→选形→并发四问→定数据状态→对抗审→小步收口|
|70|`skills/poteto-mode/playbooks/hillclimb.md`|性能|吸收|`@perf` §2|双停步谓词→冻带错量桩→`perf.tsv`单变量试→平台期切策略|
|71|`skills/poteto-mode/playbooks/investigation.md`|调研|吸收|`@ana` §1.1|严格只读不改码、免拆并发表、按结构/对比答，错前提直驳|
|72|`skills/poteto-mode/playbooks/multi-phase-plan.md`|规划|部分吸收|`@long` §1|小改免方案；不确定先原型；列依赖/独占/三证待批开跑|
|73|`skills/poteto-mode/playbooks/opening-a-pr.md`|收口|部分吸收|`@wf` §4|剔 PR/`gh`/`/deslop`；剥无关改动、<=40行6段简报、日志外放|
|74|`skills/poteto-mode/playbooks/pause-safely.md`|暂停|吸收|`@long` §5.1|仅明确暂停，停原子边界关子任务、禁不可逆、留续跑备忘|
|75|`skills/poteto-mode/playbooks/perf-issue.md`|性能|吸收|`@perf` §1|纯净基线+独立剖析，禁猜源码；7阶梯由廉入贵达标止|
|76|`skills/poteto-mode/playbooks/prototype.md`|原型|吸收|`@feat` §3|仅消分叉建 `scratch/` 速成对比，定案后作废重写|
|77|`skills/poteto-mode/playbooks/refactoring.md`|重构|吸收|`@feat` §2|剥新功能；行为锚→先减后加→同波删旧→等价跑→减负判留|
|78|`skills/poteto-mode/playbooks/runtime-forensics.md`|取证|吸收|`@ana` §1.4, `@perf`|禁猜源码，抓活进程剖析/堆/CDP，提炼并回标行号|
|79|`skills/poteto-mode/playbooks/session-pickup.md`|续跑|吸收|`@long` §5.2|读 TSV/本仓日志/git 作权威起点不重做，只验继承声明|
|80|`skills/poteto-mode/playbooks/shipping.md`|核验|部分吸收|`@wf` §4|拒 GitHub 栈合入；“作者自报不算验收，高风险须独立核验”|
|81|`skills/poteto-mode/playbooks/trace-forensics.md`|取证|吸收|`@ana` §1.4, `@perf`|读已捕获档不重跑，转可查表寻热点标行号，标单档或对比|
|82|`skills/poteto-mode/playbooks/visual-parity.md`|对齐|吸收|`@feat` §4|冻基线截图桩、禁篡改或扭曲；公共控件先迁跑至0差异|
|83|`skills/poteto-mode/playbooks/worktree-cleanup.md`|清理|部分吸收|`@long` §5.3|拒 macOS 清理；查占用/合入/`wip`/`scratch`/会话再分级清理|

### 2.5 Agents（2 个，`agents/*.md`）

|# |上游路径|阶段|处置|A8 落地位置|核心吸收动作 / 拒绝原因|
|:---:|:---|:---|:---:|:---|:---|
|84|`agents/poteto-agent.md`|派发|部分吸收|`@wf` §3, `@tokens`|拒新增冗余代理；首行强传地图指针、默认新建干净子代理|
|85|`agents/comment-sicko.md`|清理|部分吸收|`@feat` §5, `@rules` §2|拒戏谑人设代理；5类注释白名单、改码除意外及删遮Bug抑制|

## 三、 不采纳清单与 A8 替代对照

|被拒绝或剥离的上游能力|拒绝原因|A8 现行替代实现|
|:---|:---|:---|
|`setup-pstack` / `pstack-models.mdc` 模型表|与 Antigravity `model: inherit` 及 `TOKENS.md` 冲突|Antigravity 原生模型继承与 `TOKENS.md` 分层|
|`make-bot-ui` / `setup-benny`(Slack/Tailscale)|引入公网暴露、SaaS 凭据与 Cursor Automations 强绑定|本地 `logs/grok-proposals/`、`:18765` Origin 校验与 `schedule`|
|`babysit` / `autopilot-stack` / PR 堆叠队列|A8 面向本地多仓构建打包，不用云代理堆叠 PR 合入|本地门禁 + DevTools Diff 审核 + `a8-judge` / `/a8-dsh-review`|
|`ketchup-video`、`poteto-help`、`.cursor/skills/verify-*`|视频管线重、命令碎片化，与 A8 单入口冲突|`/a8-workflow` + `<repo>/docs/verify.md` + `a8-ui-verify`|
|`poteto-agent.md` / `comment-sicko.md` 独立代理|增加 `check_plugin_agents.py` 维护面与人设噪音|并入 `SKILL.md` §3 与 `feature.md` §5 执行条款|
|`pele@1.9.0`+Java、`xcrun simctl`、英文 STE 语法|绑定特定外部渲染链、macOS 或纯英文修辞限制|`beautiful-mermaid`、Quint `.qnt`、`worktree`/`CowFS`、中文与 `glossary.md`|

## 四、 未来 `pstack` 升级比对指南

1. **网页对比**：`https://github.com/cursor/plugins/compare/0b46ec399d55f2829e88822998f53b84944837d3...main`
2. **本地稀疏克隆与 Diff**（放系统临时目录，不污染仓库）：
   ```powershell
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   $tmp = Join-Path $env:TEMP "pstack-upstream-diff"
   if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
   git clone --filter=blob:none --sparse https://github.com/cursor/plugins.git $tmp
   git -C $tmp sparse-checkout set pstack
   git -C $tmp log --oneline 0b46ec399d55f2829e88822998f53b84944837d3..HEAD -- pstack
   git -C $tmp diff --stat 0b46ec399d55f2829e88822998f53b84944837d3..HEAD -- pstack
   git -C $tmp log -p 0b46ec399d55f2829e88822998f53b84944837d3..HEAD -- pstack
   ```
3. **同步步骤**：① 盘点新增/变更/删废单元及新 Tag/SHA；② 剥离平台耦合与英文语法，按平实中文合入；③ 守住 `mind-rules.md <= 20,000 B`、`TOKENS.md < 1,000 B`、`a8-workflow/*.md` 远低于 `20,000 B`；④ 更新本映射表锚点、映射表并清理 `$tmp`；⑤ 运行 `E:\a8-devtools\scripts\lints\` 全部 5 项检查全绿。
