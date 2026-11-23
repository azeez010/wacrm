'use client';

// ============================================================
// BillingPanel — Settings → Profile → Billing & plan
//
// Current plan + status, usage against the plan's limits, the plan
// catalogue, and payment history. Data comes from GET
// /api/account/billing. Plan prices/limits are DB-driven (plans
// table); only labels are translated here.
// ============================================================

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { FeatureKey, LimitKey, PlanRow } from '@/lib/billing/plans';
import { FEATURE_DEFS } from '@/lib/billing/plans';
import { SettingsPanelHead } from './settings-panel-head';
import { UpgradeDialog } from '@/components/billing/upgrade-dialog';
import { useMoney } from '@/hooks/use-money';

interface Billing {
  can_view_history: boolean;
  subscription: {
    plan_id: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled';
    billing_interval: string | null;
    current_period_end: string | null;
    provider: string | null;
  };
  effective_plan_name: string;
  downgraded: boolean;
  features: Partial<Record<FeatureKey, boolean>>;
  usage: { key: LimitKey; used: number; limit: number | null; held?: number }[];
  plans: PlanRow[];
  history: {
    id: string;
    plan_id: string | null;
    amount: number | string;
    currency: string;
    status: 'pending' | 'succeeded' | 'failed' | 'refunded';
    description: string | null;
    created_at: string;
  }[];
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-primary-soft text-primary',
  trialing: 'bg-primary-soft text-primary',
  past_due: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  canceled: 'bg-muted text-muted-foreground',
};
const PAY_STYLE: Record<string, string> = {
  succeeded: 'bg-primary-soft text-primary',
  pending: 'bg-muted text-muted-foreground',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  refunded: 'bg-muted text-muted-foreground',
};

export function BillingPanel() {
  const t = useTranslations('Settings.billing');
  const locale = useLocale();
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [switchTo, setSwitchTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/billing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Billing) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Always the amount ("NGN 0"), never the word "Free": the plan name already says it.
  const money = useMoney();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {error && <p className="text-muted-foreground text-sm">{t('loadError')}</p>}
      {!data && !error && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}

      {data && (
        <>
          <CurrentPlan data={data} t={t} money={money} date={date} />
          <Usage data={data} t={t} />
          <Plans data={data} t={t} money={money} onPick={setSwitchTo} />
          <History data={data} t={t} money={money} date={date} />
          <UpgradeDialog
            open={switchTo !== null}
            onOpenChange={(o) => !o && setSwitchTo(null)}
            initialPlanId={switchTo ?? undefined}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        </>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<'Settings.billing'>>;
type Money = (a: number | string, c: string) => string;

function CurrentPlan({ data, t, money, date }: { data: Billing; t: T; money: Money; date: (i: string) => string }) {
  const plan = data.plans.find((p) => p.id === data.subscription.plan_id);
  const status = data.subscription.status;
  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('currentPlan')}</CardDescription>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-2xl">{plan?.name ?? data.effective_plan_name}</CardTitle>
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>
            {t(`status.${status}`)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan && (
          <p className="text-sm">
            <span className="text-foreground text-lg font-semibold">{money(plan.price_monthly, plan.currency)}</span>
            {plan.price_monthly > 0 && <span className="text-muted-foreground"> {t('perMonth')}</span>}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          {data.subscription.current_period_end
            ? t('renews', { date: date(data.subscription.current_period_end) })
            : t('noRenewal')}
        </p>
        {data.downgraded && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            {t('downgradedNotice')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Usage({ data, t }: { data: Billing; t: T }) {
  const features = Object.keys(FEATURE_DEFS) as FeatureKey[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('usageTitle')}</CardTitle>
        <CardDescription>{t('usageDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {data.usage.map((u) => {
            const pct = u.limit === null ? 0 : u.limit === 0 ? 100 : Math.min(100, Math.round((u.used / u.limit) * 100));
            const atLimit = u.limit !== null && u.used >= u.limit;
            const near = !atLimit && u.limit !== null && pct >= 80;
            return (
              <li key={u.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-foreground">{t(`limits.${u.key}`)}</span>
                  <span className={cn('text-muted-foreground text-xs', (atLimit || near) && 'font-medium text-amber-600 dark:text-amber-400')}>
                    {u.limit === null
                      ? t('usedUnlimited', { used: u.used.toLocaleString() })
                      : t('usedOf', { used: u.used.toLocaleString(), limit: u.limit.toLocaleString() })}
                  </span>
                </div>
                <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn('h-full rounded-full', atLimit ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-primary')}
                    style={{ width: u.limit === null ? '0%' : `${pct}%` }}
                  />
                </div>
                {(atLimit || near) && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {atLimit ? t('atLimit') : t('nearLimit')}
                  </p>
                )}
                {u.held ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('heldLeads', { count: u.held })}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="border-t pt-4">
          <p className="text-foreground mb-3 text-sm font-medium">{t('featuresTitle')}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {features.map((f) => {
              const on = data.features[f] === true;
              return (
                <li key={f} className={cn('flex items-start gap-2 text-sm', !on && 'text-muted-foreground/60')}>
                  {on ? <Check className="text-primary mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
                  <span>{t(`features.${f}`)}</span>
                  <span className="sr-only">{on ? t('included') : t('notIncluded')}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Plans({ data, t, money, onPick }: { data: Billing; t: T; money: Money; onPick: (id: string) => void }) {
  const current = data.subscription.plan_id;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plansTitle')}</CardTitle>
        <CardDescription>{t('plansDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.plans.map((p) => {
            const isCurrent = p.id === current;
            return (
              <div
                key={p.id}
                className={cn('flex flex-col rounded-xl border p-4', isCurrent && 'border-primary ring-primary ring-1')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.is_featured && !isCurrent && (
                    <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                      {t('mostPopular')}
                    </span>
                  )}
                </div>
                <p className="mt-2">
                  <span className="text-xl font-bold">{money(p.price_monthly, p.currency)}</span>
                  {p.price_monthly > 0 && <span className="text-muted-foreground text-xs"> {t('perMonth')}</span>}
                </p>
                {p.price_annual > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t('billedYearly', { price: money(p.price_annual, p.currency) })}
                  </p>
                )}
                <div className="mt-4">
                  {isCurrent ? (
                    <span className="text-primary text-xs font-medium">{t('yourPlan')}</span>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => onPick(p.id)}>
                      {t('switchTo', { plan: p.name })}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">{t('upgradeSoon')}</p>
      </CardContent>
    </Card>
  );
}

function History({ data, t, money, date }: { data: Billing; t: T; money: Money; date: (i: string) => string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('historyTitle')}</CardTitle>
        <CardDescription>{t('historyDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!data.can_view_history ? (
          <p className="text-muted-foreground text-sm">{t('historyAdminOnly')}</p>
        ) : data.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('historyEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t('colDate')}</th>
                  <th className="py-2 pr-4 font-medium">{t('colDescription')}</th>
                  <th className="py-2 pr-4 font-medium">{t('colAmount')}</th>
                  <th className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{date(h.created_at)}</td>
                    <td className="py-2.5 pr-4">
                      {h.description ?? t('subscription', { plan: data.plans.find((p) => p.id === h.plan_id)?.name ?? h.plan_id ?? '' })}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{money(h.amount, h.currency)}</td>
                    <td className="py-2.5">
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', PAY_STYLE[h.status])}>
                        {t(`payStatus.${h.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
