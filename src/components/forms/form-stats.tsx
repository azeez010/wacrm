'use client';

// At-a-glance numbers for one form in the list: a 14-day sparkline, leads and
// conversion on the row, and the full breakdown (views, unique visitors, starts,
// last lead) in a tooltip so the row itself stays one tidy line.

import { useLocale, useTranslations } from 'next-intl';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { compactNumber, timeAgo, type FormStats } from '@/lib/forms/stats';

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 64;
  const h = 20;
  const max = Math.max(...values, 1);
  const flat = values.every((v) => v === 0);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn(flat ? 'text-muted-foreground/40' : 'text-primary', className)}>
      {flat ? (
        <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <>
          <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="currentColor" opacity="0.12" />
          <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function FormStatsCell({ stats }: { stats: FormStats | null }) {
  const t = useTranslations('Forms.list');
  const locale = useLocale();

  if (!stats) {
    return <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{t('noStatsYet')}</span>;
  }

  const rows: [string, string][] = [
    [t('statViews'), compactNumber(stats.views, locale)],
    [t('statVisitors'), compactNumber(stats.visitors, locale)],
    [t('statStarted'), compactNumber(stats.starts, locale)],
    [t('statLeads'), compactNumber(stats.leads, locale)],
    [t('statConversion'), stats.conversion === null ? '-' : `${stats.conversion}%`],
    [t('statLastLead'), stats.last_lead_at ? timeAgo(stats.last_lead_at, locale) : t('statNever')],
  ];

  return (
    <Tooltip>
      <TooltipTrigger
        render={<div tabIndex={0} role="group" aria-label={t('statsAria')} />}
        className="hidden shrink-0 cursor-default items-center gap-3 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex"
      >
        <Sparkline values={stats.spark} />
        <span className="w-14 text-right leading-tight">
          <span className="block text-sm font-semibold tabular-nums text-foreground">{compactNumber(stats.leads, locale)}</span>
          <span className="block text-[11px] text-muted-foreground">{stats.conversion === null ? t('leadsLabel') : `${stats.conversion}%`}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="block max-w-none px-3 py-2">
        <p className="mb-1 font-medium">{t('statsTitle', { days: stats.window_days })}</p>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="opacity-70">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}
