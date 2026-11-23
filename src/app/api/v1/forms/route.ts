// GET  /api/v1/forms  - the account's lead forms and support buttons (forms:read)
// POST /api/v1/forms  - create one from a template                   (forms:manage)
import { publicOrigin } from '@/lib/seo';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { serializeForm } from '@/lib/forms/api';
import { createFormFromTemplate, FormError } from '@/lib/forms/server';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'forms:read');
    const { data, error } = await ctx.supabase
      .from('forms')
      .select('id, public_id, kind, name, status, created_at, updated_at')
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) return fail('internal', 'Failed to list forms', 500);
    const origin = publicOrigin(request);
    return ok((data ?? []).map((f) => serializeForm(f, origin)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'forms:manage');
    const b = (await request.json().catch(() => null)) as { template?: unknown; name?: unknown } | null;
    const template = typeof b?.template === 'string' ? b.template : 'blank';
    const name = typeof b?.name === 'string' ? b.name : undefined;
    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const form = await createFormFromTemplate(ctx.supabase, ctx.accountId, userId, { template, name });
    return ok(serializeForm(form, publicOrigin(request), true), 201);
  } catch (err) {
    if (err instanceof FormError) return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    return toApiErrorResponse(err);
  }
}
