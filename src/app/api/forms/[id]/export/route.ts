import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { FORM_COLUMNS } from '@/lib/forms/public-config'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { exportForm } from '@/lib/forms/portable'
import { FormError } from '@/lib/forms/server'
import type { FormRow } from '@/lib/forms/types'

/** The form as a JSON file (fields + settings). Any member can read forms; this is a read. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    const { data } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!data) throw new FormError('Form not found', 404)
    const doc = await exportForm(ctx.supabase, data as FormRow)
    const file = (data as FormRow).name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form'
    return new NextResponse(JSON.stringify(doc, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${file}.ogadesk-form.json"` },
    })
  } catch (err) {
    return formErrorResponse(err)
  }
}
