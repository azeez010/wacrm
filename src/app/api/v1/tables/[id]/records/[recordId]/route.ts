// PATCH/DELETE /api/v1/tables/{id|key}/records/{recordId} (scope: tables:write)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { deleteRecord, updateRecord } from '@/lib/custom-fields/server'

type P = { params: Promise<{ id: string; recordId: string }> }

export async function PATCH(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    const values = (body.values && typeof body.values === 'object' ? body.values : body) as Record<string, unknown>
    const { id, recordId } = await params
    return envelope(await updateRecord(fieldCtx(ctx), id, recordId, values))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const { id, recordId } = await params
    return envelope(await deleteRecord(fieldCtx(ctx), id, recordId))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
