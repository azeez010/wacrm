import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AGENT_COLUMNS } from '@/lib/ai/agents'
import { parseAgentInput } from '@/lib/ai/agent-input'
import { agentInputErrorResponse, isAccountMember } from '@/lib/ai/agent-route-helpers'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** Most agents a workspace may have; keeps routing and the UI sane. */
const MAX_AGENTS = 20

/**
 * GET /api/ai/agents  (any member)
 *
 * The account's AI agents, default first, each with how many library
 * sources it is linked to.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [agents, links] = await Promise.all([
      supabase
        .from('ai_agents')
        .select(`${AGENT_COLUMNS}, description, updated_at`)
        .eq('account_id', accountId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase.from('ai_agent_knowledge').select('agent_id').eq('account_id', accountId),
    ])
    if (agents.error) {
      console.error('[ai/agents GET] error:', agents.error)
      return NextResponse.json({ error: t('ai.agents.loadFailed') }, { status: 500 })
    }
    const counts = new Map<string, number>()
    for (const l of (links.data ?? []) as { agent_id: string }[]) {
      counts.set(l.agent_id, (counts.get(l.agent_id) ?? 0) + 1)
    }
    return NextResponse.json({
      agents: (agents.data ?? []).map((a) => ({
        ...a,
        source_count: counts.get((a as { id: string }).id) ?? 0,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * Create an agent. Provider and keys stay workspace-wide (ai_configs);
 * an agent only overrides the model.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseAgentInput(await request.json().catch(() => null), { partial: false })
    if ('error' in parsed) return agentInputErrorResponse(parsed.error)
    if (!(await isAccountMember(supabase, accountId, parsed.data.handoff_agent_id))) {
      return NextResponse.json({ error: t('ai.handoffNotMember') }, { status: 400 })
    }

    const { count } = await supabase
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_AGENTS) {
      return NextResponse.json(
        { error: t('ai.agents.limitReached', { max: MAX_AGENTS }) },
        { status: 400 },
      )
    }

    // The first agent in a workspace becomes its default.
    const { data, error } = await supabase
      .from('ai_agents')
      .insert({
        ...parsed.data,
        account_id: accountId,
        created_by: userId,
        is_default: (count ?? 0) === 0,
      })
      .select(`${AGENT_COLUMNS}, description, updated_at`)
      .single()
    if (error) {
      console.error('[ai/agents POST] error:', error)
      return NextResponse.json({ error: t('ai.agents.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ agent: { ...data, source_count: 0 } }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
