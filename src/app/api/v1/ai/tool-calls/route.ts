// GET /api/v1/ai/tool-calls (ai:read) - recent actions AI agents asked to run (newest first, ?status=pending_approval to see
// what waits for a teammate, ?conversation_id=). Read only: approving or rejecting stays a human step in the app.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'

const STATUSES = new Set(['pending_approval', 'proposed', 'approved', 'rejected', 'ok', 'error', 'expired'])

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    const q = new URL(request.url).searchParams
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50))
    let query = ctx.supabase
      .from('ai_tool_calls')
      .select('id, conversation_id, agent_id, integration_id, tool_name, mode, kind, summary, status, error, created_at, decided_at, expires_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(limit)
    const status = q.get('status')
    if (status) {
      if (!STATUSES.has(status)) return fail('bad_request', `status must be one of ${[...STATUSES].join(', ')}`, 400)
      query = query.eq('status', status)
    }
    const conv = q.get('conversation_id')
    if (conv) query = query.eq('conversation_id', conv)
    const { data, error } = await query
    if (error) return fail('internal', 'Failed to list AI tool calls', 500)
    return ok(data ?? [])
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
