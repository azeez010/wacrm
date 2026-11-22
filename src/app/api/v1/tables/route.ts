// GET  /api/v1/tables - custom tables (scope: tables:read)
// POST /api/v1/tables - create a table with its columns in one call (tables:write)
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, fieldCtx, jsonBody } from '@/lib/api/v1/custom-helpers'
import { createTable, listTables } from '@/lib/custom-fields/server'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tables:read')
    return envelope(await listTables(fieldCtx(ctx)))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tables:write')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    return envelope(await createTable(fieldCtx(ctx), body), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
