import type { ReactNode } from 'react';

export interface PortalHeroMetric {
  label: string;
  value: string | number;
  tone?: 'default' | 'emerald' | 'amber' | 'rose' | 'blue';
  hint?: string;
}

interface PortalHeroProps {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  badge?: ReactNode;
  metrics?: PortalHeroMetric[];
  actions?: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<PortalHeroMetric['tone']>, string> = {
  default: 'text-foreground',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
  blue: 'text-blue-600 dark:text-blue-400',
};

/**
 * 统一门户级素净 Hero 概览卡（对齐「虚拟镜像映射」的纯白/细线秩序感，无重彩渐变噪音）
 */
export function PortalHero({
  icon,
  eyebrow,
  title,
  description,
  badge,
  metrics = [],
  actions,
  className = '',
}: PortalHeroProps) {
  return (
    <section
      className={`rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-xl bg-zinc-100/90 dark:bg-surface-secondary border border-zinc-200/80 dark:border-border/70 flex items-center justify-center text-foreground shrink-0 mt-0.5">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted">
              {eyebrow}
            </span>
            {badge}
          </div>
          <h1 className="text-[14px] font-semibold tracking-tight text-foreground mt-0.5 truncate">
            {title}
          </h1>
          <p className="text-[11px] text-muted mt-0.5 leading-snug line-clamp-2">
            {description}
          </p>
        </div>
      </div>

      {(metrics.length > 0 || actions) && (
        <div className="flex flex-wrap items-center gap-3 shrink-0 lg:pl-4 lg:border-l lg:border-zinc-200/75 dark:lg:border-border/60">
          {metrics.length > 0 && (
            <div className="flex items-center divide-x divide-zinc-200/80 dark:divide-border/60">
              {metrics.map((m, idx) => (
                <div
                  key={`${m.label}-${idx}`}
                  className={idx === 0 ? 'pr-3.5' : 'px-3.5 last:pr-0'}
                  title={m.hint}
                >
                  <span className="block text-[9.5px] text-muted whitespace-nowrap">
                    {m.label}
                  </span>
                  <span
                    className={`block text-[13px] font-mono font-semibold tabular-nums mt-0.5 whitespace-nowrap ${
                      TONE_CLASS[m.tone || 'default']
                    }`}
                  >
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </div>
      )}
    </section>
  );
}
