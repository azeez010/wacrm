// PATCH  /api/v1/custom-fields/{id} - rename, reorder, archive, show_in_table... (fields:write)
// DELETE /api/v1/custom-fields/{id} - delete (archives when values exist; ?purge=true erases)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { deleteField, updateField } from '@/lib/custom-fields/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'fields:write')
    const { id } = await params
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    return envelope(await updateField(fieldCtx(ctx), id, body))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'fields:write')
    const { id } = await params
    const purge = new URL(request.url).searchParams.get('purge') === 'true'
    return envelope(await deleteField(fieldCtx(ctx), id, { purge }))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
