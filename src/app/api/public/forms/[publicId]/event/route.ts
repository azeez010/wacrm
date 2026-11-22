import { supabaseAdmin } from '@/lib/automations/admin-client'
import { corsJson, corsPreflight, isBotUserAgent } from '@/lib/forms/public-http'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export function OPTIONS() {
  return corsPreflight()
}

/** Funnel beacons: `view` (page seen / widget opened) and `start` (first keystroke). */
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ip = getClientIp(request)
  if (!checkRateLimit(`form-event:${ip}:${publicId}`, RATE_LIMITS.formEvent).success) {
    return corsJson({ ok: true })
  }
  // Bots and link previews never count as visitors.
  if (isBotUserAgent(request.headers.get('user-agent'))) return corsJson({ ok: true })

  const body = (await request.json().catch(() => null)) as { type?: string; visitorId?: string } | null
  const type = body?.type
  const visitorId = body?.visitorId?.trim()
  if ((type !== 'view' && type !== 'start') || !visitorId || visitorId.length < 8 || visitorId.length > 64) {
    return corsJson({ ok: false }, 400)
  }
  if (!/^[a-z0-9]{6,32}$/i.test(publicId)) return corsJson({ ok: false }, 404)

  const db = supabaseAdmin()
  const { data: form } = await db
    .from('forms')
    .select('id, account_id, status, archived_at')
    .eq('public_id', publicId)
    .maybeSingle()
  if (!form || form.archived_at || form.status !== 'active') return corsJson({ ok: false }, 404)

  // One view / start per visitor per 30 minutes keeps the table small and the funnel honest.
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const { count } = await db
    .from('form_events')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', form.id)
    .eq('visitor_id', visitorId)
    .eq('type', type)
    .gte('created_at', since)
  if ((count ?? 0) === 0) {
    await db.from('form_events').insert({ form_id: form.id, account_id: form.account_id, visitor_id: visitorId, type })
  }
  return corsJson({ ok: true })
}
