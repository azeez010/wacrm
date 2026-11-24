// ============================================================
// Shared webhook-endpoint management logic - used by both the public
// API (/api/v1/webhooks, API-key auth) and the dashboard
// (/api/account/webhooks, cookie auth) so validation, plan gating and
// secret handling cannot drift between them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { assertFeature, assertWithinLimit } from '@/lib/billing/entitlements';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  checkWebhookUrl,
  generateWebhookSecret,
  serializeWebhookEndpoint,
  type ApiWebhookEndpoint,
} from '@/lib/webhooks/endpoints';
import { normalizeEvents, type WebhookEvent } from '@/lib/webhooks/events';

const EVENTS_ERROR = "'events' must be a non-empty array of known event names";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseCreateInput(
  body: Record<string, unknown>
): ParseResult<{ url: string; events: WebhookEvent[] }> {
  const urlCheck = checkWebhookUrl(body.url);
  if (!urlCheck.ok) return { ok: false, message: urlCheck.message };
  const events = normalizeEvents(body.events);
  if (!events) return { ok: false, message: EVENTS_ERROR };
  return { ok: true, value: { url: urlCheck.url, events } };
}

export function parseUpdateInput(
  body: Record<string, unknown>
): ParseResult<Record<string, unknown>> {
  const updates: Record<string, unknown> = {};

  if ('url' in body) {
    const urlCheck = checkWebhookUrl(body.url);
    if (!urlCheck.ok) return { ok: false, message: urlCheck.message };
    updates.url = urlCheck.url;
  }

  if ('events' in body) {
    const events = normalizeEvents(body.events);
    if (!events) return { ok: false, message: EVENTS_ERROR };
    updates.events = events;
  }

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      return { ok: false, message: "'is_active' must be a boolean" };
    }
    updates.is_active = body.is_active;
    // Re-enabling a disabled endpoint clears its failure streak so it
    // isn't instantly re-disabled by a single stale failure.
    if (body.is_active === true) updates.failure_count = 0;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, message: 'No updatable fields provided' };
  }
  return { ok: true, value: updates };
}

/**
 * Plan-check, then insert an endpoint with a fresh signing secret.
 * Throws FeatureLockedError / PlanLimitError (callers map to 402).
 * Returns null when the insert fails. The plaintext secret is returned
 * here and nowhere else - it is shown to the creator exactly once.
 */
export async function createWebhookEndpoint(
  supabase: SupabaseClient,
  accountId: string,
  createdBy: string | null,
  input: { url: string; events: WebhookEvent[] }
): Promise<{ endpoint: ApiWebhookEndpoint; secret: string } | null> {
  await assertFeature(supabase, accountId, 'outbound_webhooks');
  const { count } = await supabase
    .from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  await assertWithinLimit(supabase, accountId, 'webhook_endpoints', count ?? 0);

  const secret = generateWebhookSecret();
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      account_id: accountId,
      created_by: createdBy,
      url: input.url,
      secret: encrypt(secret),
      events: input.events,
    })
    .select(WEBHOOK_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    console.error('[webhooks] create error:', error);
    return null;
  }
  return {
    endpoint: serializeWebhookEndpoint(data as Record<string, unknown>),
    secret,
  };
}
