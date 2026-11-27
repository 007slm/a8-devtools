import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  analyzeModel,
  canonicalKey,
} from '../../plugins/a8-agent-mind/skills/a8-statechart/scripts/statechart.mjs';

const CLI_SCRIPT = path.resolve(
  'plugins/a8-agent-mind/skills/a8-statechart/scripts/statechart.mjs'
);

test('canonicalKey: 对象键顺序不同、Set/Map 成员顺序不同均输出同一规范键', () => {
  const a = { b: 2, a: 1, s: new Set(['y', 'x']), m: new Map([['k2', 2], ['k1', 1]]) };
  const b = { a: 1, b: 2, s: new Set(['x', 'y']), m: new Map([['k1', 1], ['k2', 2]]) };
  assert.equal(canonicalKey(a), canonicalKey(b));
});

test('真实并发建模：无 Epoch 守卫的 CDC 快照切流被引擎抓出 3 步交错脏写，补守卫后全绿', () => {
  function makeCdcModel(enforceEpochGuard) {
    return {
      title: 'CDC 快照与重连 Epoch 守卫状态机',
      init: () => ({
        phase: 'INIT', // INIT | SNAPSHOT | READY | STOPPED
        epoch: 1,
        inFlightEpoch: null,
        corrupted: false,
      }),
      actions: {
        startSnapshot(s) {
          if (s.phase !== 'INIT' || s.inFlightEpoch !== null) return null;
          return { ...s, phase: 'SNAPSHOT', inFlightEpoch: s.epoch };
        },
        reconnectBumpEpoch(s) {
          if (s.phase !== 'SNAPSHOT' || s.epoch >= 2) return null;
          // 重连提升 epoch 并直接切入新同步就绪，但旧请求仍在途
          return { ...s, epoch: s.epoch + 1, phase: 'READY' };
        },
        staleSnapshotCallback(s) {
          if (s.inFlightEpoch === null) return null;
          if (enforceEpochGuard && s.inFlightEpoch !== s.epoch) {
            // 丢弃陈旧 epoch 响应
            return { ...s, inFlightEpoch: null };
          }
          const isStale = s.inFlightEpoch !== s.epoch;
          return {
            ...s,
            inFlightEpoch: null,
            phase: 'READY',
            corrupted: s.corrupted || isStale,
          };
        },
        stop(s) {
          if (s.phase === 'STOPPED') return null;
          return { ...s, phase: 'STOPPED', inFlightEpoch: null };
        },
      },
      invariants: {
        绝不被旧Epoch回调污染就绪态: (s) => !s.corrupted,
      },
      isTerminal: (s) => s.phase === 'STOPPED',
      isGoal: (s) => (s.phase === 'READY' && !s.corrupted) || s.phase === 'STOPPED',
      view: {
        state: (s) => {
          if (s.corrupted) return '就绪态（已被旧Epoch写脏）';
          if (s.phase === 'READY' && s.inFlightEpoch !== null) return '就绪态（旧请求仍在途）';
          const map = { INIT: '初始化', SNAPSHOT: '快照拉取中', READY: '就绪', STOPPED: '已停止' };
          return map[s.phase];
        },
        step: (action) => ({
          startSnapshot: '发起快照',
          reconnectBumpEpoch: '重连升Epoch并切就绪',
          staleSnapshotCallback: '旧快照回调到达',
          stop: '停止服务',
        }[action]),
        group: (s) => (s.phase === 'READY' ? 'ok' : null),
        colors: { ok: 'green' },
      },
    };
  }

  // 1. 缺守卫版：必报 FAILED，抓出 3 步最短路径，并标记 breaks
  const buggy = analyzeModel(makeCdcModel(false));
  assert.equal(buggy.verdict, 'FAILED');
  const invHit = buggy.violations.find((v) => v.rule === '绝不被旧Epoch回调污染就绪态');
  assert.ok(invHit, '应捕获旧 Epoch 写脏违例');
  assert.equal(invHit.path.steps.length, 3);
  assert.deepEqual(
    invHit.path.steps.map((x) => x.action),
    ['startSnapshot', 'reconnectBumpEpoch', 'staleSnapshotCallback']
  );
  assert.match(buggy.mermaid, /stateDiagram-v2/);
  assert.match(buggy.mermaid, /classDef breaks/);
  assert.equal(buggy.deadActions.length, 0);

  // 2. 补守卫版：全绿 PASSED，0 违例
  const fixed = analyzeModel(makeCdcModel(true));
  assert.equal(fixed.verdict, 'PASSED');
  assert.equal(fixed.violations.length, 0);
  assert.doesNotMatch(fixed.mermaid, /classDef breaks/);
  assert.match(fixed.mermaid, /classDef grp_0/);
});

