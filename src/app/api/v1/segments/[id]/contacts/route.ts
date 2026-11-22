// GET /api/v1/segments/{id}/contacts - contacts currently matching the segment
// (re-evaluated now), with `total`. ?limit (max 100) & ?offset. Scope: segments:read.
import { requireApiKey } from '@/lib/auth/api-context'
import { toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, segCtx } from '@/lib/api/v1/custom-helpers'
import { filterContacts, getSegment } from '@/lib/segments/server'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'segments:read')
    const c = segCtx(ctx)
    const seg = await getSegment(c, (await params).id)
    if (!seg.ok) return envelope(seg)
    const url = new URL(request.url)
    return envelope(
      await filterContacts(c, seg.data.filter, {
        limit: Number(url.searchParams.get('limit')) || undefined,
        offset: Number(url.searchParams.get('offset')) || undefined,
      }),
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
