import { after, NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { FORM_COLUMNS } from '@/lib/forms/public-config'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { releaseHeldLeads } from '@/lib/forms/release'
import { FormError } from '@/lib/forms/server'
import type { FormRow } from '@/lib/forms/types'

/** Release every held lead of this form that the plan has room for. Agents and above. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const { data: form } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!form) throw new FormError('Form not found', 404)
    const result = await releaseHeldLeads(supabaseAdmin(), form as FormRow)
    after(result.run)
    return NextResponse.json({ released: result.released, still_held: result.stillHeld, reason: result.reason })
  } catch (err) {
    return formErrorResponse(err)
  }
}
