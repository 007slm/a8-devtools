#!/usr/bin/env node
/**
 * A8 Statechart — 零依赖 Node.js 状态机穷举检验与 Mermaid 状态图生成器
 *
 * 能力：
 *   1. 确定性 BFS 穷举可达状态空间（自动冻结状态防原地修改）
 *   2. Safety 不变量检测 + Deadlock 死锁检测 + 反向可达性 Trap（不可逆死循环陷阱）检测
 *   3. 为每条违例输出最短反例路径
 *   4. 按读者视角 (--view) 投影为扁平 / 嵌套 / 并发正交区 Mermaid stateDiagram-v2 与中文报告
 *
 * 用法：
 *   node statechart.mjs <model.mjs> [--view <view.mjs>] [--out <dir>] [--max-states <N>] [--chart-max-states <N>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_STATES = 100_000;
const DEFAULT_CHART_MAX_STATES = 500;
const RECOMMENDED_MAX_ARROWS = 20;

const PRESET_COLORS = {
  blue: 'fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a',
  green: 'fill:#f0fdf4,stroke:#16a34a,color:#14532d',
  amber: 'fill:#fffbeb,stroke:#d97706,color:#78350f',
  purple: 'fill:#faf5ff,stroke:#9333ea,color:#581c87',
  gray: 'fill:#f4f4f5,stroke:#71717a,color:#27272a',
};

export function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else if (value instanceof Set) {
    for (const item of value) deepFreeze(item, seen);
  } else if (value instanceof Map) {
    for (const [k, v] of value.entries()) {
      deepFreeze(k, seen);
      deepFreeze(v, seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key], seen);
    }
  }
  return Object.freeze(value);
}

export function canonicalKey(value, stack = new Set()) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'undefined') return 'undefined';
  if (t === 'boolean' || t === 'number') return JSON.stringify(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'string') return JSON.stringify(value);
  if (t !== 'object') {
    throw new Error(`状态包含不可序列化字段类型: ${t}`);
  }
  if (stack.has(value)) {
    throw new Error('状态对象存在循环引用，无法进行确定性去重');
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalKey(item, stack)).join(',')}]`;
    }
    if (value instanceof Set) {
      const items = Array.from(value, (item) => canonicalKey(item, stack)).sort();
      return `Set(${items.join(',')})`;
    }
    if (value instanceof Map) {
      const entries = Array.from(value.entries(), ([k, v]) => [
        canonicalKey(k, stack),
        canonicalKey(v, stack),
      ]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return `Map(${entries.map(([k, v]) => `${k}=>${v}`).join(',')})`;
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalKey(value[k], stack)}`);
    return `{${parts.join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function normalizeActions(rawActions) {
  if (!rawActions) {
    throw new Error('模型缺少 actions 定义');
  }
  if (Array.isArray(rawActions)) {
    return rawActions.map((entry, idx) => {
      if (!entry || typeof entry.run !== 'function') {
        throw new Error(`actions[${idx}] 必须包含 run(state) 函数`);
      }
      return {
        name: String(entry.name || `action_${idx}`),
        guard: typeof entry.guard === 'function' ? entry.guard : null,
        run: entry.run,
      };
    });
  }
  if (typeof rawActions === 'object') {
    return Object.entries(rawActions).map(([name, fnOrObj]) => {
      if (typeof fnOrObj === 'function') {
        return { name, guard: null, run: fnOrObj };
      }
      if (fnOrObj && typeof fnOrObj.run === 'function') {
        return {
          name,
          guard: typeof fnOrObj.guard === 'function' ? fnOrObj.guard : null,
          run: fnOrObj.run,
        };
      }
      throw new Error(`动作 "${name}" 必须是函数或包含 run(state) 的对象`);
    });
  }
  throw new Error('actions 必须是对象或数组');
}

function normalizeInvariants(rawInvariants) {
  if (!rawInvariants) return [];
  if (Array.isArray(rawInvariants)) {
    return rawInvariants.map((entry, idx) => {
      if (!entry || typeof entry.check !== 'function') {
        throw new Error(`invariants[${idx}] 必须包含 check(state) 函数`);
      }
      return {
        name: String(entry.name || `invariant_${idx}`),
        description: entry.description ? String(entry.description) : String(entry.name || `invariant_${idx}`),
        check: entry.check,
      };
    });
  }
  if (typeof rawInvariants === 'object') {
    return Object.entries(rawInvariants).map(([name, fnOrObj]) => {
      if (typeof fnOrObj === 'function') {
        return { name, description: name, check: fnOrObj };
      }
      if (fnOrObj && typeof fnOrObj.check === 'function') {
        return {
          name,
          description: fnOrObj.description ? String(fnOrObj.description) : name,
          check: fnOrObj.check,
        };
      }
      throw new Error(`不变量 "${name}" 必须是函数或包含 check(state) 的对象`);
    });
  }
  throw new Error('invariants 必须是对象或数组');
}

function reconstructPath(nodes, targetId) {
  const steps = [];
  let cur = nodes[targetId];
  while (cur && cur.parentId !== null) {
    steps.push({
      fromId: cur.parentId,
      toId: cur.id,
      action: cur.parentAction,
    });
    cur = nodes[cur.parentId];
  }
  steps.reverse();
  const rootId = cur ? cur.id : targetId;
  return { rootId, steps, targetId };
}

function sanitizeMermaidLabel(text) {
  return String(text)
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, "'")
    .replace(/:/g, '：')
    .trim();
}

function sanitizeEdgeLabel(text) {
  return String(text)
    .replace(/\r?\n/g, ' ')
    .replace(/:/g, '：')
    .trim();
}

function formatStateSummary(state) {
  if (state === null || typeof state !== 'object') return String(state);
  const parts = Object.keys(state)
    .sort()
    .map((k) => {
      const v = state[k];
      return `${k}=${typeof v === 'object' ? canonicalKey(v) : String(v)}`;
    });
  return `{ ${parts.join(', ')} }`;
}

function formatStateDiff(fromState, toState) {
  if (!fromState || !toState || typeof fromState !== 'object' || typeof toState !== 'object') {
    return `${formatStateSummary(fromState)} -> ${formatStateSummary(toState)}`;
  }
  const keys = new Set([...Object.keys(fromState), ...Object.keys(toState)]);
  const diffs = [];
  for (const k of Array.from(keys).sort()) {
    const a = canonicalKey(fromState[k]);
    const b = canonicalKey(toState[k]);
    if (a !== b) {
      diffs.push(`${k}: ${a} -> ${b}`);
    }
  }
  return diffs.length > 0 ? diffs.join(', ') : '(无字段变化)';
}

function resolveColorStyle(colorSpec) {
  if (!colorSpec) return null;
  if (PRESET_COLORS[colorSpec]) return PRESET_COLORS[colorSpec];
  return String(colorSpec);
}

/**
 * 纯函数核心：穷举探索状态空间、检查不变量/死锁/活锁陷阱，并投影为 Mermaid 状态图与报告
 */
