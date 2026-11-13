import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([PieChart, BarChart, TooltipComponent, GridComponent, SVGRenderer]);

interface EChartBoxProps {
  option: EChartsCoreOption;
  className?: string;
}

export function EChartBox({ option, className = '' }: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const instance = echarts.init(el, undefined, { renderer: 'svg' });
    chartRef.current = instance;

    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} className={className} />;
}