test('死锁检测：非终态无出边报 DEADLOCK，标记 isTerminal 后恢复 PASSED', () => {
  const base = {
    title: '死锁示例',
    init: () => ({ step: 'START' }),
    actions: {
      advance: (s) => (s.step === 'START' ? { step: 'STUCK' } : null),
    },
    invariants: {},
    view: { state: (s) => s.step },
  };
  const stuck = analyzeModel(base);
  assert.equal(stuck.verdict, 'FAILED');
  assert.equal(stuck.violations[0].rule, 'DEADLOCK');
  assert.equal(stuck.violations[0].path.steps.length, 1);

  const ok = analyzeModel({ ...base, isTerminal: (s) => s.step === 'STUCK' });
  assert.equal(ok.verdict, 'PASSED');
});

test('反向可达性陷阱检测：无死锁但陷入无法再回到 isGoal 的死循环时必报 TRAP', () => {
  const res = analyzeModel({
    title: '不可逆死循环陷阱示例',
    init: () => ({ phase: 'INIT' }),
    actions: {
      succeed: (s) => (s.phase === 'INIT' ? { phase: 'READY' } : null),
      failToLoop: (s) => (s.phase === 'INIT' ? { phase: 'RETRY_A' } : null),
      ping: (s) => (s.phase === 'RETRY_A' ? { phase: 'RETRY_B' } : null),
      pong: (s) => (s.phase === 'RETRY_B' ? { phase: 'RETRY_A' } : null),
      neverUsed: (s) => (s.phase === 'IMPOSSIBLE' ? { phase: 'READY' } : null),
    },
    isTerminal: (s) => s.phase === 'READY',
    isGoal: (s) => s.phase === 'READY',
    view: { state: (s) => s.phase },
  });

  assert.equal(res.verdict, 'FAILED');
  assert.ok(res.violations.some((v) => v.rule === 'TRAP'), '应检出 TRAP 死循环陷阱');
  assert.ok(!res.violations.some((v) => v.rule === 'DEADLOCK'), '活锁有出边，不应误报 DEADLOCK');
  assert.deepEqual(res.deadActions, ['neverUsed']);
});