export function analyzeModel(spec, options = {}) {
  if (!spec || typeof spec.init !== 'function') {
    throw new Error('模型必须提供 init() 函数');
  }

  const maxStates = Number(options.maxStates ?? spec.maxStates ?? DEFAULT_MAX_STATES);
  const chartMaxStates = Number(options.chartMaxStates ?? spec.chartMaxStates ?? DEFAULT_CHART_MAX_STATES);
  const checkDeadlock = spec.checkDeadlock !== false;
  const actions = normalizeActions(spec.actions);
  const invariants = normalizeInvariants(spec.invariants);
  const isTerminal = typeof spec.isTerminal === 'function' ? spec.isTerminal : () => false;
  const isGoal = typeof spec.isGoal === 'function' ? spec.isGoal : null;
  const viewOverride = options.viewOverride || null;
  const view = {
    ...(spec.view || {}),
    ...(viewOverride || {}),
  };
  const title = view.title || spec.title || '状态转换图';

  const rawInit = spec.init();
  const initList = Array.isArray(rawInit) ? rawInit : [rawInit];
  if (initList.length === 0) {
    throw new Error('init() 至少返回一个初始状态');
  }

  const stateIdByKey = new Map();
  const nodes = [];
  const edges = [];
  const initIds = [];
  const firedActions = new Set();
  const firstViolationByRule = new Map(); // ruleName -> { rule, description, kind, path }
  let truncated = false;

  function registerState(rawState, parentId, parentAction) {
    const frozen = deepFreeze(rawState);
    const key = canonicalKey(frozen);
    const existing = stateIdByKey.get(key);
    if (existing !== undefined) {
      return { id: existing, isNew: false };
    }
    if (nodes.length >= maxStates) {
      truncated = true;
      return { id: null, isNew: false };
    }
    const id = nodes.length;
    const node = {
      id,
      key,
      state: frozen,
      parentId,
      parentAction,
      depth: parentId === null ? 0 : nodes[parentId].depth + 1,
      outEdges: [],
      inEdges: [],
      violations: [],
      isInit: parentId === null,
      isTerminal: false,
      isGoal: false,
    };
    stateIdByKey.set(key, id);
    nodes.push(node);
    return { id, isNew: true };
  }

  const queue = [];
  for (const s of initList) {
    const res = registerState(s, null, null);
    if (res.id !== null && res.isNew) {
      initIds.push(res.id);
      queue.push(res.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const uId = queue[head++];
    const u = nodes[uId];

    u.isTerminal = Boolean(isTerminal(u.state));
    if (isGoal) {
      u.isGoal = Boolean(isGoal(u.state));
    }

    // 1. Safety 不变量检查
    for (const inv of invariants) {
      const ok = Boolean(inv.check(u.state));
      if (!ok) {
        u.violations.push(inv.name);
        if (!firstViolationByRule.has(inv.name)) {
          firstViolationByRule.set(inv.name, {
            rule: inv.name,
            description: inv.description,
            kind: 'invariant',
            path: reconstructPath(nodes, uId),
          });
        }
      }
    }

    // 2. 展开全部使能动作
    let outgoingCount = 0;
    for (const act of actions) {
      if (act.guard && !act.guard(u.state)) continue;
      const outcome = act.run(u.state);
      if (outcome === null || outcome === undefined) continue;
      const nextStates = Array.isArray(outcome) ? outcome : [outcome];
      if (nextStates.length === 0) continue;

      firedActions.add(act.name);
      for (const nextState of nextStates) {
        if (nextState === null || nextState === undefined) continue;
        const reg = registerState(nextState, uId, act.name);
        if (reg.id === null) {
          // 达到 maxStates 上限，停止新增节点
          continue;
        }
        outgoingCount++;
        const edge = {
          id: edges.length,
          fromId: uId,
          toId: reg.id,
          action: act.name,
        };
        edges.push(edge);
        u.outEdges.push(edge.id);
        nodes[reg.id].inEdges.push(edge.id);
        if (reg.isNew) {
          queue.push(reg.id);
        }
      }
    }

    // 3. Deadlock 死锁检查（仅在未截断且非合法终态时判定）
    if (checkDeadlock && !truncated && outgoingCount === 0 && !u.isTerminal) {
      const deadlockRule = 'DEADLOCK';
      u.violations.push(deadlockRule);
      if (!firstViolationByRule.has(deadlockRule)) {
        firstViolationByRule.set(deadlockRule, {
          rule: deadlockRule,
          description: '非终态无任何可执行动作（死锁）',
          kind: 'deadlock',
          path: reconstructPath(nodes, uId),
        });
      }
    }
  }

  // 4. 反向可达性死循环陷阱（Trap）检测（仅当模型定义了 isGoal 且未截断）
  let goalStateCount = 0;
  if (isGoal && !truncated) {
    const canReachGoal = new Set();
    const revQueue = [];
    for (const n of nodes) {
      if (n.isGoal) {
        goalStateCount++;
        canReachGoal.add(n.id);
        revQueue.push(n.id);
      }
    }
    let rHead = 0;
    while (rHead < revQueue.length) {
      const curId = revQueue[rHead++];
      for (const edgeId of nodes[curId].inEdges) {
        const prevId = edges[edgeId].fromId;
        if (!canReachGoal.has(prevId)) {
          canReachGoal.add(prevId);
          revQueue.push(prevId);
        }
      }
    }
    // 按 BFS 发现顺序扫描，保证记录到最早（最短路径）的不可逃逸陷阱态
    const trapRule = 'TRAP';
    for (const n of nodes) {
      if (!canReachGoal.has(n.id) && !n.violations.includes('DEADLOCK')) {
        n.violations.push(trapRule);
        if (!firstViolationByRule.has(trapRule)) {
          firstViolationByRule.set(trapRule, {
            rule: trapRule,
            description: '存在后续动作但逻辑上永远无法再到达目标态（死循环陷阱）',
            kind: 'trap',
            path: reconstructPath(nodes, n.id),
          });
        }
      }
    }
  } else if (isGoal) {
    for (const n of nodes) {
      if (n.isGoal) goalStateCount++;
    }
  }

  const deadActions = actions.filter((a) => !firedActions.has(a.name)).map((a) => a.name);
  const violationsList = Array.from(firstViolationByRule.values());
  const verdict = truncated ? 'TRUNCATED' : violationsList.length === 0 ? 'PASSED' : 'FAILED';

  // 5. 视图投影与 Mermaid 构建
  const projection = buildProjection({
    title,
    nodes,
    edges,
    initIds,
    violationsList,
    view,
    chartMaxStates,
  });

  // 6. 生成中文可读报告
  const report = buildReport({
    title,
    verdict,
    truncated,
    maxStates,
    chartMaxStates,
    nodes,
    edges,
    initIds,
    isGoal: Boolean(isGoal),
    goalStateCount,
    violationsList,
    deadActions,
    projection,
    view,
    cliCommand: options.cliCommand || null,
  });

  return {
    title,
    verdict,
    truncated,
    stats: {
      states: nodes.length,
      transitions: edges.length,
      initStates: initIds.length,
      goalStates: goalStateCount,
      violations: violationsList.length,
      chartMode: projection.mode,
      chartArrows: projection.arrowCount,
    },
    violations: violationsList,
    deadActions,
    warnings: projection.warnings,
    hiddenSteps: projection.hiddenSteps,
    mermaid: projection.mermaid,
    report,
  };
}

function buildProjection({ title, nodes, edges, initIds, violationsList, view, chartMaxStates }) {
  const warnings = [];
  const hiddenSteps = new Set();

  // 决定参与绘图的子图集合
  let includedNodeIds;
  let includedEdgeIds;
  let mode;

  if (nodes.length <= chartMaxStates) {
    mode = 'full';
    includedNodeIds = new Set(nodes.map((n) => n.id));
    includedEdgeIds = new Set(edges.map((e) => e.id));
  } else if (violationsList.length > 0) {
    mode = 'bug_paths_only';
    includedNodeIds = new Set();
    includedEdgeIds = new Set();
    for (const v of violationsList) {
      includedNodeIds.add(v.path.rootId);
      for (const step of v.path.steps) {
        includedNodeIds.add(step.fromId);
        includedNodeIds.add(step.toId);
        const matchEdge = edges.find(
          (e) => e.fromId === step.fromId && e.toId === step.toId && e.action === step.action
        );
        if (matchEdge) includedEdgeIds.add(matchEdge.id);
      }
    }
    warnings.push(
      `状态数 (${nodes.length}) 超过全图预算 (${chartMaxStates})，仅绘制违规最短反例路径子图。`
    );
  } else {
    return {
      mode: 'omitted_too_large',
      mermaid: null,
      arrowCount: 0,
      warnings: [
        `全部规则通过，但状态数 (${nodes.length}) 超过全图预算 (${chartMaxStates})，未生成完整状态图；如需全图请缩小常量规模或调大 --chart-max-states。`,
      ],
      hiddenSteps: [],
    };
  }

  const stateFn =
    typeof view.state === 'function' ? view.state : (s) => formatStateSummary(s);
  const stepFn =
    typeof view.step === 'function' ? view.step : (action) => action;
  const groupFn =
    typeof view.group === 'function' ? view.group : () => null;
  const customColors = view.colors || {};

  // 缓存每个模型节点的视图结果（遵循只调用一次约定）
  const rawViewByNode = new Map();
  const groupByNode = new Map();
  let chartKind = null; // 'flat' | 'nested' | 'regions'

  for (const id of includedNodeIds) {
    const n = nodes[id];
    const v = stateFn(n.state);
    const kind =
      typeof v === 'string'
        ? 'flat'
        : Array.isArray(v)
          ? 'nested'
          : v && typeof v === 'object'
            ? 'regions'
            : null;
    if (!kind) {
      throw new Error('view.state(state) 必须返回 string、string[] 或键值对象');
    }
    if (chartKind === null) {
      chartKind = kind;
    } else if (chartKind !== kind) {
      throw new Error(`view.state(state) 返回形态不一致：同时出现了 ${chartKind} 与 ${kind}`);
    }
    rawViewByNode.set(id, v);
    groupByNode.set(id, groupFn(n.state) || null);
  }

  if (chartKind === 'regions') {
    return buildRegionsMermaid({
      title,
      nodes,
      edges,
      initIds,
      includedNodeIds,
      includedEdgeIds,
      rawViewByNode,
      stepFn,
      warnings,
      hiddenSteps,
      mode,
    });
  }

  return buildHierarchicalMermaid({
    title,
    nodes,
    edges,
    initIds,
    includedNodeIds,
    includedEdgeIds,
    rawViewByNode,
    groupByNode,
    stepFn,
    customColors,
    warnings,
    hiddenSteps,
    mode,
  });
}

function buildHierarchicalMermaid({
  title,
  nodes,
  edges,
  initIds,
  includedNodeIds,
  includedEdgeIds,
  rawViewByNode,
  groupByNode,
  stepFn,
  customColors,
  warnings,
  hiddenSteps,
  mode,
}) {
  // 聚合模型节点 -> 图节点
  const chartNodes = new Map(); // pathKey -> { id, pathParts, label, modelIds, groups, brokenCount, cleanCount, ruleSets, isInit }
  const modelToChartKey = new Map();
  let seq = 0;

  for (const id of includedNodeIds) {
    const raw = rawViewByNode.get(id);
    const parts = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const pathKey = parts.join('\u0000');
    modelToChartKey.set(id, pathKey);

    let cn = chartNodes.get(pathKey);
    if (!cn) {
      cn = {
        id: `S${seq++}`,
        pathParts: parts,
        label: parts[parts.length - 1],
        modelIds: [],
        groups: new Set(),
        brokenCount: 0,
        cleanCount: 0,
        ruleSets: new Set(),
        violatedRules: new Set(),
        isInit: false,
      };
      chartNodes.set(pathKey, cn);
    }
    const mn = nodes[id];
    cn.modelIds.push(id);
    if (initIds.includes(id)) cn.isInit = true;
    const g = groupByNode.get(id);
    if (g) cn.groups.add(g);
    if (mn.violations.length > 0) {
      cn.brokenCount++;
      const sortedSig = [...mn.violations].sort().join('+');
      cn.ruleSets.add(sortedSig);
      for (const r of mn.violations) cn.violatedRules.add(r);
    } else {
      cn.cleanCount++;
    }
  }

  // 检查粗化合并是否混入了不同违规规则或掩盖了破规态
  for (const cn of chartNodes.values()) {
    if (cn.brokenCount > 0 && cn.cleanCount > 0) {
      warnings.push(
        `状态「${cn.pathParts.join(' / ')}」合并了正常态与破规态，已降级标为 mayBreak（橙色），建议拆分 view.state 以便一眼定位违例。`
      );
    }
    if (cn.ruleSets.size > 1) {
      warnings.push(
        `状态「${cn.pathParts.join(' / ')}」同时合并了违反不同规则的模型态 (${Array.from(cn.violatedRules).join(', ')})，建议拆分 view.state。`
      );
    }
  }

  // 聚合边（跳过同图节点自环；step() 返回 null 则隐藏）
  const visibleEdgeMap = new Map(); // `${fromKey}|${toKey}|${label}` -> { fromKey, toKey, label }
  const modelOutEdgesTotal = new Map(); // chartKey -> number of non-self model edges
  const visibleOutEdgesCount = new Map();

  for (const edgeId of includedEdgeIds) {
    const e = edges[edgeId];
    if (!includedNodeIds.has(e.fromId) || !includedNodeIds.has(e.toId)) continue;
    const fromKey = modelToChartKey.get(e.fromId);
    const toKey = modelToChartKey.get(e.toId);
    if (fromKey === toKey) continue;

    modelOutEdgesTotal.set(fromKey, (modelOutEdgesTotal.get(fromKey) || 0) + 1);
    const label = stepFn(e.action, nodes[e.fromId].state, nodes[e.toId].state);
    if (label === null || label === undefined) {
      hiddenSteps.add(e.action);
      continue;
    }
    const cleanLabel = sanitizeEdgeLabel(label);
    const dedupKey = `${fromKey}\u0000${toKey}\u0000${cleanLabel}`;
    if (!visibleEdgeMap.has(dedupKey)) {
      visibleEdgeMap.set(dedupKey, { fromKey, toKey, label: cleanLabel });
      visibleOutEdgesCount.set(fromKey, (visibleOutEdgesCount.get(fromKey) || 0) + 1);
    }
  }

  // 检查隐藏边后的可达性与出边纪律
  if (hiddenSteps.size > 0) {
    const adj = new Map();
    for (const ve of visibleEdgeMap.values()) {
      if (!adj.has(ve.fromKey)) adj.set(ve.fromKey, []);
      adj.get(ve.fromKey).push(ve.toKey);
    }
    const reachable = new Set();
    const q = [];
    for (const [k, cn] of chartNodes.entries()) {
      if (cn.isInit) {
        reachable.add(k);
        q.push(k);
      }
    }
    for (let i = 0; i < q.length; i++) {
      for (const next of adj.get(q[i]) || []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          q.push(next);
        }
      }
    }
    for (const [k, cn] of chartNodes.entries()) {
      if (!reachable.has(k)) {
        warnings.push(`隐藏步骤后，状态「${cn.pathParts.join(' / ')}」在图中失去从起点可达的路径。`);
      }
      if ((modelOutEdgesTotal.get(k) || 0) > 0 && (visibleOutEdgesCount.get(k) || 0) === 0) {
        warnings.push(`隐藏步骤后，状态「${cn.pathParts.join(' / ')}」在图中没有剩余出边。`);
      }
    }
  }

  const visibleEdges = Array.from(visibleEdgeMap.values());
  if (visibleEdges.length > RECOMMENDED_MAX_ARROWS) {
    warnings.push(
      `状态图共有 ${visibleEdges.length} 条箭头，超过建议上限 (${RECOMMENDED_MAX_ARROWS})，建议先粗化 view.state 标签或用 view.step 返回 null 隐藏次要复位边。`
    );
  }

  // 构建树形声明（支持扁平与多层嵌套）
  const rootTree = { children: new Map(), leaf: null };
  for (const cn of chartNodes.values()) {
    let cursor = rootTree;
    for (let i = 0; i < cn.pathParts.length; i++) {
      const part = cn.pathParts[i];
      if (!cursor.children.has(part)) {
        cursor.children.set(part, { name: part, id: `G_${seq++}`, children: new Map(), leaf: null });
      }
      cursor = cursor.children.get(part);
    }
    cursor.leaf = cn;
  }

  const lines = [];
  lines.push('---');
  lines.push(`title: ${sanitizeMermaidLabel(title)}`);
  lines.push('---');
  lines.push('stateDiagram-v2');

  function emitTree(node, indent) {
    for (const child of node.children.values()) {
      if (child.children.size > 0 && !child.leaf) {
        lines.push(`${indent}state "${sanitizeMermaidLabel(child.name)}" as ${child.id} {`);
        emitTree(child, `${indent}  `);
        lines.push(`${indent}}`);
      } else if (child.leaf) {
        lines.push(`${indent}state "${sanitizeMermaidLabel(child.leaf.label)}" as ${child.leaf.id}`);
      }
    }
  }
  emitTree(rootTree, '  ');

  for (const cn of chartNodes.values()) {
    if (cn.isInit) {
      lines.push(`  [*] --> ${cn.id}`);
    }
  }
  for (const ve of visibleEdges) {
    const fromId = chartNodes.get(ve.fromKey).id;
    const toId = chartNodes.get(ve.toKey).id;
    lines.push(`  ${fromId} --> ${toId} : ${ve.label}`);
  }

  // 样式 classDef 与 class 分配
  const usedGroups = new Set();
  const breaksIds = [];
  const mayBreakIds = [];
  const groupAssignments = new Map(); // groupName -> id[]

  for (const cn of chartNodes.values()) {
    if (cn.brokenCount > 0 && cn.cleanCount === 0) {
      breaksIds.push(cn.id);
    } else if (cn.brokenCount > 0 && cn.cleanCount > 0) {
      mayBreakIds.push(cn.id);
    } else if (cn.groups.size === 1) {
      const g = Array.from(cn.groups)[0];
      usedGroups.add(g);
      if (!groupAssignments.has(g)) groupAssignments.set(g, []);
      groupAssignments.get(g).push(cn.id);
    }
  }

  if (breaksIds.length > 0) {
    lines.push('  classDef breaks fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#991b1b');
    lines.push(`  class ${breaksIds.join(',')} breaks`);
  }
  if (mayBreakIds.length > 0) {
    lines.push('  classDef mayBreak fill:#ffedd5,stroke:#ea580c,stroke-width:2px,color:#9a3412');
    lines.push(`  class ${mayBreakIds.join(',')} mayBreak`);
  }
  let gIdx = 0;
  for (const g of usedGroups) {
    const style = resolveColorStyle(customColors[g]);
    if (!style) continue;
    const clsName = `grp_${gIdx++}`;
    lines.push(`  classDef ${clsName} ${style}`);
    lines.push(`  class ${groupAssignments.get(g).join(',')} ${clsName}`);
  }

  return {
    mode,
    mermaid: `${lines.join('\n')}\n`,
    arrowCount: visibleEdges.length,
    warnings,
    hiddenSteps: Array.from(hiddenSteps),
  };
}

function buildRegionsMermaid({
  title,
  nodes,
  edges,
  initIds,
  includedNodeIds,
  includedEdgeIds,
  rawViewByNode,
  stepFn,
  warnings,
  hiddenSteps,
  mode,
}) {
  const firstObj = rawViewByNode.values().next().value;
  const regionNames = Object.keys(firstObj);

  // 为每个正交区域分别聚合状态和违例情况
  const regionStates = new Map(); // regionName -> Map<label, { id, label, brokenCount, cleanCount, isInit }>
  let seq = 0;
  for (const r of regionNames) {
    regionStates.set(r, new Map());
  }

  for (const id of includedNodeIds) {
    const obj = rawViewByNode.get(id);
    const mn = nodes[id];
    const isInit = initIds.includes(id);
    for (const r of regionNames) {
      const label = String(obj[r]);
      const map = regionStates.get(r);
      if (!map.has(label)) {
        map.set(label, {
          id: `R${seq++}`,
          label,
          brokenCount: 0,
          cleanCount: 0,
          isInit: false,
        });
      }
      const entry = map.get(label);
      if (isInit) entry.isInit = true;
      if (mn.violations.length > 0) entry.brokenCount++;
      else entry.cleanCount++;
    }
  }

  // 每个区域内部边集合，自动推导跨区域守卫条件 [当 Other=Val]
  const regionEdges = new Map();
  for (const r of regionNames) regionEdges.set(r, new Map());

  for (const edgeId of includedEdgeIds) {
    const e = edges[edgeId];
    if (!includedNodeIds.has(e.fromId) || !includedNodeIds.has(e.toId)) continue;
    const fromObj = rawViewByNode.get(e.fromId);
    const toObj = rawViewByNode.get(e.toId);
    const rawStep = stepFn(e.action, nodes[e.fromId].state, nodes[e.toId].state);
    if (rawStep === null || rawStep === undefined) {
      hiddenSteps.add(e.action);
      continue;
    }
    const baseLabel = sanitizeEdgeLabel(rawStep);

    for (const r of regionNames) {
      const a = String(fromObj[r]);
      const b = String(toObj[r]);
      if (a === b) continue;
      const key = `${a}\u0000${b}\u0000${baseLabel}`;
      const rMap = regionEdges.get(r);
      if (!rMap.has(key)) {
        rMap.set(key, {
          fromLabel: a,
          toLabel: b,
          baseLabel,
          otherSnapshots: [],
        });
      }
      const other = {};
      for (const o of regionNames) {
        if (o !== r) other[o] = String(fromObj[o]);
      }
      rMap.get(key).otherSnapshots.push(other);
    }
  }

  const lines = [];
  lines.push('---');
  lines.push(`title: ${sanitizeMermaidLabel(title)}`);
  lines.push('---');
  lines.push('stateDiagram-v2');
  lines.push('  state "并发状态" as ParallelRoot {');

  let totalArrows = 0;
  const breaksIds = [];
  const mayBreakIds = [];

  regionNames.forEach((r, idx) => {
    if (idx > 0) lines.push('    --');
    const rMap = regionStates.get(r);
    for (const st of rMap.values()) {
      lines.push(`    state "${sanitizeMermaidLabel(`${r}: ${st.label}`)}" as ${st.id}`);
      if (st.brokenCount > 0 && st.cleanCount === 0) breaksIds.push(st.id);
      else if (st.brokenCount > 0 && st.cleanCount > 0) mayBreakIds.push(st.id);
    }
    for (const st of rMap.values()) {
      if (st.isInit) lines.push(`    [*] --> ${st.id}`);
    }
    for (const edge of regionEdges.get(r).values()) {
      totalArrows++;
      let label = edge.baseLabel;
      if (!label.includes('[')) {
        const guards = [];
        for (const o of regionNames) {
          if (o === r) continue;
          const observed = new Set(edge.otherSnapshots.map((snap) => snap[o]));
          const allPossible = regionStates.get(o).size;
          if (observed.size > 0 && observed.size < allPossible) {
            guards.push(`${o}=${Array.from(observed).join('|')}`);
          }
        }
        if (guards.length > 0) {
          label = `${label} [当 ${guards.join(' 且 ')}]`;
        }
      }
      const fromId = rMap.get(edge.fromLabel).id;
      const toId = rMap.get(edge.toLabel).id;
      lines.push(`    ${fromId} --> ${toId} : ${label}`);
    }
  });

  lines.push('  }');
  if (breaksIds.length > 0) {
    lines.push('  classDef breaks fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#991b1b');
    lines.push(`  class ${breaksIds.join(',')} breaks`);
  }
  if (mayBreakIds.length > 0) {
    lines.push('  classDef mayBreak fill:#ffedd5,stroke:#ea580c,stroke-width:2px,color:#9a3412');
    lines.push(`  class ${mayBreakIds.join(',')} mayBreak`);
  }

  if (totalArrows > RECOMMENDED_MAX_ARROWS) {
    warnings.push(`并发状态图共有 ${totalArrows} 条箭头，超过建议上限 (${RECOMMENDED_MAX_ARROWS})。`);
  }

  return {
    mode,
    mermaid: `${lines.join('\n')}\n`,
    arrowCount: totalArrows,
    warnings,
    hiddenSteps: Array.from(hiddenSteps),
  };
}

function formatViewLabel(view, state) {
  if (typeof view.state !== 'function') return formatStateSummary(state);
  const v = view.state(state);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(' / ');
  if (v && typeof v === 'object') {
    return Object.entries(v)
      .map(([k, val]) => `${k}=${val}`)
      .join(', ');
  }
  return String(v);
}

function buildReport({
  title,
  verdict,
  truncated,
  maxStates,
  chartMaxStates,
  nodes,
  edges,
  initIds,
  isGoal,
  goalStateCount,
  violationsList,
  deadActions,
  projection,
  view,
  cliCommand,
}) {
  const lines = [];
  lines.push(`# 状态机校验报告：${title}`);
  lines.push('');
  lines.push(`- **校验裁决**：\`${verdict}\`${truncated ? `（已触及最大状态数上限 ${maxStates}，结论不完整，请缩小常量规模）` : ''}`);
  lines.push(`- **状态空间统计**：可达状态 \`${nodes.length}\` 个 / 合法跃迁 \`${edges.length}\` 条 / 初始态 \`${initIds.length}\` 个${isGoal ? ` / 目标态 \`${goalStateCount}\` 个` : ''}`);
  lines.push(`- **状态图输出**：模式 \`${projection.mode}\`（全图预算 \`${chartMaxStates}\`，图内箭头 \`${projection.arrowCount}\` 条）`);
  if (cliCommand) {
    lines.push(`- **复现命令**：\`${cliCommand}\``);
  }
  lines.push('');

  if (violationsList.length === 0) {
    lines.push('## 规则校验结果');
    lines.push('');
    lines.push('所有已声明的 Safety 不变量、死锁检查与目标可达性检查均**全部通过（0 违例）**。');
    lines.push('');
  } else {
    lines.push(`## 违例清单与最短反例路径（共 ${violationsList.length} 项）`);
    lines.push('');
    violationsList.forEach((v, idx) => {
      const rootNode = nodes[v.path.rootId];
      lines.push(`### ${idx + 1}. \`${v.rule}\` — ${v.description}`);
      lines.push('');
      lines.push(`- **最短路径步数**：\`${v.path.steps.length}\` 步`);
      lines.push(`- **起点**：${formatViewLabel(view, rootNode.state)} \`${formatStateSummary(rootNode.state)}\``);
      v.path.steps.forEach((step, sIdx) => {
        const fromNode = nodes[step.fromId];
        const toNode = nodes[step.toId];
        const rawStep =
          typeof view.step === 'function' ? view.step(step.action, fromNode.state, toNode.state) : step.action;
        const stepLabel = rawStep === null || rawStep === undefined ? `${step.action}（图中已隐藏）` : rawStep;
        lines.push(
          `  ${sIdx + 1}. **${stepLabel}**（动作 \`${step.action}\`）→ ${formatViewLabel(view, toNode.state)}（变更：\`${formatStateDiff(fromNode.state, toNode.state)}\`）`
        );
      });
      lines.push('');
    });
  }

  if (deadActions.length > 0) {
    lines.push('## 从未触发的动作（疑似建模过严或死分支）');
    lines.push('');
    for (const name of deadActions) {
      lines.push(`- \`${name}\``);
    }
    lines.push('');
  }

  if (projection.hiddenSteps.length > 0) {
    lines.push('## 图中已隐藏的次要步骤');
    lines.push('');
    lines.push(projection.hiddenSteps.map((s) => `\`${s}\``).join('、'));
    lines.push('');
  }

  if (projection.warnings.length > 0) {
    lines.push('## 视图与图例提醒');
    lines.push('');
    for (const w of projection.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  lines.push('## 真实代码复现铁律');
  lines.push('');
  lines.push('- 上述每条违例路径必须按步骤在真实业务代码中写单测或实跑 1:1 重放；若真实代码无法复现，默认先排查模型是否漏了真实守卫条件。');
  lines.push('');

  return lines.join('\n');
}

function parseCliArgs(argv) {
  const args = { modelPath: null, viewPath: null, outDir: null, maxStates: undefined, chartMaxStates: undefined };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (cur === '--view') {
      args.viewPath = argv[++i];
    } else if (cur === '--out') {
      args.outDir = argv[++i];
    } else if (cur === '--max-states') {
      args.maxStates = Number(argv[++i]);
    } else if (cur === '--chart-max-states') {
      args.chartMaxStates = Number(argv[++i]);
    } else if (cur === '-h' || cur === '--help') {
      args.help = true;
    } else if (!cur.startsWith('-') && !args.modelPath) {
      args.modelPath = cur;
    } else {
      throw new Error(`未知参数: ${cur}`);
    }
  }
  return args;
}

async function runCli() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || !args.modelPath) {
    console.log(
      '用法: node statechart.mjs <model.mjs> [--view <view.mjs>] [--out <dir>] [--max-states <N>] [--chart-max-states <N>]'
    );
    process.exit(args.help ? 0 : 2);
  }

  const absModel = path.resolve(args.modelPath);
  const modelMod = await import(pathToFileURL(absModel).href);
  const spec = modelMod.default || modelMod;

  let viewOverride = null;
  if (args.viewPath) {
    const absView = path.resolve(args.viewPath);
    const viewMod = await import(pathToFileURL(absView).href);
    viewOverride = viewMod.default || viewMod;
  }

  const outDir = args.outDir ? path.resolve(args.outDir) : path.dirname(absModel);
  const cliCommand = `node ${process.argv[1]} ${args.modelPath}${args.viewPath ? ` --view ${args.viewPath}` : ''} --out ${outDir}`;

  const result = analyzeModel(spec, {
    maxStates: args.maxStates,
    chartMaxStates: args.chartMaxStates,
    viewOverride,
    cliCommand,
  });

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'report.md');
  fs.writeFileSync(reportPath, result.report, 'utf8');

  let chartPath = null;
  if (result.mermaid) {
    chartPath = path.join(outDir, 'chart.mmd');
    fs.writeFileSync(chartPath, result.mermaid, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        verdict: result.verdict,
        stats: result.stats,
        deadActions: result.deadActions,
        warnings: result.warnings,
        reportPath,
        chartPath,
      },
      null,
      2
    )
  );

  if (result.verdict !== 'PASSED') {
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runCli().catch((err) => {
    console.error(`[a8-statechart] 执行失败: ${err && err.stack ? err.stack : err}`);
    process.exit(2);
  });
}
