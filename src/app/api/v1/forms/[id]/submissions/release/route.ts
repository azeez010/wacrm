// POST /api/v1/forms/{id}/submissions/release - accept the leads held over the plan quota (forms:manage).
// Releases as many as the plan has room for, oldest first, and runs the normal follow-up for each
// (contact, tags, notification, welcome message). Response: { released, still_held, reason }.
import { after } from 'next/server';

import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { FORM_COLUMNS } from '@/lib/forms/public-config';
import { releaseHeldLeads } from '@/lib/forms/release';
import type { FormRow } from '@/lib/forms/types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:manage');
    const { id } = await params;
    const { data } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle();
    const form = data as FormRow | null;
    if (!form) return fail('not_found', 'Form not found', 404);
    const result = await releaseHeldLeads(ctx.supabase, form);
    after(result.run);
    return ok({ released: result.released, still_held: result.stillHeld, reason: result.reason });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
