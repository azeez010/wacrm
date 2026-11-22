// GET/PATCH/DELETE /api/v1/tables/{id|key} - one table and its columns.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { deleteTable, getTable, updateTable } from '@/lib/custom-fields/server'

type P = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:read')
    return envelope(await getTable(fieldCtx(ctx), (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    const fc = fieldCtx(ctx)
    const found = await getTable(fc, (await params).id)
    if (!found.ok) return envelope(found)
    return envelope(await updateTable(fc, found.data.table.id, body))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: P) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const fc = fieldCtx(ctx)
    const found = await getTable(fc, (await params).id)
    if (!found.ok) return envelope(found)
    return envelope(await deleteTable(fc, found.data.table.id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