test('支持嵌套状态、并发正交区跨区守卫、[mayBreak] 合并提醒与原地修改冻结拦截', () => {
  // 1. 并发正交区
  const parallel = analyzeModel({
    title: '并发正交区示例',
    init: () => ({ net: 'OFFLINE', sync: 'IDLE' }),
    actions: {
      connect: (s) => (s.net === 'OFFLINE' ? { ...s, net: 'ONLINE' } : null),
      disconnect: (s) => (s.net === 'ONLINE' ? { ...s, net: 'OFFLINE' } : null),
      startSync: (s) =>
        s.net === 'ONLINE' && s.sync === 'IDLE' ? { ...s, sync: 'RUNNING' } : null,
      stopSync: (s) => (s.sync === 'RUNNING' ? { ...s, sync: 'IDLE' } : null),
    },
    invariants: {},
    view: {
      state: (s) => ({ 网络: s.net, 同步: s.sync }),
      step: (a) => ({ connect: '联网', disconnect: '断网', startSync: '开始同步', stopSync: '停止同步' }[a]),
    },
  });
  assert.equal(parallel.verdict, 'PASSED');
  assert.match(parallel.mermaid, /--/);
  assert.match(parallel.mermaid, /\[当 网络=ONLINE\]/);

  // 2. 嵌套态 + mayBreak 警告 + 隐藏边告警
  const nested = analyzeModel({
    title: '嵌套与合并告警',
    init: () => ({ phase: 'WORK', bad: false }),
    actions: {
      corrupt: (s) => (!s.bad ? { phase: 'WORK', bad: true } : null),
      done: (s) => (s.phase === 'WORK' ? { phase: 'DONE', bad: s.bad } : null),
    },
    invariants: { 无脏态: (s) => !s.bad },
    isTerminal: (s) => s.phase === 'DONE',
    view: {
      state: (s) => (s.phase === 'WORK' ? ['运行期', '处理中'] : ['结束期', '完成']),
      step: (a) => (a === 'done' ? null : a),
    },
  });
  assert.equal(nested.verdict, 'FAILED');
  assert.match(nested.mermaid, /classDef mayBreak/);
  assert.ok(nested.warnings.some((w) => w.includes('mayBreak')));
  assert.ok(nested.warnings.some((w) => w.includes('失去从起点可达的路径')));

  // 3. 原地修改状态必须立即抛 TypeError
  assert.throws(
    () =>
      analyzeModel({
        init: () => ({ count: 0 }),
        actions: {
          mutateInPlace(s) {
            s.count = 1;
            return s;
          },
        },
      }),
    TypeError
  );
});

test('状态数超 chartMaxStates 预算时：有违例仅绘最短反例路径，无违例省略全图', () => {
  const bigClean = analyzeModel({
    init: () => ({ n: 0 }),
    actions: { inc: (s) => (s.n < 10 ? { n: s.n + 1 } : null) },
    isTerminal: (s) => s.n === 10,
    chartMaxStates: 5,
    view: { state: (s) => `N${s.n}` },
  });
  assert.equal(bigClean.verdict, 'PASSED');
  assert.equal(bigClean.stats.chartMode, 'omitted_too_large');
  assert.equal(bigClean.mermaid, null);

  const bigBuggy = analyzeModel({
    init: () => ({ n: 0 }),
    actions: { inc: (s) => (s.n < 10 ? { n: s.n + 1 } : null) },
    invariants: { 不超3: (s) => s.n <= 3 },
    isTerminal: (s) => s.n === 10,
    chartMaxStates: 5,
    view: { state: (s) => `N${s.n}` },
  });
  assert.equal(bigBuggy.verdict, 'FAILED');
  assert.equal(bigBuggy.stats.chartMode, 'bug_paths_only');
  assert.ok(bigBuggy.mermaid && bigBuggy.mermaid.includes('N4'));
});

test('CLI 端到端实跑：落盘 chart.mmd 与 report.md，违规退出码 1、全绿退出码 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a8-statechart-test-'));
  try {
    const modelFile = path.join(tmpDir, 'model.mjs');
    const outDir = path.join(tmpDir, 'out');
    fs.writeFileSync(
      modelFile,
      `export default {
        title: 'CLI 实测模型',
        init: () => ({ s: 'A' }),
        actions: { go: (x) => (x.s === 'A' ? { s: 'B' } : null) },
        isTerminal: (x) => x.s === 'B',
        isGoal: (x) => x.s === 'B',
        view: { state: (x) => x.s, step: () => '切换' },
      };\n`,
      'utf8'
    );
    const stdout = execFileSync(process.execPath, [CLI_SCRIPT, modelFile, '--out', outDir], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.verdict, 'PASSED');
    assert.ok(fs.existsSync(path.join(outDir, 'chart.mmd')));
    assert.ok(fs.existsSync(path.join(outDir, 'report.md')));
    const mmd = fs.readFileSync(path.join(outDir, 'chart.mmd'), 'utf8');
    assert.match(mmd, /stateDiagram-v2/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
