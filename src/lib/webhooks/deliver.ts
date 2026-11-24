// ============================================================
// Outbound webhook delivery.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event, signs one JSON payload, and POSTs it to
// each in parallel. It is best-effort and never throws - callers fire
// it from the inbound webhook's `after()` block, where a failed
// delivery must not affect the 200 OK returned to Meta.
//
// Delivery semantics (documented in docs/public-api.md):
//   - At-most-once per event, single attempt with a short timeout.
//   - Each consecutive failure bumps `failure_count`; once it crosses
//     MAX_CONSECUTIVE_FAILURES the endpoint is auto-disabled
//     (`is_active = false`) so a dead sink stops being hit. A success
//     resets the counter and stamps `last_delivery_at`.
//   - Durable retry-with-backoff would need a queue/worker (a
//     follow-up); in-process retries inside `after()` would burn the
//     route's duration budget without a real durability guarantee.
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

/** Per-endpoint HTTP timeout. Kept short - this runs in `after()`. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

export interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

/** How long delivery-log rows are kept (see migration 084). */
export const DELIVERY_LOG_RETENTION_DAYS = 14;
const RESPONSE_SNIPPET_MAX = 1000;
const PRUNE_PROBABILITY = 0.02;

export interface AttemptResult {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  snippet: string | null;
}

/**
 * Deliver `event` (+ `data`) to every active endpoint of `accountId`
 * subscribed to it. Never throws.
 */
export async function dispatchWebhookEvent(
  db: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    const { data: rows, error } = await db
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (error || !rows || rows.length === 0) return;

    // Sign the exact bytes we send so a receiver can recompute the
    // HMAC over the raw request body. `id` is a per-delivery uuid the
    // receiver can dedupe on (deliveries are at-least-once and may
    // repeat / arrive out of order).
    const eventId = randomUUID();
    const payload = JSON.stringify({
      id: eventId,
      event,
      occurred_at: new Date().toISOString(),
      account_id: accountId,
      data,
    });
    const tsSeconds = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      (rows as EndpointRow[]).map((row) =>
        deliverAndRecord(db, accountId, row, event, payload, tsSeconds)
      )
    );
  } catch (err) {
    // Never let a delivery problem bubble into the webhook response.
    console.error('[webhooks] dispatch failed:', err);
  }
}

/**
 * One signed POST. Never throws; the result says what happened. Shared
 * by the live dispatcher and the dashboard's manual "resend".
 */
export async function attemptDelivery(
  row: EndpointRow,
  event: string,
  payload: string,
  tsSeconds: number
): Promise<AttemptResult> {
  const started = Date.now();
  const done = (r: Omit<AttemptResult, 'durationMs'>): AttemptResult => ({
    ...r,
    durationMs: Date.now() - started,
  });

  // SSRF guard: refuse to POST to a host that resolves to a private /
  // loopback / link-local address. Counts as a failure so a
  // misconfigured internal URL surfaces and eventually auto-disables.
  if (!(await isDeliverableUrl(row.url))) {
    console.warn('[webhooks] refusing non-public delivery target for', row.id);
    return done({
      ok: false,
      statusCode: null,
      error: 'Refused: the URL resolves to a private or non-public address',
      snippet: null,
    });
  }

  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch (err) {
    // A row whose secret can't be decrypted can never produce a valid
    // signature - count it as a failure so it eventually auto-disables.
    console.error('[webhooks] secret decrypt failed for', row.id, err);
    return done({
      ok: false,
      statusCode: null,
      error: 'Could not read the signing secret',
      snippet: null,
    });
  }

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': row.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      // Do NOT follow redirects - a public URL could 3xx-bounce to an
      // internal address, bypassing the SSRF check above. A 3xx is a
      // misconfiguration; treat it as a failure.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    let snippet: string | null = null;
    try {
      snippet = (await res.text()).slice(0, RESPONSE_SNIPPET_MAX) || null;
    } catch {
      snippet = null;
    }
    return done({
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : `Endpoint responded ${res.status}`,
      snippet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhooks] delivery to ${row.id} failed:`, message);
    return done({ ok: false, statusCode: null, error: message, snippet: null });
  }
}

/**
 * Attempt a delivery, update the endpoint's health counters and write
 * a log row. `resentFrom` marks a manual resend of an earlier delivery.
 */
export async function deliverAndRecord(
  db: SupabaseClient,
  accountId: string,
  row: EndpointRow,
  event: string,
  payload: string,
  tsSeconds: number,
  resentFrom: string | null = null
): Promise<AttemptResult> {
  const result = await attemptDelivery(row, event, payload, tsSeconds);

  if (result.ok) {
    // Success: clear the failure streak.
    await db
      .from('webhook_endpoints')
      .update({ failure_count: 0, last_delivery_at: new Date().toISOString() })
      .eq('id', row.id);
  } else {
    await recordFailure(db, row);
  }

  await logDelivery(db, accountId, row.id, event, payload, result, resentFrom);
  return result;
}

/** Best-effort log write (+ occasional prune). Never throws. */
async function logDelivery(
  db: SupabaseClient,
  accountId: string,
  endpointId: string,
  event: string,
  payload: string,
  result: AttemptResult,
  resentFrom: string | null
): Promise<void> {
  try {
    let parsed: { id?: string } | null = null;
    try {
      parsed = JSON.parse(payload) as { id?: string };
    } catch {
      parsed = null;
    }
    await db.from('webhook_deliveries').insert({
      account_id: accountId,
      endpoint_id: endpointId,
      event,
      event_id: parsed?.id ?? null,
      ok: result.ok,
      status_code: result.statusCode,
      duration_ms: result.durationMs,
      error: result.error,
      response_snippet: result.snippet,
      payload: parsed,
      resent_from: resentFrom,
    });
    if (Math.random() < PRUNE_PROBABILITY) {
      await db
        .from('webhook_deliveries')
        .delete()
        .lt(
          'created_at',
          new Date(
            Date.now() - DELIVERY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
          ).toISOString()
        );
    }
  } catch (err) {
    console.error('[webhooks] delivery log write failed:', err);
  }
}

async function recordFailure(db: SupabaseClient, row: EndpointRow): Promise<void> {
  // Atomic increment (+ auto-disable at the threshold) via a SQL
  // function - a read-modify-write here would lose increments when two
  // deliveries to the same endpoint run concurrently (e.g.
  // conversation.created + message.received for one inbound message),
  // so a dead endpoint might never reach the disable threshold.
  const { error } = await db.rpc('record_webhook_failure', {
    endpoint_id: row.id,
    max_failures: MAX_CONSECUTIVE_FAILURES,
  });
  if (error) {
    console.error('[webhooks] record_webhook_failure failed for', row.id, error);
  }
}
