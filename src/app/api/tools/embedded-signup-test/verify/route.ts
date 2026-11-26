// POST /api/tools/embedded-signup-test/verify?token=  { code, wabaId?, phoneNumberId? }
// Checks what Meta's signup popup returned, READ-ONLY: exchanges the code with the app id/secret, checks the
// resulting token with Meta's debug endpoint, and looks up the phone number with the system-user token.
// It never registers a number, subscribes a WABA, or writes to the database.
import { NextResponse } from 'next/server'

import { metaValue } from '@/lib/platform-config'
import { verifyTicket } from '@/lib/tools/ticket'

type Step = { name: string; ok: boolean | null; detail: string }
const graph = async (version: string, path: string, init?: RequestInit) => {
  const res = await fetch(`https://graph.facebook.com/${version}${path}`, init)
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}
const errText = (b: Record<string, unknown> | null, status: number) => ((b?.error as { message?: string } | undefined)?.message) ?? `HTTP ${status}`

export async function POST(request: Request) {
  const t = await verifyTicket(new URL(request.url).searchParams.get('token'), 'embedded-signup-test')
  if (!t.ok) return NextResponse.json({ error: 'invalid_ticket', reason: t.reason }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { code?: unknown; wabaId?: unknown; phoneNumberId?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code : ''
  const phoneNumberId = typeof body?.phoneNumberId === 'string' && /^\d{5,25}$/.test(body.phoneNumberId) ? body.phoneNumberId : ''
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const [appId, appSecret, systemToken, version] = await Promise.all([
    metaValue('META_APP_ID'), metaValue('META_APP_SECRET'), metaValue('META_SYSTEM_USER_ACCESS_TOKEN'), metaValue('META_GRAPH_API_VERSION'),
  ])
  const v = version || 'v21.0'
  const steps: Step[] = []
  if (!appId || !appSecret) {
    return NextResponse.json({ steps: [{ name: 'Exchange the code', ok: false, detail: 'META_APP_ID or META_APP_SECRET is not configured.' }] })
  }
  let userToken: string | null = null
  try {
    const params = new URLSearchParams({ client_id: appId, client_secret: appSecret.split(',')[0]!.trim(), code })
    const { res, body: b } = await graph(v, `/oauth/access_token?${params.toString()}`)
    userToken = typeof b?.access_token === 'string' ? b.access_token : null
    steps.push(res.ok && userToken ? { name: 'Exchange the code', ok: true, detail: 'Meta accepted the code with your app id and secret.' } : { name: 'Exchange the code', ok: false, detail: errText(b, res.status) })
  } catch (e) {
    steps.push({ name: 'Exchange the code', ok: false, detail: `Meta unreachable: ${e instanceof Error ? e.message : 'network error'}` })
  }
  if (userToken) {
    try {
      const params = new URLSearchParams({ input_token: userToken, access_token: `${appId}|${appSecret.split(',')[0]!.trim()}` })
      const { body: b } = await graph(v, `/debug_token?${params.toString()}`)
      const d = (b?.data ?? {}) as { is_valid?: boolean; app_id?: string; scopes?: string[] }
      const scopes = (d.scopes ?? []).filter((s) => s.startsWith('whatsapp'))
      steps.push(d.is_valid && d.app_id === appId
        ? { name: 'Token belongs to your app', ok: true, detail: `Valid. WhatsApp permissions granted: ${scopes.join(', ') || 'none listed'}.` }
        : { name: 'Token belongs to your app', ok: false, detail: errText(b, 200) })
    } catch {
      steps.push({ name: 'Token belongs to your app', ok: null, detail: 'Could not reach Meta to check the token.' })
    }
  }
  if (phoneNumberId) {
    if (!systemToken) {
      steps.push({ name: 'Look up the phone number', ok: null, detail: 'No system-user token configured, so the number cannot be looked up (customers\' shared connections would fail to send).' })
    } else {
      try {
        const { res, body: b } = await graph(v, `/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${systemToken}` } })
        steps.push(res.ok
          ? { name: 'Look up the phone number', ok: true, detail: `${String(b?.display_phone_number ?? phoneNumberId)} (${String(b?.verified_name ?? 'no verified name yet')}), quality ${String(b?.quality_rating ?? 'unknown')}.` }
          : { name: 'Look up the phone number', ok: false, detail: `The system-user token cannot see this number yet: ${errText(b, res.status)}` })
      } catch {
        steps.push({ name: 'Look up the phone number', ok: null, detail: 'Could not reach Meta.' })
      }
    }
  }
  const res = NextResponse.json({ steps })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
