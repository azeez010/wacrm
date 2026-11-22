// GET/PATCH/DELETE /api/v1/segments/{id}
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, jsonBody, segCtx } from '@/lib/api/v1/custom-helpers'
import { deleteSegment, getSegment, updateSegment } from '@/lib/segments/server'

type P = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'segments:read')
    return envelope(await getSegment(segCtx(ctx), (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'segments:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    return envelope(await updateSegment(segCtx(ctx), (await params).id, body))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'segments:write')
    return envelope(await deleteSegment(segCtx(ctx), (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
