// GET    /api/v1/forms/{id}  - the full definition        (forms:read)
// PATCH  /api/v1/forms/{id}  - name, status, fields, settings (forms:manage)
// DELETE /api/v1/forms/{id}  - archive (leads are kept)  (forms:manage)
import { publicOrigin } from '@/lib/seo';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { assertFeature } from '@/lib/billing/entitlements';
import { serializeForm } from '@/lib/forms/api';
import { FORM_COLUMNS } from '@/lib/forms/public-config';
import { buildFormUpdate, FormError, usesAdvancedFeatures, type FormPatch } from '@/lib/forms/server';
import type { FormRow } from '@/lib/forms/types';

type Ctx = Awaited<ReturnType<typeof requireApiKey>>;

async function load(ctx: Ctx, id: string): Promise<FormRow | null> {
  const { data } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle();
  const row = data as FormRow | null;
  return row && !row.archived_at ? row : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:read');
    const { id } = await params;
    const form = await load(ctx, id);
    if (!form) return fail('not_found', 'Form not found', 404);
    return ok(serializeForm(form, publicOrigin(request), true));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:manage');
    const { id } = await params;
    const current = await load(ctx, id);
    if (!current) return fail('not_found', 'Form not found', 404);
    const body = (await request.json().catch(() => null)) as FormPatch | null;
    if (!body || typeof body !== 'object') return fail('bad_request', 'Request body must be a JSON object', 400);
    const update = buildFormUpdate(current, body);
    if (update.settings && usesAdvancedFeatures(update.settings as never)) {
      await assertFeature(ctx.supabase, ctx.accountId, 'forms_advanced');
    }
    if (Object.keys(update).length === 0) return ok(serializeForm(current, publicOrigin(request), true));
    const { data, error } = await ctx.supabase
      .from('forms')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(FORM_COLUMNS)
      .single();
    if (error || !data) return fail('internal', 'Failed to save the form', 500);
    return ok(serializeForm(data as FormRow, publicOrigin(request), true));
  } catch (err) {
    if (err instanceof FormError) return fail('bad_request', err.message, err.status);
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:manage');
    const { id } = await params;
    if (!(await load(ctx, id))) return fail('not_found', 'Form not found', 404);
    const { error } = await ctx.supabase
      .from('forms')
      .update({ archived_at: new Date().toISOString(), status: 'paused' })
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) return fail('internal', 'Failed to archive the form', 500);
    return ok({ archived: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
