// POST /api/partner/click { code } - count a visit on a partner's link.
// Public and best-effort: bad or unknown codes are ignored, the client sends
// it at most once per code per browser tab session.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { normalizeCode } from '@/lib/partner/code'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = normalizeCode(body?.code)
  if (code) await supabaseAdmin().rpc('partner_click', { p_code: code })
  return NextResponse.json({ ok: true })
}
