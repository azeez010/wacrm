'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatPlanPrice } from '@/lib/billing/format';
import type { PlanRow } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

type Interval = 'monthly' | 'quarterly' | 'annual';
type Method = 'checkout_link' | 'subscription' | 'bank_transfer';
type Option = { method: Method; available: boolean; amount: number | null; currency: string | null };
type Options = { mode: 'off' | 'test' | 'live'; country: string | null; currency: string; methods: Option[] };
export type TransferInstructions = { bankName: string; accountName: string; accountNumber: string; amount: string; currency: string; reference: string; note?: string };

const INTERVALS: Interval[] = ['monthly', 'quarterly', 'annual'];
const METHODS: Method[] = ['subscription', 'checkout_link', 'bank_transfer'];

/** Step 2 of the upgrade dialog: billing period, payment method (with the real price), then pay. */
export function PaymentStep({ plan, onBack }: { plan: PlanRow; onBack: () => void }) {
  const t = useTranslations('Settings.billing.pay');
  const locale = useLocale();
  const [interval, setInterval] = useState<Interval>('monthly');
  const [options, setOptions] = useState<Options | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<{ reference: string; instructions: TransferInstructions } | null>(null);

  useEffect(() => {
    let live = true;
    setOptions(null);
    fetch(`/api/account/billing/checkout?plan_id=${encodeURIComponent(plan.id)}&interval=${interval}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Options>) : null))
      .then((o) => {
        if (!live) return;
        setOptions(o);
        setMethod((m) => (o?.methods.find((x) => x.method === m && x.available) ? m : o?.methods.find((x) => x.available)?.method ?? null));
      })
      .catch(() => live && setOptions(null));
    return () => {
      live = false;
    };
  }, [plan.id, interval]);

  const prices: Record<Interval, number> = { monthly: plan.price_monthly, quarterly: plan.price_quarterly, annual: plan.price_annual };
  const available = options?.methods.filter((m) => m.available) ?? [];

  async function pay() {
    if (!method) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id, interval, method }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectUrl?: string; instructions?: TransferInstructions; reference?: string; error?: string };
      if (!res.ok) {
        toast.error(body.error === 'no_provider' ? t('noMethods') : t('failed'));
        return;
      }
      if (body.redirectUrl) {
        window.location.assign(body.redirectUrl);
        return;
      }
      if (body.instructions && body.reference) setTransfer({ reference: body.reference, instructions: body.instructions });
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  if (transfer) return <TransferDetails reference={transfer.reference} instructions={transfer.instructions} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{plan.name}</DialogTitle>
        <DialogDescription>{options?.mode === 'test' ? t('testMode') : t('methodTitle')}</DialogDescription>
      </DialogHeader>
      <div className="-m-1 space-y-4 overflow-y-auto p-1">
        <div>
          <p className="mb-2 text-sm font-medium">{t('intervalTitle')}</p>
          <div role="radiogroup" aria-label={t('intervalTitle')} className="grid grid-cols-3 gap-2">
            {INTERVALS.filter((i) => prices[i] > 0).map((i) => (
              <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)}
                className={cn('rounded-lg border p-2 text-sm transition-colors', interval === i ? 'border-primary ring-primary ring-1' : 'hover:bg-muted/50')}>
                {t(i)}
              </button>
            ))}
          </div>
        </div>
        {!options ? <Loader2 className="text-muted-foreground mx-auto my-4 size-5 animate-spin" /> : available.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noMethods')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('methodTitle')} className="grid gap-2">
            {METHODS.map((m) => {
              const o = options.methods.find((x) => x.method === m);
              if (!o?.available) return null;
              return (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                  className={cn('flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors', method === m ? 'border-primary ring-primary ring-1' : 'hover:bg-muted/50')}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(`method_${m}`)}</span>
                    <span className="text-muted-foreground block text-xs">{t(`method_${m}_desc`)}</span>
                  </span>
                  {o.amount != null && o.currency ? <span className="shrink-0 text-sm font-bold">{formatPlanPrice(o.amount, o.currency, locale)}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={busy}><ArrowLeft className="size-4" />{t('back')}</Button>
        <Button onClick={() => void pay()} disabled={busy || !method}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {method === 'bank_transfer' ? t('showTransfer') : t('continue')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Bank details + reference for a manual transfer, and the "I've sent it" button. Also used by the return page. */
export function TransferDetails({ reference, instructions }: { reference: string; instructions: TransferInstructions }) {
  const t = useTranslations('Settings.billing.pay');
  const locale = useLocale();
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = formatPlanPrice(Number(instructions.amount), instructions.currency, locale);
  const rows: [string, string][] = [
    [t('bank'), instructions.bankName], [t('accountName'), instructions.accountName], [t('accountNumber'), instructions.accountNumber],
    [t('amount'), amount], [t('reference'), instructions.reference],
  ];
  async function report() {
    setBusy(true);
    try {
      const res = await fetch(`/api/account/billing/checkout/${encodeURIComponent(reference)}/reported`, { method: 'POST' });
      if (res.ok || res.status === 409) setReported(true);
      else toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('transferTitle')}</DialogTitle>
        <DialogDescription>{t('transferDesc', { amount })}</DialogDescription>
      </DialogHeader>
      <dl className="divide-y rounded-xl border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="flex items-center gap-2 font-medium">
              <span className="font-mono">{v}</span>
              <button type="button" aria-label={`${t('copy')} ${k}`} className="text-muted-foreground hover:text-foreground"
                onClick={() => navigator.clipboard.writeText(v).then(() => toast.success(t('copied')), () => undefined)}>
                <Copy className="size-3.5" />
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {instructions.note ? <p className="text-muted-foreground text-xs">{instructions.note}</p> : null}
      <DialogFooter>
        {reported ? <p className="text-sm">{t('transferReported')}</p> : (
          <Button onClick={() => void report()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{t('transferSent')}</Button>
        )}
      </DialogFooter>
    </>
  );
}
