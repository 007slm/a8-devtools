import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMermaidSVG, type RenderOptions } from 'beautiful-mermaid';
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface MermaidBlockProps {
  code: string;
}

const FONT_STACK =
  "'Microsoft YaHei UI', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";

function readDomDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function buildRenderOptions(isDark: boolean): RenderOptions {
  return isDark
    ? {
        bg: '#0C0D10',
        fg: '#F4F4F5',
        surface: '#161920',
        border: '#3F3F46',
        line: '#94A3B8',
        accent: '#60A5FA',
        muted: '#A1A1AA',
        transparent: true,
        padding: 28,
        nodeSpacing: 32,
        layerSpacing: 46,
      }
    : {
        bg: '#FCFCFD',
        fg: '#0F172A',
        surface: '#FFFFFF',
        border: '#D4D4D8',
        line: '#64748B',
        accent: '#2563EB',
        muted: '#52525B',
        transparent: true,
        padding: 28,
        nodeSpacing: 32,
        layerSpacing: 46,
      };
}

function sanitizeAndNormalizeSvg(rawSvg: string): {
  svg: string;
  size: { width: number; height: number } | null;
} {
  // 移除外链 Google Fonts @import，避免离线桌面 WebView / CSP 触发网络请求或报错
  let svg = rawSvg
    .replace(/@import\s+url\(['"]https?:\/\/fonts\.googleapis\.com[^)]*\);\s*/gi, '')
    .replace(
      /text\s*\{\s*font-family:\s*[^;]+;\s*\}/,
      `text { font-family: ${FONT_STACK}; }`,
    );

  // 防御性清理：若意外出现 script 标签则拒绝渲染
  if (/<script\b/i.test(svg)) {
    throw new Error('SVG 包含不安全脚本标签');
  }

  const vbMatch = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const width = vbMatch ? parseFloat(vbMatch[1]) : 640;
  const height = vbMatch ? parseFloat(vbMatch[2]) : 320;
  return {
    svg,
    size:
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : null,
  };
}

function applyResponsiveSvgSize(host: HTMLDivElement | null, targetWidthPx: number | null) {
  if (!host) return;
  const svgEl = host.querySelector('svg');
  if (!svgEl) return;
  svgEl.removeAttribute('height');
  if (targetWidthPx !== null) {
    svgEl.style.width = `${targetWidthPx}px`;
    svgEl.style.maxWidth = 'none';
  } else {
    svgEl.style.width = '100%';
    svgEl.style.maxWidth = '100%';
  }
  svgEl.style.height = 'auto';
  svgEl.style.display = 'block';
  svgEl.style.margin = '0 auto';
}

function useDragToPan(ref: React.RefObject<HTMLDivElement | null>) {
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !ref.current) return;
      const el = ref.current;
      const canScroll = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
      if (!canScroll) return;
      dragStateRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };
      setDragging(true);
    },
    [ref],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const st = dragStateRef.current;
      if (!st.active || !ref.current) return;
      e.preventDefault();
      ref.current.scrollLeft = st.scrollLeft - (e.clientX - st.startX);
      ref.current.scrollTop = st.scrollTop - (e.clientY - st.startY);
    },
    [ref],
  );

  const stopDrag = useCallback(() => {
    if (dragStateRef.current.active) {
      dragStateRef.current.active = false;
      setDragging(false);
    }
  }, []);

  return {
    dragging,
    handlers: {
      onMouseDown,
      onMouseMove,
      onMouseUp: stopDrag,
      onMouseLeave: stopDrag,
    },
  };
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenViewportRef = useRef<HTMLDivElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDark, setIsDark] = useState<boolean>(readDomDark);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(880);
  const [zoomMode, setZoomMode] = useState<'auto' | 'fit' | 'custom'>('auto');
  const [customScale, setCustomScale] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullZoom, setFullZoom] = useState<number>(1);

  const inlineDrag = useDragToPan(viewportRef);
  const fullDrag = useDragToPan(fullscreenViewportRef);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(readDomDark());
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const updateWidth = () => {
      const w = vp.clientWidth;
      if (w > 120) setViewportWidth(Math.max(w - 32, 280));
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [showSource]);

  const { renderedSvg, naturalSize, renderError } = useMemo(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      return { renderedSvg: '', naturalSize: null, renderError: '空 Mermaid 图表' };
    }
    try {
      const rawSvg = renderMermaidSVG(trimmed, buildRenderOptions(isDark));
      const { svg, size } = sanitizeAndNormalizeSvg(rawSvg);
      return { renderedSvg: svg, naturalSize: size, renderError: null as string | null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || 'Mermaid 渲染失败');
      return { renderedSvg: '', naturalSize: null, renderError: msg };
    }
  }, [code, isDark]);

  const computeEffectiveScale = useCallback(() => {
    if (!naturalSize) return 1;
    const fitW = viewportWidth / naturalSize.width;
    const fitH = 540 / naturalSize.height;
    if (zoomMode === 'fit') return Math.max(0.3, Math.min(1, fitW, fitH));
    if (zoomMode === 'custom') return customScale;
    // 默认按容器宽度自适应（极宽横向图放宽下限至 0.55，保证一屏看全结构）
    return naturalSize.width <= viewportWidth ? 1 : Math.max(0.55, Math.min(1, fitW));
  }, [naturalSize, viewportWidth, zoomMode, customScale]);

  const effectiveScale = computeEffectiveScale();

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !renderedSvg || showSource || renderError) return;
    host.innerHTML = renderedSvg;
    const targetW = naturalSize
      ? Math.max(140, Math.round(naturalSize.width * effectiveScale))
      : null;
    applyResponsiveSvgSize(host, targetW);
  }, [renderedSvg, naturalSize, effectiveScale, showSource, renderError]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || !fullscreenContainerRef.current || !renderedSvg) return;
    const host = fullscreenContainerRef.current;
    host.innerHTML = renderedSvg;
    if (naturalSize) {
      const vpW = Math.max((fullscreenViewportRef.current?.clientWidth || 1200) - 48, 360);
      const baseScale = naturalSize.width <= vpW ? 1 : Math.max(0.65, vpW / naturalSize.width);
      const targetW = Math.max(160, Math.round(naturalSize.width * baseScale * fullZoom));
      applyResponsiveSvgSize(host, targetW);
    } else {
      applyResponsiveSvgSize(host, null);
    }
  }, [isFullscreen, renderedSvg, naturalSize, fullZoom]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const handleDownloadSvg = () => {
    if (!renderedSvg) return;
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const stepZoom = (delta: number) => {
    const base = zoomMode === 'custom' ? customScale : effectiveScale;
    const next = Math.min(2.2, Math.max(0.3, Number((base + delta).toFixed(2))));
    setZoomMode('custom');
    setCustomScale(next);
  };

  const pctLabel = `${Math.round(effectiveScale * 100)}%`;

  return (
    <>
      <div className="my-3.5 rounded-xl border border-zinc-200/90 dark:border-border/75 bg-white dark:bg-surface overflow-hidden">
        <div className="px-3.5 py-1.5 border-b border-zinc-200/75 dark:border-border/60 bg-zinc-50/70 dark:bg-surface-secondary/35 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
          <div className="flex items-center gap-2 font-mono text-muted">
            <span>架构图 / Mermaid · ELK</span>
            {!showSource && !renderError && naturalSize && (
              <span className="px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/75 dark:border-border/60 text-[10px]">
                {pctLabel}
              </span>
            )}
            {renderError && (
              <span className="text-amber-600 dark:text-amber-400 font-sans">
                渲染降级展示源码
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {!showSource && !renderError && (
              <>
                <button
                  type="button"
                  onClick={() => setZoomMode('auto')}
                  title="适应宽度"
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    zoomMode === 'auto'
                      ? 'bg-zinc-200/80 dark:bg-surface-secondary text-foreground font-medium'
                      : 'text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary'
                  }`}
                >
                  适宽
                </button>
                <button
                  type="button"
                  onClick={() => setZoomMode('fit')}
                  title="缩放到一屏全景"
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    zoomMode === 'fit'
                      ? 'bg-zinc-200/80 dark:bg-surface-secondary text-foreground font-medium'
                      : 'text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary'
                  }`}
                >
                  全景
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoomMode('custom');
                    setCustomScale(1);
                  }}
                  title="100% 原尺寸清晰查看"
                  className={`px-2 py-0.5 rounded-md font-mono transition-colors cursor-pointer ${
                    zoomMode === 'custom' && Math.abs(customScale - 1) < 0.02
                      ? 'bg-zinc-200/80 dark:bg-surface-secondary text-foreground font-medium'
                      : 'text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary'
                  }`}
                >
                  1:1
                </button>
                <button
                  type="button"
                  onClick={() => stepZoom(-0.15)}
                  title="缩小"
                  className="p-1 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => stepZoom(0.15)}
                  title="放大"
                  className="p-1 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFullZoom(1);
                    setIsFullscreen(true);
                  }}
                  title="全屏预览"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>全屏</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  title="导出矢量 SVG"
                  className="p-1 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                </button>
                <span className="h-3 w-[1px] bg-zinc-200 dark:bg-border/70 mx-0.5" />
              </>
            )}

            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              {showSource ? <Eye className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}
              <span>{showSource ? '图表' : '源码'}</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>
        </div>

        {showSource || renderError ? (
          <div className="bg-zinc-50/50 dark:bg-zinc-900/40">
            {renderError && !showSource && (
              <div className="px-3.5 py-2 border-b border-amber-500/20 bg-amber-500/8 text-[11px] text-amber-700 dark:text-amber-300 font-mono">
                {renderError}
              </div>
            )}
            <pre className="p-3.5 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
              {code}
            </pre>
          </div>
        ) : (
          <div
            ref={viewportRef}
            {...inlineDrag.handlers}
            className={`px-4 py-5 overflow-auto max-h-[600px] bg-[#FCFCFD] dark:bg-[#0C0D10] min-h-[120px] select-none ${
              inlineDrag.dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <div ref={containerRef} className="inline-block min-w-full" />
          </div>
        )}
      </div>

      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/75 backdrop-blur-xs flex items-center justify-center p-5"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            className="w-full max-w-[1420px] h-[92vh] rounded-2xl border border-zinc-200/90 dark:border-border bg-white dark:bg-surface flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-zinc-200/80 dark:border-border/70 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/75 dark:bg-surface-secondary/35 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground">架构图 / Mermaid · ELK 全屏预览</span>
                <span className="text-[10.5px] font-mono text-muted">（可鼠标拖拽平移）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFullZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(2))))}
                  title="缩小"
                  className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setFullZoom(1)}
                  className="px-2 py-1 rounded-lg font-mono text-[11px] text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
                >
                  {Math.round(fullZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setFullZoom((z) => Math.min(2.6, Number((z + 0.2).toFixed(2))))}
                  title="放大"
                  className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  title="导出 SVG"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出 SVG</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>退出全屏 (ESC)</span>
                </button>
              </div>
            </div>
            <div
              ref={fullscreenViewportRef}
              {...fullDrag.handlers}
              className={`flex-1 p-6 overflow-auto bg-[#FCFCFD] dark:bg-[#0C0D10] select-none ${
                fullDrag.dragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <div ref={fullscreenContainerRef} className="inline-block min-w-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
