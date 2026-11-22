import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { FORM_COLUMNS } from '@/lib/forms/public-config'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { assertFeature } from '@/lib/billing/entitlements'
import { buildFormUpdate, FormError, usesAdvancedFeatures, type FormPatch } from '@/lib/forms/server'
import type { FormRow } from '@/lib/forms/types'

async function loadOwned(ctx: Awaited<ReturnType<typeof requireRole>>, id: string): Promise<FormRow> {
  const { data } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
  if (!data) throw new FormError('Form not found', 404)
  return data as FormRow
}

/** Edit a form (name, status, fields, settings). Agents and above. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const current = await loadOwned(ctx, id)
    const body = (await request.json().catch(() => null)) as FormPatch | null
    if (!body) throw new FormError('Invalid JSON', 400)
    const update = buildFormUpdate(current, body)
    if (update.settings && usesAdvancedFeatures(update.settings as never)) {
      await assertFeature(ctx.supabase, ctx.accountId, 'forms_advanced')
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ form: current })
    const { data, error } = await ctx.supabase
      .from('forms')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(FORM_COLUMNS)
      .single()
    if (error || !data) throw new FormError(error?.message ?? 'Could not save', 500)
    return NextResponse.json({ form: data })
  } catch (err) {
    return formErrorResponse(err)
  }
}

/** Archive a form (its leads stay). Admins and above. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await loadOwned(ctx, id)
    const { error } = await ctx.supabase
      .from('forms')
      .update({ archived_at: new Date().toISOString(), status: 'paused' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) throw new FormError(error.message, 500)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return formErrorResponse(err)
  }
}
