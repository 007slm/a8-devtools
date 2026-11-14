# 三端同源 Dashboard 架构、白屏根因排查与防踩坑指南

> **文档状态**：已修复并实测通过 | **适用模块**：[`modules/devtools/`](file:///e:/a8-devtools/modules/devtools/), [`plugins/agent-mind/sidecars/panel/`](file:///e:/a8-devtools/plugins/agent-mind/sidecars/panel/)
> **建档缘由**：沉淀 `a8-devtools` 桌面端、Rust `18765` 独立 Web 看板、Antigravity `agent-mind/panel` Sidecar 三端同源 Dashboard 从搭建至今经历的全部 4 类白屏故障根因与工程防线，避免后续演化再次踩坑。

---

## 1. 三端同源复用架构总览

为杜绝桌面端、独立浏览器看板与 Antigravity 插件侧边栏出现“两套 UI、两套逻辑、各自修 Bug”的双轨撕裂，全系统采用**单仓单前端产物 (`modules/devtools/ui`) + 运行时适配器**的三端同源模型：

```mermaid
flowchart TB
    WebSrc["前端单一源码<br/>modules/devtools/web (React + Tailwind v4 + HeroUI v3)<br/>vite.config.ts: base='./', IIFE 单包 assets/index.js"]
    DistUI["唯一静态产物<br/>modules/devtools/ui/{index.html, preload.js, assets/index.js}"]

    WebSrc -->|"npm run build (tsc -b && vite build)"| DistUI

    DistUI -->|"Tauri 编译打包内嵌"| AppDesktop["入口1: a8-devtools.exe 主窗<br/>callTauri() -> window.__TAURI__.core.invoke"]
    DistUI -->|"build.rs 生成 sidecar_ui_assets.rs"| AppRust["入口2: a8-devtools.exe sidecar-board<br/>Rust TcpListener 127.0.0.1:18765"]
    DistUI -->|"运行时直读/仓库地图定位托管"| AppPlugin["入口3: plugins/agent-mind/sidecars/panel/main.mjs<br/>Antigravity Aux Pane (动态端口 + 网关透传 / :18766)"]

    AppDesktop -->|"!isStandaloneSidecar"| FullUI["完整工作台 + Agent Mind Tab"]
    AppRust -->|"isStandaloneSidecar=true"| MindOnly1["独立 Agent Mind Dashboard<br/>fetch('/api/agent-mind/*')"]
    AppPlugin -->|"isStandaloneSidecar=true + preload.js"| MindOnly2["Antigravity 侧边栏 Dashboard<br/>window.sidecar.fetch('/api/agent-mind/*')"]
```

---

## 2. 历次白屏根因全景复盘（含历史 3 坑 + 本次插件看板坑）

### 坑一：Antigravity Aux Pane 自定义协议 / 沙箱 Origin 导致静态资源返回 403（2026-11-14 插件看板白屏直接根因）

1. **物理现场**：
   - Antigravity Electron 宿主通过 `--standard-schemes=plugin,agy-favicon --cors-schemes=plugin` 加载插件 UI，或将 Aux Pane 挂载在沙箱 iframe / WebView（携带 `Origin: null`、`Origin: plugin://...`、`Origin: vscode-webview://...` 或 `Origin: antigravity-sidecar://...`）下，再透传至 `sidecars/panel/main.mjs` 的动态本地回环端口（如 `127.0.0.1:52875`）。
   - Vite 默认产出的 HTML 包含 `<script type="module" crossorigin src="./assets/index-xxx.js">` 与 `<link rel="stylesheet" crossorigin href="./assets/index-xxx.css">`：
     - `<script type="module" crossorigin>` 与 `<link rel="stylesheet" crossorigin>` 会强制浏览器发送 CORS 请求（附带 `Origin` 请求头）；
     - 而原 `main.mjs`（第 418–423 行）在路由静态资源**之前**检查了 `isAllowedOrigin(origin)`，且白名单仅允许 `http:`/`https:`/`tauri:` 下的回环 hostname；
     - 实测携带 `Origin: null` 或自定义协议 Origin 请求 `http://127.0.0.1:52875/`、`./assets/index-*.js`、`./assets/index-*.css` 全数返回 **HTTP 403 JSON**（`安全拦截：禁止非本机 Origin 调用`），主脚本被浏览器拒载，画面 100% 白屏。
     - 此外，`type="module"` 与构建后每次变动的 Hash 文件名（`index-<hash>.js`）在自定义协议 Sidecar 与长时间驻留不重启的 Node 进程之间极易引发缓存失配 404（参照同机 `antigravity-pulse` 的工程实践：`Custom-scheme sidecars load a classic, self-contained script`）。
2. **根治防线**：
   - **经典单包 IIFE 构建（[`vite.config.ts`](file:///e:/a8-devtools/modules/devtools/web/vite.config.ts)）**：
     - 配置 `rollupOptions.output` 为 `format: 'iife'`、`inlineDynamicImports: true`、`entryFileNames: 'assets/index.js'`、`assetFileNames: 'assets/[name].[ext]'`，由 Vite 将 Tailwind v4 CSS 直接内联进 `assets/index.js` 运行时 `<style>` 注入，消除分离 CSS 链接与 Hash 文件名轮转 404；
     - 通过 `classicSidecarHtmlPlugin()`（`enforce: 'post'`）移除 `<script>` 上的 `type="module"` 与 `crossorigin`，改输出经典标签 `<script defer src="./assets/index.js"></script>`，并剔除样式链接 `crossorigin`。
   - **静态资源免 Origin 拦截（[`main.mjs`](file:///e:/a8-devtools/plugins/agent-mind/sidecars/panel/main.mjs) & [`sidecar.rs`](file:///e:/a8-devtools/modules/devtools/src/sidecar.rs)）**：
     - 将非 `/api/` 的 `GET` / `HEAD` 静态资源与 `OPTIONS` 预检置于 Origin 拦截**之前**，固定下发 `Access-Control-Allow-Origin: *` 与 `Cache-Control: no-store`；
     - 仅针对 `/api/` 控制面校验 `Origin`：放行无 `Origin`、`Origin: null`、本地自定义协议（`tauri:`、`plugin:`、`vscode-webview:`、`antigravity:`、`antigravity-sidecar:`、`file:`）及 `http:`/`https:` 本机回环（`127.0.0.1`、`localhost`、`tauri.localhost`、`::1`、`[::1]`），继续以 `403` 严格拦截外部网页 Origin（如 `https://evil.example.com`）。

### 坑二：缺失 `sidecar_sdk/preload.js` 桥接、CORS 头缺 `X-Sidecar-Token` 与旧 HTML 双轨残留

1. **物理现场**：
   - Antigravity Sidecar 宿主通过查询参数 `?token=<ANTIGRAVITY_SIDECAR_UI_TOKEN>&conversationId=<id>` 向页面注入访问令牌与上下文，依赖前端首先加载 `/preload.js` 初始化 `window.sidecar.fetch`（自动注入 `X-Sidecar-Token` 并监听宿主 `theme-change` / `workspace-change` 消息）。
   - 同时，`plugins/agent-mind/sidecars/panel/` 下曾残留早期的手写单页 `index.html`（引用外链 `https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js`），与 `modules/devtools/ui` 构成双轨隐患。
2. **根治防线**：
   - [`modules/devtools/web/index.html`](file:///e:/a8-devtools/modules/devtools/web/index.html) 在主脚本前加载 `<script src="./preload.js"></script>`，并由 [`public/preload.js`](file:///e:/a8-devtools/modules/devtools/web/public/preload.js) 提供非 Antigravity 宿主环境下的静默兜底（避免 404）；
   - [`main.mjs`](file:///e:/a8-devtools/plugins/agent-mind/sidecars/panel/main.mjs) 中的 `resolvePreloadJs()` 优先读取宿主 `sidecar_sdk/preload.js` 并托管为 `/preload.js`；
   - [`App.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/App.tsx) 的 `callTauri` 控制面请求优先通过 `window.sidecar.fetch` 发送，且服务端 `Access-Control-Allow-Headers` 放行 `Content-Type, X-Sidecar-Token`；
   - 彻底删除遗留 `plugins/agent-mind/sidecars/panel/index.html` 双轨死文件，当构建产物缺失时直接返回 `503` 提示，遵循单仓单一实现路径红线。

### 坑三：Vite 缺失相对基础路径 `base: './'`（2026-11-12/13 历史踩坑）

1. **物理现场**：Vite 默认 `base: '/'` 会生成 `<script src="/assets/...">`，在部分自定义协议或子路径挂载的 WebView2 中无法正确命中，脚本 404 导致白屏。
2. **防线**：[`vite.config.ts`](file:///e:/a8-devtools/modules/devtools/web/vite.config.ts) 永久固定 `base: './'`。

### 坑四：HeroUI v3 复合组件破坏渲染 + 缺失 ErrorBoundary + 独立模式越界轮询（2026-11-12/13 历史踩坑）

1. **物理现场**：初期在 `@heroui/react` v3 中沿用 v2 扁平属性（如 `Table` 上的 `removeWrapper`、`TableBody` 的 `emptyContent` 或未严格嵌套 `TableContent`/`TableHeader`），触发 `react-aria-components` 运行时抛出异常；当时 `main.tsx` 无顶层错误边界，React 直接卸载整棵组件树造成无错误提示的纯白屏。此外，若在非 Tauri Web 环境下继续运行桌面端 `get_workspaces` / `get_net_speed` 轮询也会污染控制台和状态。
2. **防线**：
   - [`main.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/main.tsx) 永久包裹 `RootErrorBoundary`（任何 React 渲染异常立即展现可读错误栈与「重新加载应用」按钮，绝不静默白屏）；
   - [`index.html`](file:///e:/a8-devtools/modules/devtools/web/index.html) 挂载 `window.onerror` 与 `onunhandledrejection` 兜底日志；
   - [`App.tsx`](file:///e:/a8-devtools/modules/devtools/web/src/App.tsx) 通过 `isStandaloneSidecar`（无 `__TAURI__` 注入或 URL `?mode=sidecar`）跳过桌面端轮询并直接渲染纯享版 `<AgentMindView isStandalone />`。

---

## 3. 长效交付验证清单 (Sidecar / UI 修改必查)

每次改动 `modules/devtools/web/`、`sidecar.rs` 或 `sidecars/panel/main.mjs` 后，交付前必须完成以下校验：

1. **产物校验**：在 `modules/devtools/web` 执行 `npm run build`，检查生成的 `../ui/index.html` 中**不含** `type="module"` 与 `crossorigin`，且包含 `<script src="./preload.js"></script>` 与 `<script defer src="./assets/index.js"></script>`。
2. **Origin 与静态资源校验**：向运行中的 Sidecar 端口分别以 `无 Origin`、`Origin: null`、`Origin: plugin://agent-mind`、`Origin: vscode-webview://123` 请求 `/`、`/preload.js`、`/assets/index.js`、`/api/agent-mind/overview`，均须返回 `200 OK`；以 `Origin: https://evil.example.com` 请求 `/api/agent-mind/overview` 须返回 `403`。
3. **无头 DOM 渲染断言**：使用本机 Edge `--headless --virtual-time-budget=4000 --dump-dom` 请求 Sidecar URL，断言渲染后 DOM 包含 `Agent Mind Dashboard` 与 `<style>` 注入样式且无 `RootErrorBoundary` 异常界面。
4. **Rust 与 Sidecar 进程重启**：若 `main.mjs` 已更新，必须重启仍在运行旧代码的插件 Sidecar 进程（`sidecar.json` `restart_policy: "always"` 将由 `language_server` 自动拉起，可查看 `%USERPROFILE%\.gemini\antigravity\sidecar_data\agent-mind\panel\logs\sidecar.log` 确认新端口）；若 `ui/` 或 `sidecar.rs` 已更新，必须重编 `cargo test --workspace` 与 `cargo build --release -p devtools`。
