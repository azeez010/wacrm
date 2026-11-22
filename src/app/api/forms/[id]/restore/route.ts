import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { assertCanCreateForm, FormError } from '@/lib/forms/server'

/** Bring an archived form back. It returns as Paused (never live by surprise) and counts against the plan again. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const { data: form } = await ctx.supabase.from('forms').select('id, archived_at').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!form) throw new FormError('Form not found', 404)
    if (!form.archived_at) throw new FormError('This form is not archived', 400)
    await assertCanCreateForm(ctx.supabase, ctx.accountId)
    const { error } = await ctx.supabase.from('forms').update({ archived_at: null, status: 'paused' }).eq('id', id).eq('account_id', ctx.accountId)
    if (error) throw new FormError(error.message, 500)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return formErrorResponse(err)
  }
}
