import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { FORM_COLUMNS } from '@/lib/forms/public-config'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { assertCanCreateForm, FormError, publicId } from '@/lib/forms/server'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const { data: src } = await ctx.supabase.from('forms').select('*').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!src) throw new FormError('Form not found', 404)
    await assertCanCreateForm(ctx.supabase, ctx.accountId)
    const { data, error } = await ctx.supabase
      .from('forms')
      .insert({
        account_id: ctx.accountId,
        public_id: publicId(),
        kind: src.kind,
        name: `${src.name} (copy)`.slice(0, 120),
        status: 'draft',
        fields: src.fields,
        settings: src.settings,
        created_by: ctx.userId,
      })
      .select(FORM_COLUMNS)
      .single()
    if (error || !data) throw new FormError(error?.message ?? 'Could not duplicate', 500)
    return NextResponse.json({ form: data }, { status: 201 })
  } catch (err) {
    return formErrorResponse(err)
  }
}
