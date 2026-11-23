// ============================================================
// POST /api/v1/contacts/import - add many contacts at once (scope: contacts:write)
//
// Body (exactly one of csv / contacts):
//   { "csv": "phone,name,email,tags,plan\n+2348012345678,Ada,ada@x.com,vip;lagos,Gold" ,
//     "contacts": [ { "phone": "+2348012345678", "name": "Ada", "tags": ["vip"] } ],
//     "tags": ["spring-promo"],        // optional: added to every row
//     "dry_run": true }                // optional: validate only, change nothing
//
// Up to 500 rows per call. CSV columns: phone (required), name, email, company, tags
// (separate several with ; or |); any other column is a custom field key. Existing
// contacts keep their name, email and company; only tags and custom fields are added.
// Response: { summary: {total, created, existing, failed}, results: [{row, phone, status, error?}] }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { importContacts, rowsFromCsv, rowsFromList } from '@/lib/api/v1/contacts-import';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }
    const hasCsv = typeof body.csv === 'string';
    const hasList = body.contacts !== undefined;
    if (hasCsv === hasList) return fail('bad_request', "Send exactly one of 'csv' or 'contacts'", 400);

    const parsed = hasCsv ? rowsFromCsv(body.csv as string) : rowsFromList(body.contacts);
    if (!parsed.ok) return fail('bad_request', parsed.error, 400);

    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : [];
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const out = await importContacts(ctx.supabase, ctx.accountId, auditUserId, parsed.rows, {
      tags,
      dryRun: body.dry_run === true,
    });
    return ok(out);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
