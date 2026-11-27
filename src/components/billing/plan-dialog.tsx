'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';

import { TransferDetails, type TransferInstructions } from '@/components/billing/payment-step';
import { CurrencyPicker } from '@/components/billing/currency-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useMoney } from '@/hooks/use-money';
import { formatPlanPrice } from '@/lib/billing/format';
import { availablePeriods, bestPromo, perMonth, periodTotal, savingsPercent, type Period } from '@/lib/billing/period-price';
import { planHasFeature, recommendPlan } from '@/lib/billing/plan-helpers';
import { FEATURE_DEFS, type FeatureKey, type LimitKey, type PlanRow } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

type Method = 'checkout_link' | 'subscription' | 'bank_transfer';
type MethodOption = {
  method: Method; available: boolean; amount: number | null; currency: string | null
  subtotal?: number | null; discount?: number; fee?: number; feePayer?: 'customer' | 'business' | null; couponIssue?: string | null
};
type Quote = { mode: 'off' | 'test' | 'live'; currency: string; methods: MethodOption[] };

export interface BillingSnapshot {
  plans: PlanRow[];
  currentPlanId: string;
  status: string;
  autoRenew: boolean;
  periodEnd: string | null;
  paymentsMode: 'off' | 'test' | 'live';
  usage: { key: LimitKey; used: number; limit: number | null }[];
  /** Items a lower plan archived, per limit key (they come back when there is room). */
  planArchived: Record<string, number>;
}

/** One fetch of /api/account/billing shaped for the dialog. */
export function useBillingSnapshot(enabled: boolean) {
  const [data, setData] = useState<BillingSnapshot | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/billing', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as {
        plans: PlanRow[]; payments_mode?: BillingSnapshot['paymentsMode'];
        subscription: { plan_id: string; status: string; auto_renew?: boolean; current_period_end: string | null };
        usage: BillingSnapshot['usage'];
        plan_archived?: Record<string, number>;
      };
      setData({
        plans: d.plans, currentPlanId: d.subscription.plan_id, status: d.subscription.status, autoRenew: d.subscription.auto_renew === true,
        periodEnd: d.subscription.current_period_end, paymentsMode: d.payments_mode ?? 'off', usage: d.usage ?? [],
        planArchived: d.plan_archived ?? {},
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; state is set after the request resolves
    if (enabled) void load();
  }, [enabled, load]);
  return { data, error, reload: load };
}

// The limits a plan card leads with (the rest are under "See more plan features").
const HIGHLIGHTS: LimitKey[] = ['contacts', 'seats', 'whatsapp_connections', 'workspaces', 'messages_per_month'];

/**
 * Choose a plan (step 1) then pay for it (step 2). Opened by any Upgrade button / limit, and by the Billing page.
 * `limitKey` / `feature`: why it was opened, so the right plan is recommended and the reason shown.
 */
