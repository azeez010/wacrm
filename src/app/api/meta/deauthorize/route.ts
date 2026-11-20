import { NextResponse } from 'next/server'
import { parseSignedRequest } from '@/lib/meta/signed-request'
import { recordDeletionRequest } from '@/lib/meta/deletion-requests'

/**
 * Meta "Deauthorize Callback URL" - called when someone removes the app
 * from their Facebook settings. Verified, logged, acknowledged.
 *
 *   https://<your-domain>/api/meta/deauthorize
 *
 * We hold no Facebook profile data to remove; WhatsApp connections are
 * managed by the workspace owner in Settings → WhatsApp.
 */
export async function POST(request: Request) {
  let signedRequest: string | null = null
  try {
    const form = await request.formData()
    const v = form.get('signed_request')
    signedRequest = typeof v === 'string' ? v : null
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const payload = parseSignedRequest(signedRequest)
  if (!payload) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 })

  try {
    await recordDeletionRequest({
      source: 'meta_deauthorize',
      metaUserId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
    })
  } catch (err) {
    console.error('[meta/deauthorize] failed to log:', err)
  }
  return NextResponse.json({ ok: true })
}
