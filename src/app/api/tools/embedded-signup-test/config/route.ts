// GET /api/tools/embedded-signup-test/config?token=  (admin-issued ticket, see lib/tools/ticket.ts)
// The non-secret ids the test page needs to open Meta's signup popup. Never returns a secret.
import { NextResponse } from 'next/server'

import { metaValue } from '@/lib/platform-config'
import { verifyTicket } from '@/lib/tools/ticket'

export async function GET(request: Request) {
  const t = await verifyTicket(new URL(request.url).searchParams.get('token'), 'embedded-signup-test')
  if (!t.ok) return NextResponse.json({ error: 'invalid_ticket', reason: t.reason }, { status: 401 })
  const [appId, configId, version, coexConfig, coexType] = await Promise.all([
    metaValue('META_APP_ID'), metaValue('META_WHATSAPP_CONFIG_ID'), metaValue('META_GRAPH_API_VERSION'),
    metaValue('META_WHATSAPP_COEXISTENCE_CONFIG_ID'), metaValue('META_WHATSAPP_COEXISTENCE_FEATURE_TYPE'),
  ])
  const res = NextResponse.json({
    configured: !!appId && !!configId, appId: appId ?? null, configId: configId ?? null, graphApiVersion: version || 'v21.0',
    coexistenceConfigId: coexConfig ?? null, coexistenceFeatureType: coexType || 'whatsapp_business_app_onboarding',
    missing: [!appId && 'META_APP_ID', !configId && 'META_WHATSAPP_CONFIG_ID'].filter(Boolean),
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
