/**
 * Hosted MCP endpoint (Streamable HTTP, stateless).
 *
 *   POST /api/mcp   Authorization: Bearer wacrm_live_…
 *
 * Auth is the same API key as the public API; its scopes decide which
 * tools exist (see lib/mcp/server.ts). A fresh server + transport is
 * built per request - no session state, safe on Workers isolates.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { requireApiKey } from '@/lib/auth/api-context'
import { toApiErrorResponse } from '@/lib/api/v1/respond'
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements'
import { createWacrmMcpServer } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

function withCors(res: Response): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v)
  return out
}

async function handle(request: Request): Promise<Response> {
  let ctx
  try {
    ctx = await requireApiKey(request)
  } catch (err) {
    const res = toApiErrorResponse(err)
    if (res.status === 401) res.headers.set('WWW-Authenticate', 'Bearer realm="wacrm"')
    return withCors(res)
  }

  try {
    await assertFeature(ctx.supabase, ctx.accountId, 'mcp')
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return withCors(
        Response.json({ error: { code: 'forbidden', message: err.message } }, { status: 402 }),
      )
    }
    throw err
  }

  // create_template only makes sense with a WhatsApp connection to submit under.
  let hasWhatsAppConnection = false
  if (ctx.scopes.includes('templates:write')) {
    const { count } = await ctx.supabase
      .from('whatsapp_config')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    hasWhatsAppConnection = (count ?? 0) > 0
  }

  const server = createWacrmMcpServer(request.headers.get('authorization') ?? '', ctx.scopes, {
    hasWhatsAppConnection,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return withCors(await transport.handleRequest(request))
}

export const POST = handle
export const GET = handle
export const DELETE = handle
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS })
