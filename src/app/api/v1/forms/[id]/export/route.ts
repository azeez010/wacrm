// GET /api/v1/forms/{id}/export - the form as a portable JSON document (forms:read).
// Pass the document to POST /api/v1/forms/import (here or in another account).
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { FORM_COLUMNS } from '@/lib/forms/public-config';
import { exportForm } from '@/lib/forms/portable';
import type { FormRow } from '@/lib/forms/types';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:read');
    const { id } = await params;
    const { data } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle();
    if (!data) return fail('not_found', 'Form not found', 404);
    return ok(await exportForm(ctx.supabase, data as FormRow));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
