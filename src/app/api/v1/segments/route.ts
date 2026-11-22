// GET  /api/v1/segments - saved segments (scope: segments:read)
// POST /api/v1/segments - create { name, filter } (scope: segments:write)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, jsonBody, segCtx } from '@/lib/api/v1/custom-helpers'
import { createSegment, listSegments } from '@/lib/segments/server'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'segments:read')
    return envelope(await listSegments(segCtx(ctx)))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'segments:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    return envelope(await createSegment(segCtx(ctx), body), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
