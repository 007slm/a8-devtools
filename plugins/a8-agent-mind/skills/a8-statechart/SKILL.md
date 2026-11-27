---
name: a8-statechart
description: "面向用户主动触发的高危并发与协议状态机穷举校验与 Mermaid 状态图生成技能。触发指令包括 /a8-statechart、状态机校验、穷举状态机、画状态转换图；日常写代码严禁自动触发。用可读的纯 JS/TS 写出状态机模型，经零依赖 Node.js BFS 引擎穷举全部可达态，自动检出 Safety 不变量违例、死锁（DEADLOCK）与不可逆死循环陷阱（TRAP），输出带红橙标记的 Mermaid stateDiagram-v2 与最短反例路径报告，并要求回真实代码 1:1 复现核验。"
---

# A8 Statechart · 高危状态机穷举检验与状态图 (`a8-statechart`)

> **纯手动触发纪律**：仅在用户显式输入 `/a8-statechart`、`状态机校验`、`穷举状态机`、`画状态转换图` 时激活；日常简单顺序流直接画 Mermaid 即可，**严禁日常自动加载**，保持零日常 Token 开销。  
> **核心铁律**：**高危并发/协议/多阶段生命周期状态机绝不靠 AI 脑推画假图**——必须写出人一眼能看懂的 JS/TS 模型，交给确定性 BFS 引擎穷举全部交错时序并吐出最短反例路径。

---

## 一、 适用范围与能力边界

- **强项（机器穷举，绝不漏步）**：
  1. **Safety（安全不变量）**：绝不出现脏读、双写、错乱态，保证给出每条违例的**最短反例路径**；
  2. **Deadlock（死锁）**：非合法终态却没有任何使能动作；
  3. **Trap（不可逆死循环陷阱）**：提供 `isGoal(s)` 后，用反向可达性抓出“虽有后续动作但永远再也回不到 `READY`/`STOPPED` 的死循环陷阱”；
  4. **死分支预警**：自动列出模型中从未触发过的动作，及时暴露建模错误。
- **诚实边界（不涵盖完整 Liveness 公平性）**：本引擎为轻量零依赖 BFS，不处理“存在通往成功路径但持续被外部干扰无限插队饿死”的强公平性（Fairness）活性证明；若需要证明此类分布活性，再按需使用 Quint (`.qnt`) 或 TLA+。

---

## 二、 标准执行流水线（5 步闭环）

### 第 1 步：在隔离目录编写可读模型（不污染仓库源码）
将模型文件写在目标仓 `logs/statechart/<任务名>/model.mjs`（`logs/` 已纳入 `.gitignore`）或系统临时目录。模型为标准 Node.js ESM，**严禁在动作中原地修改传入的 `s`（引擎会自动 `Object.freeze` 拦截）**：

```js
export default {
  title: '模块名 · 核心状态机',
  init() {
    return { phase: 'INIT', epoch: 1, inFlight: false };
  },
  actions: {
    // 返回新状态对象、状态数组（表达非确定性成功/失败/乱序），或 null 表示当前不可触发
    start(s) {
      if (s.phase !== 'INIT') return null;
      return { ...s, phase: 'SYNCING', inFlight: true };
    },
    finish(s) {
      if (!s.inFlight) return null;
      return [
        { ...s, inFlight: false, phase: 'READY' },
        { ...s, inFlight: false, phase: 'ERROR' },
      ];
    },
  },
  invariants: {
    '不变量名称（用人话写清业务底线）': (s) => !(s.phase === 'READY' && s.inFlight),
  },
  isTerminal: (s) => s.phase === 'STOPPED',   // 合法结束态（不算死锁）
  isGoal: (s) => s.phase === 'READY' || s.phase === 'STOPPED', // 可选：开启死循环陷阱检测
  view: {
    // 形态三选一：string（扁平）| string[]（父子嵌套）| { 区A: '...', 区B: '...' }（并发正交区）
    state: (s) => (s.inFlight ? `${s.phase}（请求在途）` : s.phase),
    // 返回箭头业务文案；返回 null 可隐藏次要复位边（引擎会自动检查隐藏后是否断链）
    step: (action) => ({ start: '发起同步', finish: '同步回调' }[action] ?? action),
    group: (s) => (s.phase === 'READY' ? 'ok' : null),
    colors: { ok: 'green' }, // 内置 blue / green / amber / purple / gray
  },
};
```

> **建模 3 条底线**：
> 1. **永不放宽不变量**：违例是线索不是报错，严禁为了跑绿删弱 `invariants`；
> 2. **状态常量保持最小代表规模**（如 2 个节点、2 轮 Epoch、`maxRetries = 2`），保证探索迅速且全图状态数尽量 `<= 500`；
> 3. **破坏抓虫自检**：模型首次全绿后，可临时注释 1 条关键守卫跑一遍，确认引擎真能报 `FAILED` 并吐出预期反例路径后再恢复。

### 第 2 步：运行零依赖校验与出图引擎
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
node C:/Users/007sl/.gemini/config/plugins/a8-agent-mind/skills/a8-statechart/scripts/statechart.mjs <model.mjs> --out <out_dir>
```
- 产出 `<out_dir>/chart.mmd`（标准 Mermaid `stateDiagram-v2`，违例态自动标红 `breaks` / 标橙 `mayBreak`）与 `<out_dir>/report.md`（中文统计、每条违例的最短路径、死动作与视图提醒）。
- 可选参数：`--view <view.mjs>`（独立视图覆盖）、`--max-states <N>`（默认 `100000`）、`--chart-max-states <N>`（默认 `500`，超限且有违例时自动只画最短反例路径子图）。

### 第 3 步：按「读者视角 + 20 箭头预算」打磨视图
- **写人话、禁塞变量名**：节点和箭头写外部可见的业务态/动作，不写 `isDirty=true` 或内部方法名；
- **硬控约 20 条箭头以内**：若 `report.md` 提示箭头超 20，先粗化 `view.state` 合并等价细节态（但**绝不把破规态和正常态或不同破规规则混并成 `mayBreak`**），再用 `view.step` 返回 `null` 隐藏次要复位边，并在交付时明文说明隐藏了哪些边。

### 第 4 步：交付图、路径与模型省略声明
在回复中直接以 `mermaid` 代码块呈现 `chart.mmd`（Antigravity 与 DevTools `beautiful-mermaid` 看板均原生渲染），并附：
1. 校验统计与每条违例的一句话结论 + 最短步数路径；
2. 模型有意省略了哪些现实细节与图中隐藏了哪些次要边；
3. 复跑命令。

### 第 5 步：回真实代码 1:1 复现（防“自洽假图”）
当模型对应真实业务代码时，**每条报出的 Bug 路径都必须按动作顺序回真实代码写单测或实跑复现**；如果真实代码复现不出该 Bug，默认怀疑**模型写偏或漏了真实守卫**，直到查明源码真相为止。

---

> 方法溯源：读者视角状态图、20 箭头预算、`breaks`/`mayBreak` 标红与“模型反例 1:1 回真实代码重放”纪律借鉴自 `cursor/plugins/pstack` (`v0.15.48`, MIT License) 的 `skills/statechart/SKILL.md`，底层引擎改写为零依赖 Node.js ESM BFS + 反向可达陷阱检验器，彻底去除 TLA+ / `mise` / `pele` 外部重型依赖。
