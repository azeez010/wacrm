// GET /api/v1/ai/agent-templates (ai:read) - starting points for a new agent (support, sales, marketing, admin).
import { requireApiKey } from '@/lib/auth/api-context'
import { agentTemplates } from '@/lib/ai/service'
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    await requireApiKey(request, 'ai:read')
    return ok(agentTemplates())
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
