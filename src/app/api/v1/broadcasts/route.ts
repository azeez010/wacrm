// ============================================================
// POST /api/v1/broadcasts - launch a template broadcast
// (scope: broadcasts:send).
//
// Body:
//   {
//     "name": "July promo",                 // optional label
//     "template_name": "promo_july",        // required, approved template
//     "template_language": "en_US",         // optional (default en_US)
//     "recipients": [                        // required, 1..1000
//       { "to": "+14155550123", "params": ["Jane"] },
//       { "to": "+14155550124" }
//     ]
//   }
//
// Instead of `recipients`, target a saved segment or an ad hoc filter:
//   { "template_name": "...", "segment_id": "<id>" }      // or
//   { "template_name": "...", "filter": { ...FilterGroup } }
// optionally with "params": [...] shared by every recipient. The segment is
// evaluated at send time; it must match 1..1000 contacts.
//
// The broadcast + its recipient rows are persisted synchronously, then
// the Meta fan-out runs in `after()` so the request returns fast. Poll
// `GET /api/v1/broadcasts/{id}` for progress.
//
// Response (202):
//   { "data": { "broadcast_id", "status": "sending",
//               "total_recipients", "accepted", "rejected" } }
// ============================================================

import { after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';
import { assertMessageQuota } from '@/lib/billing/usage';

// The `after()` fan-out below sends to every recipient sequentially and
// runs within this route's max duration (the same constraint the
// webhook route documents). Give it headroom beyond the platform
// default so a modest batch isn't cut off mid-send - which would leave
// recipient rows 'pending' and the broadcast stuck 'sending'. This is a
// bound, not a guarantee: a near-cap (MAX_RECIPIENTS) audience can
// still exceed 60s, so very large sends should be split across
// requests. A durable queue/cron drain is the complete fix (follow-up).
export const maxDuration = 60;
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { loadSegmentFilter } from '@/lib/broadcast-audience';
import { filterContacts, segCtxFromKey } from '@/lib/segments/server';
import {
  createBroadcast,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const templateName =
      typeof body.template_name === 'string' ? body.template_name : '';
    let recipients: { to?: unknown; params?: unknown }[] = Array.isArray(body.recipients)
      ? body.recipients
      : [];

    // Segment / filter audience: expand to recipients now (dynamic).
    if (recipients.length === 0 && (body.segment_id || body.filter)) {
      const sc = segCtxFromKey(ctx);
      let filter: unknown = body.filter;
      if (!filter) {
        filter = await loadSegmentFilter(ctx.supabase, String(body.segment_id), ctx.accountId);
        if (!filter) return fail('not_found', 'Segment not found', 404);
      }
      const matched = await filterContacts(sc, filter, { limit: 100, offset: 0 });
      if (!matched.ok) return fail('bad_request', matched.error, matched.status);
      if (matched.data.total > 1000) {
        return fail(
          'bad_request',
          `The segment matches ${matched.data.total} contacts; a broadcast is limited to 1000. Narrow the filter.`,
          400
        );
      }
      const shared = Array.isArray(body.params) ? body.params : undefined;
      const phones: string[] = [];
      for (let offset = 0; offset < matched.data.total; offset += 100) {
        const page =
          offset === 0 ? matched : await filterContacts(sc, filter, { limit: 100, offset });
        if (!page.ok) return fail('internal', page.error, page.status);
        for (const c of page.data.contacts) phones.push(String(c.phone));
      }
      recipients = phones.map((to) => ({ to, params: shared }));
    }

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    // Every recipient is one billable template message: refuse up front if the
    // plan's monthly allowance can't cover the whole broadcast.
    await assertMessageQuota(ctx.supabase, ctx.accountId, recipients.length);

    const plan = await createBroadcast(ctx.supabase, ctx.accountId, auditUserId, {
      name: typeof body.name === 'string' ? body.name : null,
      templateName,
      templateLanguage:
        typeof body.template_language === 'string'
          ? body.template_language
          : null,
      recipients: recipients.map((r) => ({
        to: typeof r?.to === 'string' ? r.to : '',
        params: Array.isArray(r?.params) ? r.params : undefined,
      })),
    });

    // Fan out after the response is sent. Uses the same service-role
    // client - no request-scoped auth needed for the Meta calls or
    // the account-scoped row updates.
    after(() => deliverBroadcast(ctx.supabase, plan));

    return ok(
      {
        broadcast_id: plan.broadcastId,
        status: 'sending',
        total_recipients: plan.planned.length,
        accepted: plan.planned.length,
        rejected: plan.rejected,
        duplicates: plan.duplicates,
        blocked_skipped: plan.blockedSkipped ?? 0,
      },
      202
    );
  } catch (err) {
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
