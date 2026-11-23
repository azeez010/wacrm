// POST /api/partner/attribute - link the signed-in user to the partner whose
// ?ref= link they arrived with (cookie `ogadesk_ref`). Called once from the
// dashboard shell; the cookie is cleared either way so it never repeats.

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { REFERRAL_COOKIE } from '@/lib/referral'
import { attributeReferral } from '@/lib/partner/attribute'

export async function POST() {
  try {
    const ctx = await getCurrentAccount()
    const jar = await cookies()
    const code = jar.get(REFERRAL_COOKIE)?.value
    if (!code) return NextResponse.json({ ok: true, result: 'no_cookie' })

    const result = await attributeReferral(supabaseAdmin(), { userId: ctx.userId, accountId: ctx.accountId, code })
    jar.delete(REFERRAL_COOKIE)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
