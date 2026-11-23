// POST /api/v1/forms/import - create a DRAFT form from an exported document (forms:manage).
// Body: the JSON from GET /forms/{id}/export. Response: { form, warnings } where warnings lists
// what could not be matched in this account (tags, custom fields, pipelines) and was skipped.
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { requireApiKey } from '@/lib/auth/api-context';
import { serializeForm } from '@/lib/forms/api';
import { importForm } from '@/lib/forms/portable';
import { FormError } from '@/lib/forms/server';
import { publicOrigin } from '@/lib/seo';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'forms:manage');
    const body = await request.json().catch(() => null);
    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { form, warnings } = await importForm(ctx.supabase, ctx.accountId, userId, body);
    return ok({ form: serializeForm(form, publicOrigin(request), true), warnings }, 201);
  } catch (err) {
    if (err instanceof FormError) return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    return toApiErrorResponse(err);
  }
}
