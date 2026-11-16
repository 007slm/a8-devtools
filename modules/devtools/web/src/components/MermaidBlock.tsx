import { useCallback, useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import {
  Check,
  Code2,
  Copy,
  Eye,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface MermaidBlockProps {
  code: string;
}

function readDomDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

// 串行化 mermaid.initialize + render，防止同页多张图表并发初始化互相覆盖主题配置
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function enqueueMermaidRender<T>(fn: () => Promise<T>): Promise<T> {
  const next = mermaidRenderQueue.then(fn, fn);
  mermaidRenderQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function buildMermaidThemeConfig(isDark: boolean) {
  const fontFamily =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';

  const canvasBg = isDark ? '#0C0D10' : '#FCFCFD';

  const themeVariables = isDark
    ? {
        darkMode: true,
        background: 'transparent',
        fontFamily,
        fontSize: '12px',
        primaryColor: '#161920',
        primaryTextColor: '#F4F4F5',
        primaryBorderColor: '#303642',
        secondaryColor: '#1C2029',
        secondaryTextColor: '#E4E4E7',
        secondaryBorderColor: '#363D4B',
        tertiaryColor: '#111318',
        tertiaryTextColor: '#A1A1AA',
        tertiaryBorderColor: '#252A34',
        lineColor: '#64748B',
        textColor: '#E4E4E7',
        mainBkg: '#161920',
        nodeBkg: '#161920',
        nodeBorder: '#303642',
        clusterBkg: '#111318',
        clusterBorder: '#262B35',
        titleColor: '#F4F4F5',
        edgeLabelBackground: canvasBg,
        actorBkg: '#161920',
        actorBorder: '#303642',
        actorTextColor: '#F4F4F5',
        actorLineColor: '#334155',
        signalColor: '#94A3B8',
        signalTextColor: '#E2E8F0',
        labelBoxBkgColor: '#161920',
        labelBoxBorderColor: '#303642',
        labelTextColor: '#CBD5E1',
        loopTextColor: '#94A3B8',
        activationBkgColor: '#1E293B',
        activationBorderColor: '#475569',
        noteBkgColor: '#241F14',
        noteBorderColor: '#6B531B',
        noteTextColor: '#FDE68A',
      }
    : {
        darkMode: false,
        background: 'transparent',
        fontFamily,
        fontSize: '12px',
        primaryColor: '#FFFFFF',
        primaryTextColor: '#0F172A',
        primaryBorderColor: '#CBD5E1',
        secondaryColor: '#F8FAFC',
        secondaryTextColor: '#1E293B',
        secondaryBorderColor: '#E2E8F0',
        tertiaryColor: '#F8FAFC',
        tertiaryTextColor: '#475569',
        tertiaryBorderColor: '#CBD5E1',
        lineColor: '#94A3B8',
        textColor: '#0F172A',
        mainBkg: '#FFFFFF',
        nodeBkg: '#FFFFFF',
        nodeBorder: '#CBD5E1',
        clusterBkg: '#F6F8FA',
        clusterBorder: '#DFE5ED',
        titleColor: '#0F172A',
        edgeLabelBackground: canvasBg,
        actorBkg: '#FFFFFF',
        actorBorder: '#CBD5E1',
        actorTextColor: '#0F172A',
        actorLineColor: '#CBD5E1',
        signalColor: '#64748B',
        signalTextColor: '#1E293B',
        labelBoxBkgColor: '#F8FAFC',
        labelBoxBorderColor: '#E2E8F0',
        labelTextColor: '#334155',
        loopTextColor: '#475569',
        activationBkgColor: '#EFF6FF',
        activationBorderColor: '#93C5FD',
        noteBkgColor: '#FEFCE8',
        noteBorderColor: '#FDE047',
        noteTextColor: '#713F12',
      };

  const clusterBg = isDark ? 'rgba(20, 23, 30, 0.72)' : 'rgba(246, 248, 250, 0.85)';
  const clusterStroke = isDark ? '#282E3A' : '#DFE5ED';
  const clusterTitleColor = isDark ? '#94A3B8' : '#475569';
  const nodeFill = isDark ? '#161920' : '#FFFFFF';
  const nodeStroke = isDark ? '#323946' : '#CBD5E1';
  const edgeText = isDark ? '#CBD5E1' : '#475569';
  const arrowFill = isDark ? '#64748B' : '#94A3B8';

  const themeCSS = `
    .node rect, .node circle, .node ellipse, .node polygon {
      fill: ${nodeFill} !important;
      stroke: ${nodeStroke} !important;
      stroke-width: 1px !important;
      rx: 8px !important;
      ry: 8px !important;
    }
    .node .label, .nodeLabel, .node foreignObject div {
      font-family: ${fontFamily} !important;
      font-size: 11.5px !important;
      font-weight: 500 !important;
      line-height: 1.4 !important;
    }
    .cluster rect {
      fill: ${clusterBg} !important;
      stroke: ${clusterStroke} !important;
      stroke-width: 1px !important;
      stroke-dasharray: 4 3;
      rx: 12px !important;
      ry: 12px !important;
    }
    .cluster-label text, .cluster-label span, .cluster-label p {
      font-family: ${fontFamily} !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: ${clusterTitleColor} !important;
      fill: ${clusterTitleColor} !important;
      letter-spacing: 0.02em;
    }
    .edgePath path.path {
      stroke-width: 1.25px !important;
    }
    .arrowheadPath, marker path {
      fill: ${arrowFill} !important;
      stroke: ${arrowFill} !important;
    }
    .edgeLabel .labelBkg, .edgeLabel rect {
      background-color: ${canvasBg} !important;
      fill: ${canvasBg} !important;
    }
    .edgeLabel span, .edgeLabel p {
      font-family: ${fontFamily} !important;
      font-size: 10.5px !important;
      font-weight: 500 !important;
      color: ${edgeText} !important;
    }
    .actor {
      rx: 7px !important;
      ry: 7px !important;
      stroke-width: 1px !important;
    }
    .messageLine0, .messageLine1 {
      stroke-width: 1.25px !important;
    }
    .messageText {
      font-family: ${fontFamily} !important;
      font-size: 11.5px !important;
      font-weight: 500 !important;
    }
    .statediagram-state rect.basic {
      rx: 8px !important;
      ry: 8px !important;
      stroke-width: 1px !important;
    }
  `;

  return { fontFamily, themeVariables, themeCSS };
}

function extractNaturalSize(svgEl: SVGSVGElement): { width: number; height: number } {
  const vb = svgEl.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }
  const attrW = parseFloat(svgEl.getAttribute('width') || '0');
  const attrH = parseFloat(svgEl.getAttribute('height') || '0');
  if (attrW > 0 && attrH > 0) {
    return { width: attrW, height: attrH };
  }
  const rect = svgEl.getBoundingClientRect();
  return {
    width: Math.max(rect.width || 640, 140),
    height: Math.max(rect.height || 320, 80),
  };
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const rawId = useId();
  const baseId = `mmd_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const [isDark, setIsDark] = useState<boolean>(readDomDark);
  const [showSource, setShowSource] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState<string>('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(880);
  const [zoomMode, setZoomMode] = useState<'auto' | 'fit' | 'custom'>('auto');
  const [customScale, setCustomScale] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const renderSeqRef = useRef(0);

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
      if (w > 120) setViewportWidth(Math.max(w - 40, 280));
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [showSource]);

  const computeEffectiveScale = useCallback(() => {
    if (!naturalSize) return 1;
    const fitW = viewportWidth / naturalSize.width;
    const fitH = 560 / naturalSize.height;
    if (zoomMode === 'fit') return Math.max(0.35, Math.min(1, fitW, fitH));
    if (zoomMode === 'custom') return customScale;
    // 默认优先适口纳下全图，下限钳位到 0.72 保持清晰可读
    return naturalSize.width <= viewportWidth ? 1 : Math.max(0.72, Math.min(1, fitW));
  }, [naturalSize, viewportWidth, zoomMode, customScale]);

  const effectiveScale = computeEffectiveScale();

  useEffect(() => {
    if (showSource) return;

    let cancelled = false;
    renderSeqRef.current += 1;
    const seq = renderSeqRef.current;
    const svgId = `${baseId}_${seq}`;

    enqueueMermaidRender(async () => {
      if (cancelled) return;
      const { fontFamily, themeVariables, themeCSS } = buildMermaidThemeConfig(isDark);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily,
        themeVariables,
        themeCSS,
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          nodeSpacing: 26,
          rankSpacing: 38,
          diagramPadding: 14,
          padding: 10,
          curve: 'basis',
          wrappingWidth: 165,
        },
        sequence: {
          useMaxWidth: false,
          actorMargin: 44,
          boxMargin: 10,
          messageMargin: 32,
          mirrorActors: false,
        },
        state: {
          useMaxWidth: false,
        },
      });
      return mermaid.render(svgId, code.trim());
    })
      .then((res) => {
        if (cancelled || !res) return;
        setRenderError(null);
        setRenderedSvg(res.svg);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err || 'Mermaid 渲染失败');
        setRenderError(msg);
      });

    return () => {
      cancelled = true;
    };
  }, [baseId, code, isDark, showSource]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !renderedSvg || showSource || renderError) return;
    el.innerHTML = renderedSvg;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    const size = extractNaturalSize(svgEl);
    setNaturalSize((prev) =>
      prev && prev.width === size.width && prev.height === size.height ? prev : size
    );
  }, [renderedSvg, showSource, renderError]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !naturalSize) return;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    const targetW = Math.max(140, Math.round(naturalSize.width * effectiveScale));
    svgEl.removeAttribute('height');
    svgEl.style.width = `${targetW}px`;
    svgEl.style.height = 'auto';
    svgEl.style.maxWidth = 'none';
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
  }, [naturalSize, effectiveScale, renderedSvg]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || !fullscreenRef.current || !renderedSvg) return;
    const host = fullscreenRef.current;
    host.innerHTML = renderedSvg;
    const svgEl = host.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '100%';
      svgEl.style.maxHeight = 'calc(100vh - 130px)';
      svgEl.style.width = 'auto';
      svgEl.style.height = 'auto';
      svgEl.style.display = 'block';
      svgEl.style.margin = '0 auto';
    }
  }, [isFullscreen, renderedSvg]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const stepZoom = (delta: number) => {
    const base = zoomMode === 'custom' ? customScale : effectiveScale;
    const next = Math.min(2.0, Math.max(0.35, Number((base + delta).toFixed(2))));
    setZoomMode('custom');
    setCustomScale(next);
  };

  const pctLabel = `${Math.round(effectiveScale * 100)}%`;

  return (
    <>
      <div className="my-3.5 rounded-xl border border-zinc-200/90 dark:border-border/75 bg-white dark:bg-surface overflow-hidden">
        <div className="px-3.5 py-1.5 border-b border-zinc-200/75 dark:border-border/60 bg-zinc-50/70 dark:bg-surface-secondary/35 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
          <div className="flex items-center gap-2 font-mono text-muted">
            <span>架构图 / Mermaid</span>
            {!showSource && !renderError && naturalSize && (
              <span className="px-1.5 py-[1px] rounded bg-white dark:bg-surface border border-zinc-200/75 dark:border-border/60 text-[10px]">
                {pctLabel}
              </span>
            )}
            {renderError && (
              <span className="text-amber-600 dark:text-amber-400 font-sans">
                语法降级展示源码
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {!showSource && !renderError && (
              <>
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
                    (zoomMode === 'custom' && Math.abs(customScale - 1) < 0.02) ||
                    (zoomMode === 'auto' && Math.abs(effectiveScale - 1) < 0.02)
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
                  onClick={() => setIsFullscreen(true)}
                  title="全屏预览"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-muted hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>全屏</span>
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
          <pre className="p-3.5 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-800 dark:text-zinc-200 select-text bg-zinc-50/50 dark:bg-zinc-900/40">
            {code}
          </pre>
        ) : (
          <div
            ref={viewportRef}
            className="px-4 py-5 overflow-auto max-h-[640px] bg-[#FCFCFD] dark:bg-[#0C0D10] min-h-[140px]"
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
            className="w-full max-w-[1380px] max-h-[92vh] rounded-2xl border border-zinc-200/90 dark:border-border bg-white dark:bg-surface flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-zinc-200/80 dark:border-border/70 flex items-center justify-between gap-2 bg-zinc-50/75 dark:bg-surface-secondary/35">
              <span className="text-[12px] font-semibold text-foreground">架构图 / Mermaid 全屏预览</span>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-surface-secondary cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>退出全屏 (ESC)</span>
              </button>
            </div>
            <div className="p-6 overflow-auto bg-[#FCFCFD] dark:bg-[#0C0D10] flex items-center justify-center min-h-[420px]">
              <div ref={fullscreenRef} className="w-full flex justify-center" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
