'use client';

import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';

const SESSION_KEY = 'wacrm:defaults-seeded';

/**
 * Headless. Asks the server once per browser session to create the account's
 * default automations (the editable Unsubscribe flow). The server is
 * idempotent and remembers deletions, so this never recreates a deleted one.
 */
export function DefaultsSeeder() {
  const { accountId } = useAuth();
  useEffect(() => {
    if (!accountId) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === accountId) return;
    } catch {
      /* storage blocked: just call, it is idempotent */
    }
    void fetch('/api/automations/defaults', { method: 'POST' })
      .then((res) => {
        // 403 = viewer; they can't seed, a teammate will.
        if (res.ok) {
          try {
            sessionStorage.setItem(SESSION_KEY, accountId);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
  }, [accountId]);
  return null;
}