export function PlanDialog({
  open, onOpenChange, limitKey, feature, initialPlanId, onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitKey?: LimitKey | null;
  feature?: FeatureKey | null;
  /** Skip straight to paying for this plan (the Billing page's plan buttons). */
  initialPlanId?: string | null;
  onChanged?: () => void;
}) {
  const t = useTranslations('Settings.billing.picker');
  const { data, error, reload } = useBillingSnapshot(open);
  const [period, setPeriod] = useState<Period>('monthly');
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChosen(null);
      return;
    }
    if (initialPlanId) setChosen(initialPlanId);
  }, [open, initialPlanId]);

  const plan = data?.plans.find((p) => p.id === chosen) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden', plan ? 'sm:max-w-lg' : 'sm:max-w-5xl')}>
        {error ? (
          <>
            <DialogHeader><DialogTitle>{t('title')}</DialogTitle><DialogDescription>{t('loadError')}</DialogDescription></DialogHeader>
          </>
        ) : !data ? (
          <>
            <DialogHeader className="sr-only"><DialogTitle>{t('title')}</DialogTitle></DialogHeader>
            <Loader2 className="text-muted-foreground mx-auto my-12 size-6 animate-spin" />
          </>
        ) : plan ? (
          <CheckoutStep
            data={data}
            plan={plan}
            period={period}
            onPeriod={setPeriod}
            onBack={initialPlanId ? undefined : () => setChosen(null)}
            onDone={() => {
              onChanged?.();
              void reload();
              onOpenChange(false);
            }}
          />
        ) : (
          <PickerStep data={data} period={period} onPeriod={setPeriod} limitKey={limitKey ?? null} feature={feature ?? null} onChoose={setChosen} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PeriodToggle({ plans, period, onPeriod }: { plans: PlanRow[]; period: Period; onPeriod: (p: Period) => void }) {
  const t = useTranslations('Settings.billing.picker');
  const label: Record<Period, string> = { monthly: t('monthly'), quarterly: t('quarterly'), annual: t('annually') };
  return (
    <div role="radiogroup" aria-label={t('period')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {availablePeriods(plans).map((p) => {
        const save = plans.reduce((m, pl) => Math.max(m, savingsPercent(pl, p)), 0);
        const promo = bestPromo(plans, p);
        return (
          <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => onPeriod(p)} className="flex items-center gap-2 text-sm">
            <span className={cn('flex size-4 items-center justify-center rounded-full border', period === p ? 'border-primary' : 'border-muted-foreground/40')}>
              {period === p ? <span className="bg-primary size-2 rounded-full" /> : null}
            </span>
            <span className={cn(period === p ? 'font-medium' : 'text-muted-foreground')}>{label[p]}</span>
            {save > 0 ? (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">
                {promo ? t('savePromo', { promo, percent: save }) : t('save', { percent: save })}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function limitText(v: number | null | undefined, locale: string, unlimited: string) {
  return v === null || v === undefined ? unlimited : v.toLocaleString(locale);
}

function PickerStep({
  data, period, onPeriod, limitKey, feature, onChoose,
}: {
  data: BillingSnapshot; period: Period; onPeriod: (p: Period) => void; limitKey: LimitKey | null; feature: FeatureKey | null; onChoose: (id: string) => void;
}) {
  const t = useTranslations('Settings.billing.picker');
  const tb = useTranslations('Settings.billing');
  const locale = useLocale();
  const money = useMoney();
  const [more, setMore] = useState(false);
  const plans = useMemo(() => [...data.plans].sort((a, b) => a.sort_order - b.sort_order), [data.plans]);
  const used = limitKey ? data.usage.find((u) => u.key === limitKey)?.used : undefined;
  const recommended = recommendPlan(plans, data.currentPlanId, { limitKey, used, feature });
  const current = plans.find((p) => p.id === data.currentPlanId);
  const reason = limitKey && current
    ? t('reasonLimit', { plan: current.name, limit: limitText(current.limits[limitKey], locale, tb('unlimited')), what: tb(`limits.${limitKey}`) })
    : feature && current ? t('reasonFeature', { plan: current.name, feature: tb(`features.${feature}`) }) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{reason ?? t('subtitle')}</DialogDescription>
      </DialogHeader>
      <div className="-mx-1 overflow-y-auto px-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PeriodToggle plans={plans} period={period} onPeriod={onPeriod} />
          <CurrencyPicker />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((p, i) => {
            const isCurrent = p.id === data.currentPlanId;
            const isRec = recommended?.id === p.id;
            const prev = i > 0 ? plans[i - 1] : null;
            const price = perMonth(p, period) || p.price_monthly;
            const total = periodTotal(p, period);
            const trial = (p.trial_days ?? 0) > 0 && data.currentPlanId === 'free' && data.status !== 'trialing' ? p.trial_days : 0;
            return (
              <div
                key={p.id}
                className={cn('relative flex flex-col rounded-xl border p-4', isRec ? 'border-primary ring-primary ring-1' : '')}
              >
                {isRec ? (
                  <span className="bg-primary text-primary-foreground absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    <Sparkles className="size-3" /> {t('recommended')}
                  </span>
                ) : p.is_featured ? (
                  <span className="absolute -top-2.5 left-4 rounded-full border bg-background px-2 py-0.5 text-[11px] font-semibold">{tb('mostPopular')}</span>
                ) : null}
                <p className="text-base font-semibold">{p.name}</p>
                <p className="mt-1">
                  <span className="text-2xl font-bold">{money(price, p.currency)}</span>
                  {p.price_monthly > 0 ? <span className="text-muted-foreground text-sm"> {tb('perMonth')}</span> : null}
                </p>
                {period !== 'monthly' && total > 0 ? (
                  <p className="text-muted-foreground text-xs">{t(period === 'quarterly' ? 'billedQuarterly' : 'billedYearly', { price: money(total, p.currency) })}</p>
                ) : <p className="text-xs">&nbsp;</p>}
                {p.description ? <p className="text-muted-foreground mt-2 line-clamp-2 min-h-8 text-xs">{p.description}</p> : null}
                <Button
                  className="mt-3 w-full"
                  variant={isRec ? 'default' : 'outline'}
                  disabled={isCurrent && data.status !== 'trialing'}
                  onClick={() => onChoose(p.id)}
                >
                  {isCurrent && data.status !== 'trialing' ? t('currentPlan') : trial ? t('startTrial', { days: trial }) : t('choose')}
                </Button>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {prev ? <li className="text-muted-foreground text-xs">{t('everythingIn', { plan: prev.name })}</li> : null}
                  {HIGHLIGHTS.map((k) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{tb(`limits.${k}`)}</span>
                      <span className={cn('font-medium', limitKey === k && isRec ? 'text-primary' : '')}>{limitText(p.limits[k], locale, tb('unlimited'))}</span>
                    </li>
                  ))}
                </ul>
                {more ? (
                  <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
                    {(Object.keys(FEATURE_DEFS) as FeatureKey[]).map((f) => {
                      const on = planHasFeature(p, f);
                      return (
                        <li key={f} className={cn('flex items-start gap-2', on ? '' : 'text-muted-foreground/60')}>
                          {on ? <Check className="text-primary mt-0.5 size-3.5 shrink-0" /> : <X className="mt-0.5 size-3.5 shrink-0" />}
                          <span className="text-xs">{tb(`features.${f}`)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <DialogFooter className="sm:justify-center">
        <Button variant="outline" onClick={() => setMore((m) => !m)}>
          <ChevronDown className={cn('size-4 transition-transform', more ? 'rotate-180' : '')} />
          {more ? t('seeLess') : t('seeMore')}
        </Button>
      </DialogFooter>
    </>
  );
}

function CheckoutStep({
  data, plan, period, onPeriod, onBack, onDone,
}: {
  data: BillingSnapshot; plan: PlanRow; period: Period; onPeriod: (p: Period) => void; onBack?: () => void; onDone: () => void;
}) {
  const t = useTranslations('Settings.billing.picker');
  const tb = useTranslations('Settings.billing');
  const locale = useLocale();
  const money = useMoney();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [renew, setRenew] = useState(true);
  const [couponOpen, setCouponOpen] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<{ reference: string; instructions: TransferInstructions } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const isFree = plan.id === 'free';
  const paymentsOn = data.paymentsMode === 'test' || data.paymentsMode === 'live';
  const onTrial = data.status === 'trialing';
  const periodPrice = periodTotal(plan, period) || plan.price_monthly;

  useEffect(() => {
    if (isFree || !paymentsOn) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const q = new URLSearchParams({ plan_id: plan.id, interval: period, ...(appliedCoupon ? { coupon: appliedCoupon } : {}) });
    fetch(`/api/account/billing/checkout?${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : null))
      .then((d) => live && setQuote(d))
      .catch(() => live && setQuote(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [plan.id, period, appliedCoupon, isFree, paymentsOn, refreshKey]);

  const sub = quote?.methods.find((m) => m.method === 'subscription' && m.available) ?? null;
  const once = quote?.methods.find((m) => m.method === 'checkout_link' && m.available) ?? null;
  const bank = quote?.methods.find((m) => m.method === 'bank_transfer' && m.available) ?? null;
  const canRecur = Boolean(sub);
  const method: Method | null = renew && sub && !sub.couponIssue ? 'subscription' : once ? 'checkout_link' : sub ? 'subscription' : bank ? 'bank_transfer' : null;
  const line = quote?.methods.find((m) => m.method === method) ?? null;
  const couponIssue = appliedCoupon ? (line?.couponIssue ?? null) : null;

  async function pay() {
    setBusy(true);
    try {
      // Free: stop the paid plan renewing (it runs to the end of what was paid for).
      if (isFree) {
        if (!paymentsOn) return await switchNow();
        const res = await fetch('/api/account/billing/cancel', { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { status?: string; periodEnd?: string | null; message?: string };
        if (!res.ok) return void toast.error(body.message || t('failed'));
        toast.success(body.periodEnd ? t('cancelled', { date: new Date(body.periodEnd).toLocaleDateString(locale) }) : t('cancelledNow'));
        return onDone();
      }
      if (!paymentsOn) return await switchNow();
      if (!method) return void toast.error(t('noMethod'));
      const res = await fetch('/api/account/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id, interval: period, method, ...(appliedCoupon && !couponIssue ? { coupon_code: appliedCoupon } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectUrl?: string; instructions?: TransferInstructions; reference?: string; completed?: boolean; error?: string };
      if (!res.ok) {
        toast.error(body.error === 'coupon_invalid' || body.error === 'coupon_not_recurring' ? t('couponInvalid') : body.error === 'no_provider' ? t('noMethod') : t('failed'));
        return;
      }
      if (body.completed) {
        toast.success(t('activated', { plan: plan.name }));
        return onDone();
      }
      if (body.redirectUrl) return void window.location.assign(body.redirectUrl);
      if (body.instructions && body.reference) setTransfer({ reference: body.reference, instructions: body.instructions });
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  // Payments off (admin console): plans change immediately, as before.
  async function switchNow() {
    const res = await fetch('/api/account/billing/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: plan.id }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return void toast.error(body.error || t('failed'));
    toast.success(tb('switched', { plan: plan.name }));
    onDone();
  }

  if (transfer) return <TransferDetails reference={transfer.reference} instructions={transfer.instructions} />;

  const fmt = (n: number | null | undefined, c: string | null | undefined) => (n == null || !c ? '' : formatPlanPrice(n, c, locale));
  const subtotal = line?.subtotal ?? line?.amount ?? null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isFree ? t('downgradeTitle') : plan.name}</DialogTitle>
        <DialogDescription>
          {isFree
            ? data.periodEnd ? t('downgradeDesc', { date: new Date(data.periodEnd).toLocaleDateString(locale) }) : t('downgradeNow')
            : onTrial ? t('trialCarry') : quote?.mode === 'test' ? tb('pay.testMode') : plan.description ?? ''}
        </DialogDescription>
      </DialogHeader>
      <div className="-mx-1 space-y-4 overflow-y-auto px-1">
        {!isFree ? (
          <>
            <PeriodToggle plans={[plan]} period={period} onPeriod={onPeriod} />
            <div className="rounded-xl border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{plan.name}</span>
                <span className="text-right">
                  <span className="text-xl font-bold">{money(perMonth(plan, period) || plan.price_monthly, plan.currency)}</span>
                  <span className="text-muted-foreground text-xs"> {tb('perMonth')}</span>
                </span>
              </div>
              {paymentsOn ? (
                couponOpen ? (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAppliedCoupon(coupon.trim().toUpperCase());
                    }}
                  >
                    <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder={t('couponPlaceholder')} maxLength={32} className="font-mono uppercase" aria-label={t('coupon')} />
                    <Button type="submit" variant="outline" disabled={!coupon.trim() || loading}>{t('apply')}</Button>
                  </form>
                ) : (
                  <button type="button" className="text-primary mt-3 text-sm hover:underline" onClick={() => setCouponOpen(true)}>{t('haveCoupon')}</button>
                )
              ) : null}
              {appliedCoupon && couponIssue ? <p className="mt-2 text-xs text-red-500">{t(`couponIssue.${couponIssue in COUPON_ISSUES ? couponIssue : 'invalid'}`)}</p> : null}
            </div>

            {paymentsOn ? (
              <div className="space-y-2 rounded-xl border p-4 text-sm">
                {loading || !quote ? (
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                ) : !line ? (
                  <p className="text-muted-foreground">{t('noMethod')}</p>
                ) : (
                  <>
                    <Row label={t('subtotal')} value={fmt(subtotal, line.currency)} />
                    {line.discount ? <Row label={t('couponLine', { code: appliedCoupon })} value={`−${fmt(line.discount, line.currency)}`} /> : null}
                    {line.fee ? <Row label={t('fee')} value={fmt(line.fee, line.currency)} /> : null}
                    <div className="border-t pt-2"><Row label={t('total')} value={fmt(line.amount, line.currency)} strong /></div>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border p-4 text-sm"><Row label={t('total')} value={money(periodPrice, plan.currency)} strong /></div>
            )}

            {paymentsOn && (canRecur || once) ? (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{t('renewTitle')}</p>
                  <p className="text-muted-foreground text-sm">{canRecur ? t('renewDesc') : t('renewUnavailable')}</p>
                </div>
                <Switch checked={renew && canRecur} disabled={!canRecur || !once} onCheckedChange={setRenew} aria-label={t('renewTitle')} />
              </div>
            ) : null}
            <PlanImpact data={data} plan={plan} />
          </>
        ) : (
          <PlanImpact data={data} plan={plan} />
        )}
      </div>
      <DialogFooter>
        {onBack ? <Button variant="outline" onClick={onBack} disabled={busy}><ArrowLeft className="size-4" />{t('back')}</Button> : null}
        <Button onClick={() => void pay()} disabled={busy || (!isFree && paymentsOn && (loading || !line))} className="sm:min-w-48">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {isFree ? (paymentsOn ? t('confirmDowngrade') : tb('switchTo', { plan: plan.name })) : method === 'bank_transfer' ? tb('pay.showTransfer') : paymentsOn ? t('completePayment') : tb('switchTo', { plan: plan.name })}
        </Button>
      </DialogFooter>
      {/* re-quote on currency change */}
      <CurrencyRequote onChange={() => setRefreshKey((k) => k + 1)} />
    </>
  );
}

const COUPON_ISSUES: Record<string, true> = { not_found: true, expired: true, not_started: true, inactive: true, not_for_plan: true, not_for_interval: true, exhausted: true, already_used: true, once_not_recurring: true, invalid: true };

/** Invisible: re-quotes the checkout when the currency picker changes the display currency. */
function CurrencyRequote({ onChange }: { onChange: () => void }) {
  useEffect(() => {
    window.addEventListener('ogadesk:currency-changed', onChange);
    return () => window.removeEventListener('ogadesk:currency-changed', onChange);
  }, [onChange]);
  return null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', strong ? 'text-base font-semibold' : '')}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// Limits the archive engine cuts back on a lower plan (migration 132). Everything else over a limit simply stops
// growing until the plan has room again.
const ARCHIVABLE = new Set<string>(['forms_max', 'custom_fields_max', 'custom_tables_max', 'automations', 'flows', 'webhook_endpoints', 'integrations_max', 'quick_replies']);
// Monthly allowances reset each month: never "over" in the sense shown here.
const MONTHLY = /_per_month$/;

interface PreviewItem { key: string; limit: number | null; count: number; archive: number; restore: number; names: string[] }

/**
 * What switching to `plan` does to this workspace: items that will be archived (with a few names), items over the
 * new limit that stay but cannot grow, and items a lower plan archived that come back. Nothing is deleted.
 */
function PlanImpact({ data, plan }: { data: BillingSnapshot; plan: PlanRow }) {
  const t = useTranslations('Settings.billing.picker');
  const tb = useTranslations('Settings.billing');
  const locale = useLocale();
  const current = data.plans.find((p) => p.id === data.currentPlanId);
  const lower = plan.id === 'free' || (current ? plan.sort_order < current.sort_order : false);
  const hasArchived = Object.keys(data.planArchived).length > 0;
  const [items, setItems] = useState<PreviewItem[] | null>(null);

  useEffect(() => {
    if (!lower && !hasArchived) return;
    let live = true;
    fetch(`/api/account/billing/downgrade-preview?plan_id=${encodeURIComponent(plan.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: PreviewItem[] }) => {
        if (live) setItems(d.items ?? []);
      })
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [plan.id, lower, hasArchived]);

  if (!lower && !hasArchived) return null;
  if (items === null) return <Loader2 className="text-muted-foreground mx-auto size-4 animate-spin" />;

  const archive = items.filter((i) => i.archive > 0);
  const restore = items.filter((i) => i.restore > 0);
  const stuck = lower
    ? data.usage.filter((u) => {
        const l = plan.limits[u.key];
        return !ARCHIVABLE.has(u.key) && !MONTHLY.test(u.key) && typeof l === 'number' && u.used > l;
      })
    : [];
  const n = (x: number) => x.toLocaleString(locale);

  if (archive.length === 0 && restore.length === 0 && stuck.length === 0) {
    return lower ? <p className="text-muted-foreground text-sm">{t('planFits', { plan: plan.name })}</p> : null;
  }
  return (
    <div className="max-h-56 space-y-3 overflow-y-auto text-sm">
      {archive.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium">{t('impactArchiveTitle', { plan: plan.name })}</p>
          <ul className="space-y-1">
            {archive.map((i) => (
              <li key={i.key} className="rounded-lg bg-amber-500/10 px-3 py-1.5">
                <div className="flex justify-between gap-3">
                  <span>{tb(`limits.${i.key}`)}</span>
                  <span className="tabular-nums">{t('impactArchiveLine', { archive: n(i.archive), count: n(i.count), keep: n(i.limit ?? 0) })}</span>
                </div>
                {i.names.length > 0 ? (
                  <p className="text-muted-foreground truncate text-xs">{t('impactExamples', { names: i.names.join(', ') })}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{t('impactArchiveNote')}</p>
        </div>
      ) : null}
      {stuck.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium">{t('impactStuckTitle', { plan: plan.name })}</p>
          <ul className="space-y-1">
            {stuck.map((u) => (
              <li key={u.key} className="flex justify-between gap-3 rounded-lg bg-muted px-3 py-1.5">
                <span>{tb(`limits.${u.key}`)}</span>
                <span className="tabular-nums">{t('overLine', { used: n(u.used), limit: n(plan.limits[u.key] ?? 0) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {restore.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium">{t('impactRestoreTitle')}</p>
          <ul className="space-y-1">
            {restore.map((i) => (
              <li key={i.key} className="flex justify-between gap-3 rounded-lg bg-emerald-500/10 px-3 py-1.5">
                <span>{tb(`limits.${i.key}`)}</span>
                <span className="tabular-nums">{t('impactRestoreLine', { restore: n(i.restore) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
