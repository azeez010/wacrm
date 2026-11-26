// GET  /api/v1/forms/{id}/submissions  - read leads (scope forms:read)
// POST /api/v1/forms/{id}/submissions  - submit a lead server-to-server (scope forms:write)
import { after } from 'next/server';

import { buildPage, keysetFilter, parseListParams } from '@/lib/api/v1/pagination';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { FORM_COLUMNS } from '@/lib/forms/public-config';
import { submitForm } from '@/lib/forms/submit';
import type { FormRow } from '@/lib/forms/types';

async function loadForm(ctx: Awaited<ReturnType<typeof requireApiKey>>, id: string): Promise<FormRow | null> {
  const { data } = await ctx.supabase
    .from('forms')
    .select(FORM_COLUMNS)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  const row = data as FormRow | null;
  return row && !row.archived_at ? row : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:read');
    const { id } = await params;
    if (!(await loadForm(ctx, id))) return fail('not_found', 'Form not found', 404);
    const { limit, cursor } = parseListParams(request);
    let query = ctx.supabase
      .from('form_submissions')
      .select('id, contact_id, answers, score, qualified, outcome, utm, country, referrer, created_at')
      .eq('form_id', id)
      .eq('account_id', ctx.accountId)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);
    const { data, error } = await query;
    if (error) return fail('internal', 'Failed to list submissions', 500);
    const { items, nextCursor } = buildPage((data ?? []) as unknown as Array<{ created_at: string; id: string }>, limit);
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'forms:write');
    const { id } = await params;
    const form = await loadForm(ctx, id);
    if (!form) return fail('not_found', 'Form not found', 404);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return fail('bad_request', 'Request body must be a JSON object', 400);

    // Same pipeline as the public page. No bot checks apply: this is a trusted server.
    const out = await submitForm(ctx.supabase, form, { ...body, elapsedMs: undefined, website: undefined }, { source: 'api' });
    if (out.finish) {
      const run = out.finish;
      after(async () => {
        try {
          await run();
        } catch (err) {
          console.error('[api/v1/forms] side effects failed:', err);
        }
      });
    }
    const r = out.result;
    if (r.status === 'ok') return ok({ accepted: true, held: r.held }, 202);
    if (r.status === 'invalid') return fail('bad_request', `Invalid answers: ${JSON.stringify(r.errors)}`, 400);
    if (r.status === 'gated') return fail('bad_request', 'Entry was not accepted (not qualified)', 422);
    if (r.status === 'closed') return fail('bad_request', 'This form is closed', 410);
    if (r.status === 'not_found') return fail('not_found', 'Form not found', 404);
    if (r.status === 'verification_required') return fail('bad_request', 'Verification required', 400);
    return fail('internal', 'This form is not accepting leads right now', 503);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
