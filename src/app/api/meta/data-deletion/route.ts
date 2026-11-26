import { NextResponse } from 'next/server'
import { metaValue, splitList } from '@/lib/platform-config'
import { parseSignedRequest } from '@/lib/meta/signed-request'
import { publicBaseUrl, recordDeletionRequest } from '@/lib/meta/deletion-requests'

/**
 * Meta "Data Deletion Request Callback URL".
 *
 * Configure in Meta → App settings → Advanced / Facebook Login → Settings:
 *   https://<your-domain>/api/meta/data-deletion
 *
 * Meta POSTs `signed_request` (form-encoded). We verify it, record the
 * request, and answer with the status URL + confirmation code Meta shows
 * to the person.
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

  const payload = parseSignedRequest(signedRequest, splitList(await metaValue('META_APP_SECRET')))
  if (!payload) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 })

  try {
    const code = await recordDeletionRequest({
      source: 'meta_callback',
      metaUserId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
    })
    return NextResponse.json({
      url: `${publicBaseUrl(request)}/data-deletion?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    })
  } catch (err) {
    console.error('[meta/data-deletion] failed to record request:', err)
    return NextResponse.json({ error: 'Could not record the request' }, { status: 500 })
  }
}
