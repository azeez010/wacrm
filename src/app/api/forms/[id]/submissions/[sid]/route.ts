import { after, NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { setContactBlocked } from '@/lib/contacts/block-write'
import { FORM_COLUMNS } from '@/lib/forms/public-config'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { FormError } from '@/lib/forms/server'
import { reprocessSubmission } from '@/lib/forms/submit'
import type { FormRow } from '@/lib/forms/types'

type Ctx = Awaited<ReturnType<typeof requireRole>>

async function load(ctx: Ctx, formId: string, sid: string) {
  const { data: form } = await ctx.supabase.from('forms').select(FORM_COLUMNS).eq('id', formId).eq('account_id', ctx.accountId).maybeSingle()
  if (!form) throw new FormError('Form not found', 404)
  const { data: sub } = await ctx.supabase
    .from('form_submissions')
    .select('*')
    .eq('id', sid)
    .eq('form_id', formId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!sub) throw new FormError('Submission not found', 404)
  return { form: form as FormRow, sub }
}

/** spam | retry | release. Agents and above. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id, sid } = await params
    const body = (await request.json().catch(() => null)) as { action?: string; blockNumber?: boolean } | null
    const { form, sub } = await load(ctx, id, sid)

    if (body?.action === 'spam') {
      await ctx.supabase.from('form_submissions').update({ outcome: 'spam', reject_reason: 'marked_spam' }).eq('id', sid)
      if (body.blockNumber && sub.contact_id) {
        await setContactBlocked(supabaseAdmin(), {
          accountId: ctx.accountId,
          contactId: sub.contact_id,
          blocked: true,
          reason: 'manual',
          userId: ctx.userId,
        })
      }
      return NextResponse.json({ ok: true })
    }

    if (body?.action === 'retry' || body?.action === 'release') {
      const release = body.action === 'release'
      if (release && sub.outcome !== 'held') throw new FormError('Only held leads can be released', 400)
      if (!release && sub.outcome !== 'accepted') throw new FormError('Only accepted leads can be retried', 400)
      const admin = supabaseAdmin()
      if (release) await admin.from('form_submissions').update({ outcome: 'accepted' }).eq('id', sid)
      after(async () => {
        try {
          await reprocessSubmission(admin, form, sub, { onlyFailed: !release })
        } catch (err) {
          console.error('[forms] reprocess failed:', err)
        }
      })
      return NextResponse.json({ ok: true })
    }
    throw new FormError('Unknown action', 400)
  } catch (err) {
    return formErrorResponse(err)
  }
}

/** Delete one submission. Admins and above. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id, sid } = await params
    await load(ctx, id, sid)
    const { error } = await ctx.supabase.from('form_submissions').delete().eq('id', sid).eq('account_id', ctx.accountId)
    if (error) throw new FormError(error.message, 500)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return formErrorResponse(err)
  }
}
