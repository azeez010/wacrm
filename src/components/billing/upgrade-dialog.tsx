'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBillingPlans } from '@/hooks/use-billing-plans';
import { useMoney } from '@/hooks/use-money';
import { cheapestPlanWith, planHasFeature } from '@/lib/billing/plan-helpers';
import type { FeatureKey } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

/**
 * Pick a plan and switch to it. Reused wherever a locked feature needs an upgrade.
 * Payments are not connected yet, so the switch applies immediately (POST /api/account/billing/plan).
 * `feature`: the feature that prompted this, so the cards show which plans include it.
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  feature,
  initialPlanId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: FeatureKey;
  initialPlanId?: string;
  onChanged?: () => void;
}) {
  const t = useTranslations('Settings.billing');
  const money = useMoney();
  const { data, error } = useBillingPlans(open);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Preselect: the plan we were asked for, else the cheapest one with the feature, else the first upgrade.
  useEffect(() => {
    if (!open || !data || picked) return;
    const suggestion = initialPlanId ?? (feature ? cheapestPlanWith(data.plans, feature)?.id : undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicked(suggestion ?? data.plans.find((p) => p.id !== data.currentPlanId)?.id ?? null);
  }, [open, data, picked, feature, initialPlanId]);

  const chosen = data?.plans.find((p) => p.id === picked);

  async function confirm() {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/billing/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: chosen.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(payload.error || t('switchFailed'));
        return;
      }
      toast.success(t('switched', { plan: chosen.name }));
      onChanged?.();
      onOpenChange(false);
      setPicked(null);
    } catch {
      toast.error(t('switchFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('pickTitle')}</DialogTitle>
          <DialogDescription>{t('pickDesc')}</DialogDescription>
        </DialogHeader>

        <div className="-m-1 overflow-y-auto p-1">
          {error ? <p className="text-muted-foreground text-sm">{t('loadError')}</p> : null}
          {!data && !error ? <Loader2 className="text-muted-foreground mx-auto my-6 size-5 animate-spin" /> : null}
          {data ? (
            <div role="radiogroup" aria-label={t('pickTitle')} className="grid gap-2">
              {data.plans.map((p) => {
                const current = p.id === data.currentPlanId;
                const on = picked === p.id;
                const has = feature ? planHasFeature(p, feature) : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPicked(p.id)}
                    className={cn('flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors', on ? 'border-primary ring-primary ring-1' : 'hover:bg-muted/50')}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {p.name}
                        {current ? <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-xs font-medium">{t('yourPlan')}</span> : null}
                        {p.is_featured && !current ? <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-xs font-medium">{t('mostPopular')}</span> : null}
                      </span>
                      {feature ? (
                        <span className={cn('mt-1 flex items-center gap-1.5 text-xs', has ? 'text-foreground' : 'text-muted-foreground/70')}>
                          {has ? <Check className="text-primary size-3.5" /> : <X className="size-3.5" />}
                          {t(`features.${feature}`)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-base font-bold">{money(p.price_monthly, p.currency)}</span>
                      <span className="text-muted-foreground block text-xs">{t('perMonth')}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || !chosen || chosen.id === data?.currentPlanId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {chosen ? t('switchTo', { plan: chosen.name }) : t('switchToGeneric')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Upgrade to Starter to use MCP": opens the plan picker preselected to the cheapest plan with the feature. */
export function UpgradeButton({ feature, onChanged, className }: { feature: FeatureKey; onChanged?: () => void; className?: string }) {
  const t = useTranslations('Settings.billing');
  const { data } = useBillingPlans();
  const [open, setOpen] = useState(false);
  const target = data ? cheapestPlanWith(data.plans, feature) : null;
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} disabled={!data}>
        {target ? t('upgradeTo', { plan: target.name, feature: t(`features.${feature}`) }) : t('upgrade')}
      </Button>
      <UpgradeDialog open={open} onOpenChange={setOpen} feature={feature} onChanged={onChanged} />
    </>
  );
}
