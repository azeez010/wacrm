'use client';

import { useCallback, useEffect, useState } from 'react';

import type { FeatureKey, PlanRow } from '@/lib/billing/plans';

export interface BillingPlans {
  plans: PlanRow[];
  currentPlanId: string;
  features: Partial<Record<FeatureKey, boolean>>;
}

/** The plan catalogue and the account's current plan (GET /api/account/billing). `reload` refetches. */
export function useBillingPlans(enabled = true) {
  const [data, setData] = useState<BillingPlans | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/account/billing', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { plans: PlanRow[]; subscription: { plan_id: string }; features: BillingPlans['features'] };
      setData({ plans: d.plans, currentPlanId: d.subscription.plan_id, features: d.features });
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { data, error, reload };
}
