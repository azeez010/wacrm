import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { safeEqual } from '@/lib/crm/secret'

// Brevo -> us: when someone unsubscribes, complains or hard-bounces in Brevo, turn
// off their marketing opt-in here so the app and the CRM agree.
// Set the webhook URL in Brevo to  /api/crm/webhooks/brevo?token=$BREVO_WEBHOOK_TOKEN
const STOP_EVENTS = new Set(['unsubscribe', 'unsubscribed', 'spam', 'complaint', 'hard_bounce', 'hardbounce', 'blocked'])

export async function POST(request: Request) {
  const expected = process.env.BREVO_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: 'BREVO_WEBHOOK_TOKEN is not set' }, { status: 503 })
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!safeEqual(token, expected)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { event?: unknown; email?: unknown } | null
  const event = typeof body?.event === 'string' ? body.event.toLowerCase() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !STOP_EVENTS.has(event)) return NextResponse.json({ ok: true, changed: false })

  const { error } = await supabaseAdmin()
    .from('profiles')
    .update({ marketing_opt_in: false, marketing_opt_in_at: null })
    .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
    .eq('marketing_opt_in', true)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ ok: true, changed: true })
}
