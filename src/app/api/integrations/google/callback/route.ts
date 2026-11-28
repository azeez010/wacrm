// /api/integrations/google/callback - Google sends the admin back here. The state must be valid, unexpired and
// belong to the signed-in admin's current workspace; then the code is exchanged for a refresh token (stored
// encrypted) and the calendar tools are added.

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { metaValue } from '@/lib/platform-config'
import { publicOrigin } from '@/lib/seo'
import { exchangeCode, verifyState } from '@/lib/integrations/google-oauth'
import { googleRedirectPath, saveGoogleConnection } from '@/lib/integrations/google-connect'

export async function GET(request: Request) {
  const origin = publicOrigin(request)
  const back = (reason: string) => NextResponse.redirect(`${origin}/integrations?google=${reason}`)
  try {
    const url = new URL(request.url)
    if (url.searchParams.get('error')) return back('denied')
    const code = url.searchParams.get('code')
    const secret = process.env.ENCRYPTION_KEY
    const state = secret ? await verifyState(url.searchParams.get('state') ?? '', secret) : null
    if (!code || !state) return back('expired')

    const ctx = await requireRole('admin')
    if (ctx.accountId !== state.aid || ctx.userId !== state.uid) return back('expired')

    const db = supabaseAdmin()
    const [clientId, clientSecret] = await Promise.all([metaValue('GOOGLE_OAUTH_CLIENT_ID', db), metaValue('GOOGLE_OAUTH_CLIENT_SECRET', db)])
    if (!clientId || !clientSecret) return back('not_configured')

    const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri: `${origin}${googleRedirectPath}` })
    if (!/calendar\.events/.test(tokens.scope)) return back('scopes')
    const { data: acct } = await db.from('accounts').select('timezone').eq('id', ctx.accountId).maybeSingle()
    const saved = await saveGoogleConnection(db, {
      accountId: ctx.accountId, userId: ctx.userId, email: tokens.email, refreshToken: tokens.refreshToken, timezone: (acct?.timezone as string | null) ?? null,
    })
    return back(saved.reconnected ? 'reconnected' : 'connected')
  } catch (err) {
    console.error('[google callback]', err instanceof Error ? err.message : err)
    return back('error')
  }
}
