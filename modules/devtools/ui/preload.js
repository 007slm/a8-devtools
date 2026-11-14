// 非 Antigravity Sidecar 宿主环境下的轻量兜底脚本（避免 ./preload.js 404）。
// 若当前运行在 Antigravity Aux Pane 中，该路径会由 sidecar 服务优先替换为官方 sidecar_sdk/preload.js。
(function () {
  if (typeof window !== 'undefined' && !window.sidecar) {
    window.__a8PreloadFallback = true;
  }
})();
