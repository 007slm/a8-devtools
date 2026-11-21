# ADR：Markdown 架构图渲染引擎切换至 beautiful-mermaid (ELK)

- **日期**：2026-11-20
- **状态**：已落地（当时有效）
- **域**：dashboard-and-workflows.md
- **取代**：无

---

## 1. 问题与目标

- **要解决的问题**：原 `MermaidBlock.tsx` 依赖传统 `mermaid@^12.3.0`，默认采用 Dagre 布局导致连线交叉拥挤，且依赖 `<foreignObject>` HTML 标签在桌面 WebView2 / Sidecar 缩放场景下易产生字体不一致与边框裁剪；同时携带大量冗余图元依赖，推高单包产物 `index.js` 至 `7,455.35 kB`。
- **设计目标**：选用纯矢量、折线自动排版清晰、支持中文宽度精确测量且适配离线 IIFE 打包的轻量 Mermaid 渲染引擎，同时增强图框拖拽平移与矢量导出交互。

## 2. 核心设计与结论

1. **单一渲染引擎替换（`mermaid` → `beautiful-mermaid@^1.1.3`）**：
   - 在 `modules/devtools/web/package.json` 卸载 `mermaid`（移除 116 个关联包）并接入 `beautiful-mermaid`（内置 `elkjs` 同步排版、全角字符 width=2 测量、原生 `<text>`/`<tspan>` 纯 SVG 渲染），消除全局 `mermaid.initialize` 并发竞争；
   - `MermaidBlock.tsx` 保持外部组件签名 `<MermaidBlock code={...} />` 不变，内部改用 `useMemo` 同步产出 SVG 并按 `.dark` 状态切换浅/深素净色板。
2. **离线 WebView 与安全清洗边界（`sanitizeAndNormalizeSvg`）**：
   - 正则剥离 `beautiful-mermaid` 默认注入的 `@import url('https://fonts.googleapis.com/...')`，改写为本机系统字体栈（`'Microsoft YaHei UI', 'PingFang SC'`），避免离线客户端与沙箱 WebView 发起外部字体请求；
   - 防御性校验 `<script` 标签存在性，出现非法标签或语法错误时降级展示错误提示与原始源码。
3. **视图交互增强**：新增鼠标按住拖拽平移（内联与全屏预览共用 `useDragToPan`）、默认 `适宽 / 全景 / 1:1 / 缩放` 及一键导出 `diagram.svg`。

## 3. 当时验证范围

- **真实语料全覆盖测试**：针对 `a8-devtools` 与 `a8-turbo` 全部现有 41 处 `mermaid` 代码块（含 `flowchart`、`graph`、`sequenceDiagram`、`stateDiagram-v2`、`classDiagram`），`renderMermaidSVG` 41/41 全部渲染成功；
- **构建与门禁**：`npm --prefix modules/devtools/web run build`（`tsc -b && vite build`）零错误完成，`modules/devtools/ui/assets/index.js` 体积由 `7,455.35 kB` 降至 `3,672.82 kB`；`cargo check --workspace` 与 `py -3 plugins/a8-agent-mind/scripts/run_repo_lints.py .` 全绿通过。

## 4. 对常青文档的影响

- 本决策不改变三端构建形态与后端/Sidecar 控制面接口契约，可在 [dashboard-and-workflows.md](../evergreen/dashboard-and-workflows.md) 文首记录索引挂载渐进披露回链即可。
