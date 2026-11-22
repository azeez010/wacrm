// GET  /api/v1/custom-fields  - custom contact field definitions (scope: fields:read)
// POST /api/v1/custom-fields  - create a field (scope: fields:write)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { createField, listFields } from '@/lib/custom-fields/server'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'fields:read')
    const includeArchived = new URL(request.url).searchParams.get('include_archived') === 'true'
    return envelope(await listFields(fieldCtx(ctx), { includeArchived }))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'fields:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    return envelope(await createField(fieldCtx(ctx), body), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
