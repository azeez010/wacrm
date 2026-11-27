// /api/integrations/google/start - GET: an admin clicked "Connect with Google". Checks the plan, then redirects to
// Google's consent screen with a signed state (account + admin, 10 minutes).

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { metaValue } from '@/lib/platform-config'
import { publicOrigin } from '@/lib/seo'
import { assertCanAddIntegration } from '@/lib/integrations/manage'
import { authUrl, signState } from '@/lib/integrations/google-oauth'
import { googleRedirectPath } from '@/lib/integrations/google-connect'
import { FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements'

export async function GET(request: Request) {
  const back = (reason: string) => NextResponse.redirect(`${publicOrigin(request)}/settings?tab=integrations&google=${reason}`)
  try {
    const ctx = await requireRole('admin')
    const db = supabaseAdmin()
    const reconnect = new URL(request.url).searchParams.get('reconnect') === '1'
    if (!reconnect) {
      try {
        await assertCanAddIntegration(db, ctx.accountId)
      } catch (e) {
        if (e instanceof PlanLimitError || e instanceof FeatureLockedError) return back('plan')
        throw e
      }
    }
    const clientId = await metaValue('GOOGLE_OAUTH_CLIENT_ID', db)
    const secret = process.env.ENCRYPTION_KEY
    if (!clientId || !secret) return back('not_configured')
    const state = await signState({ aid: ctx.accountId, uid: ctx.userId }, secret)
    return NextResponse.redirect(authUrl(clientId, `${publicOrigin(request)}${googleRedirectPath}`, state))
  } catch (err) {
    console.error('[google start]', err instanceof Error ? err.message : err)
    return back('error')
  }
}
