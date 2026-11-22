// POST /api/v1/contacts/filter - contacts matching an ad hoc filter, no
// segment needed. Body: { filter, search?, limit?, offset?, count_only? }.
// Scope: contacts:read.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { envelope, jsonBody, segCtx } from '@/lib/api/v1/custom-helpers'
import { countFilter, filterContacts } from '@/lib/segments/server'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read')
    const body = await jsonBody(request)
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)
    const c = segCtx(ctx)
    if (body.count_only === true) return envelope(await countFilter(c, body.filter))
    return envelope(
      await filterContacts(c, body.filter, {
        search: typeof body.search === 'string' ? body.search : undefined,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
        offset: typeof body.offset === 'number' ? body.offset : undefined,
      }),
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
