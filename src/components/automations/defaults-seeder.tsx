'use client';

import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';

// v2: the server now also creates the default segments, so sessions that already
// ran the automations-only version must call it once more.
const SESSION_KEY = 'wacrm:defaults-seeded:v2';
export const DEFAULTS_SEEDED_EVENT = 'wacrm:defaults-seeded';

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
      .then(async (res) => {
        // 403 = viewer; they can't seed, a teammate will.
        if (!res.ok) return;
        try {
          sessionStorage.setItem(SESSION_KEY, accountId);
        } catch {
          /* ignore */
        }
        // Tell open pages (e.g. Contacts' segment list) something new exists.
        const body = (await res.json().catch(() => ({}))) as { created?: string[] };
        if (body.created && body.created.length > 0) {
          window.dispatchEvent(new Event(DEFAULTS_SEEDED_EVENT));
        }
      })
      .catch(() => {});
  }, [accountId]);
  return null;
}
