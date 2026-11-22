import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getLimit } from '@/lib/billing/entitlements'
import { monthStartUtc } from '@/lib/billing/usage'
import { formErrorResponse } from '@/lib/forms/route-helpers'

/** Plan usage for the Forms list: forms used/allowed and leads this month. */
export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const [{ count }, formsLimit, leadsLimit, rpc] = await Promise.all([
      ctx.supabase.from('forms').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).is('archived_at', null),
      getLimit(ctx.supabase, ctx.accountId, 'forms_max'),
      getLimit(ctx.supabase, ctx.accountId, 'form_submissions_per_month'),
      supabaseAdmin().rpc('count_form_submissions', { p_account: ctx.accountId, p_since: monthStartUtc().toISOString() }),
    ])
    const counts = (rpc.data ?? {}) as { accepted?: number; held?: number }
    return NextResponse.json({
      planName: formsLimit.planName,
      forms: { used: count ?? 0, limit: formsLimit.limit },
      leads: { used: Number(counts.accepted ?? 0), held: Number(counts.held ?? 0), limit: leadsLimit.limit },
    })
  } catch (err) {
    return formErrorResponse(err)
  }
}
