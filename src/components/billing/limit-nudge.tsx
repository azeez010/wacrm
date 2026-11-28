'use client';

import { useTranslations } from 'next-intl';

import { useUsageMeter } from '@/hooks/use-usage-meters';
import { nudgeState, notifyPlanLimit } from '@/lib/billing/plan-limit';
import type { LimitKey } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

/** "8 of 10 used · Upgrade" beside a create button once a plan limit is near (amber) or reached (red). */
export function LimitNudge({ limitKey, className }: { limitKey: LimitKey; className?: string }) {
  const t = useTranslations('Settings.billing');
  const meter = useUsageMeter(limitKey);
  const state = meter ? nudgeState(meter.used, meter.limit) : null;
  if (!meter || !state || meter.limit === null) return null;
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs', state === 'at' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400', className)}>
      <span>{t('usedOf', { used: meter.used.toLocaleString(), limit: meter.limit.toLocaleString() })}</span>
      <button type="button" className="text-primary font-medium hover:underline" onClick={() => notifyPlanLimit({ limitKey, limit: meter.limit })}>
        {t('upgrade')}
      </button>
    </span>
  );
}
