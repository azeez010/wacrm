// GET /api/v1/ai/integrations (ai:read) - connected integrations (MCP servers, HTTP tools, Google Calendar,
// Paystack) and the tools each gives AI agents. Credentials and connection settings are never returned;
// integrations are connected in the app.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    const [ints, tools] = await Promise.all([
      ctx.supabase.from('integrations').select('id, kind, name, status, last_ok_at, last_error, created_at').eq('account_id', ctx.accountId).order('created_at'),
      ctx.supabase.from('integration_tools').select('id, integration_id, name, title, description, enabled, auto_approve').eq('account_id', ctx.accountId).order('name'),
    ])
    if (ints.error || tools.error) return fail('internal', 'Failed to list integrations', 500)
    const by = new Map<string, unknown[]>()
    for (const t of (tools.data ?? []) as { integration_id: string }[]) by.set(t.integration_id, [...(by.get(t.integration_id) ?? []), t])
    return ok(((ints.data ?? []) as { id: string }[]).map((i) => ({ ...i, tools: by.get(i.id) ?? [] })))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
