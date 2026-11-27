'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { PlanDialog } from '@/components/billing/plan-dialog';
import { Button } from '@/components/ui/button';
import { useBillingPlans } from '@/hooks/use-billing-plans';
import { cheapestPlanWith } from '@/lib/billing/plan-helpers';
import type { FeatureKey, LimitKey } from '@/lib/billing/plans';

/**
 * The plan picker + checkout, opened wherever a locked feature or a full limit needs an upgrade.
 * Kept as a thin wrapper so existing callers keep their props; the dialog itself is PlanDialog.
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  feature,
  limitKey,
  initialPlanId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: FeatureKey;
  limitKey?: LimitKey | null;
  initialPlanId?: string;
  onChanged?: () => void;
}) {
  return <PlanDialog open={open} onOpenChange={onOpenChange} feature={feature} limitKey={limitKey} initialPlanId={initialPlanId} onChanged={onChanged} />;
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
