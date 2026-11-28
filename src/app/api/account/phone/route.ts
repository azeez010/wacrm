// /api/account/phone - the signed-in user's own WhatsApp number (shown in Settings → Profile, first asked in onboarding).
//   PUT { phone: "+2348012345678" | null }  → { phone }     (null / empty clears it)
// Per person (any role). The change is synced to the CRM so the contact's number follows it.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { crmSyncUser } from '@/lib/crm'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

export async function PUT(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as { phone?: unknown } | null
    if (!body || !('phone' in body)) return NextResponse.json({ error: 'phone is required (or null to clear it)' }, { status: 400 })

    let phone: string | null = null
    if (body.phone !== null && body.phone !== '') {
      const digits = typeof body.phone === 'string' ? parseInternationalPhone(body.phone) : null
      if (!digits) return NextResponse.json({ error: 'Enter the number with + and country code, e.g. +2348012345678' }, { status: 400 })
      phone = `+${digits}`
    }

    const { error } = await supabaseAdmin().from('profiles').update({ phone }).eq('user_id', ctx.userId)
    if (error) {
      console.error('[phone] update failed:', error.message)
      return NextResponse.json({ error: 'Could not save' }, { status: 500 })
    }
    await crmSyncUser(ctx.userId)
    return NextResponse.json({ phone })
  } catch (err) {
    return toErrorResponse(err)
  }
}
