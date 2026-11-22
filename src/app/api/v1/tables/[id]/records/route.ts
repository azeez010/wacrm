// GET  /api/v1/tables/{id|key}/records - rows (search, limit, offset) (tables:read)
// POST /api/v1/tables/{id|key}/records - add a row: { values: { column_key: value } } (tables:write)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { createRecord, listRecords } from '@/lib/custom-fields/server'

type P = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:read')
    const url = new URL(request.url)
    return envelope(
      await listRecords(fieldCtx(ctx), (await params).id, {
        search: url.searchParams.get('search') ?? undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
        offset: Number(url.searchParams.get('offset')) || undefined,
      }),
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    const values = (body.values && typeof body.values === 'object' ? body.values : body) as Record<string, unknown>
    return envelope(await createRecord(fieldCtx(ctx), (await params).id, values), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
