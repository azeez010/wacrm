'use client';

import { useEffect, useState } from 'react';

import { PlanDialog } from '@/components/billing/plan-dialog';
import { notifyPlanLimit, parsePlanLimit, PLAN_LIMIT_EVENT, type PlanLimitHit } from '@/lib/billing/plan-limit';

/** Should this failed response be checked for a plan limit? Our own API (402s, or 4xx with the limit text) and the
 *  database client (contacts limit trigger, create_workspace) - never other sites. */
export function isLimitCandidate(url: string, status: number, origin: string, supabaseUrl: string | undefined): boolean {
  if (status < 400) return false
  const own = url.startsWith('/api/') || url.startsWith(`${origin}/api/`)
  // Some of our routes pass a database 'plan_limit:<key>:<n>' through as a 500; only a real plan-limit body counts.
  if (status >= 500) return own
  return own || Boolean(supabaseUrl && url.startsWith(supabaseUrl))
}

/**
 * Mounted once in the dashboard shell. Two ways in:
 *  1. notifyPlanLimit / handlePlanLimit from any component;
 *  2. any request of ours that fails because of a plan limit (402, or the database's 'plan_limit:<key>:<n>'),
 *     noticed here so every screen gets the upgrade dialog without wiring each one. The screen's own error
 *     handling still runs as before.
 */
export function UpgradeHost() {
  const [hit, setHit] = useState<PlanLimitHit | null>(null);

  useEffect(() => {
    const on = (e: Event) => setHit((e as CustomEvent<PlanLimitHit>).detail ?? { limitKey: null, limit: null });
    window.addEventListener(PLAN_LIMIT_EVENT, on);

    const original = window.fetch;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (isLimitCandidate(url, res.status, window.location.origin, supabaseUrl) && (res.headers.get('content-type') ?? '').includes('json')) {
          void res.clone().json().then((body: unknown) => {
            const found = parsePlanLimit(body);
            if (found) notifyPlanLimit(found);
            else if (res.status === 402) notifyPlanLimit({ limitKey: null, limit: null }); // a locked feature or used-up allowance
          }).catch(() => undefined);
        }
      } catch {
        /* never break a request over this */
      }
      return res;
    };

    return () => {
      window.removeEventListener(PLAN_LIMIT_EVENT, on);
      window.fetch = original;
    };
  }, []);

  return <PlanDialog open={hit !== null} onOpenChange={(o) => !o && setHit(null)} limitKey={hit?.limitKey ?? null} />;
}
