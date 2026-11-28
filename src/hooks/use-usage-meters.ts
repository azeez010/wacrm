'use client';

import { useEffect, useState } from 'react';

import type { LimitKey } from '@/lib/billing/plans';

export interface UsageMeter {
  key: LimitKey;
  used: number;
  limit: number | null;
}

// One fetch shared by every nudge on the page, refreshed at most every 30 seconds.
let cache: { at: number; meters: UsageMeter[] } | null = null;
let inflight: Promise<UsageMeter[]> | null = null;

function load(): Promise<UsageMeter[]> {
  if (cache && Date.now() - cache.at < 30_000) return Promise.resolve(cache.meters);
  inflight ??= fetch('/api/account/billing', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { usage?: UsageMeter[] } | null) => {
      const meters = d?.usage ?? [];
      cache = { at: Date.now(), meters };
      return meters;
    })
    .catch(() => [] as UsageMeter[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Forget the cached meters (call after creating or deleting something that counts). */
export function resetUsageMeters() {
  cache = null;
}

export function useUsageMeter(key: LimitKey): UsageMeter | null {
  const [meter, setMeter] = useState<UsageMeter | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((all) => {
      if (live) setMeter(all.find((m) => m.key === key) ?? null);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return meter;
}
