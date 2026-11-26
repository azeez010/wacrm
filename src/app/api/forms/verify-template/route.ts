import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { FormError } from '@/lib/forms/server'
import { ensureOtpTemplate } from '@/lib/onboarding/otp-template'

/** Submit the default verification-code (Authentication) template to Meta for this account. Admins and above. */
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const db = supabaseAdmin()
    const { data: configs } = await db.from('whatsapp_config').select('id').eq('account_id', ctx.accountId).limit(1)
    const configId = (configs?.[0] as { id: string } | undefined)?.id
    if (!configId) throw new FormError('Connect a WhatsApp number first', 400)
    const result = await ensureOtpTemplate(db, ctx.accountId, configId)
    if ('error' in result) throw new FormError(result.error, 502)
    return NextResponse.json({ created: result.created, status: result.status })
  } catch (err) {
    return formErrorResponse(err)
  }
}
