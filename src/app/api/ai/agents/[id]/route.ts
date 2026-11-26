import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AGENT_COLUMNS } from '@/lib/ai/agents'
import { parseAgentInput } from '@/lib/ai/agent-input'
import { agentInputErrorResponse, isAccountMember } from '@/lib/ai/agent-route-helpers'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ id: string }> }

const SELECT = `${AGENT_COLUMNS}, description, updated_at`

/** GET /api/ai/agents/[id]  (any member): the agent and its linked sources. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data: agent, error } = await supabase
      .from('ai_agents')
      .select(SELECT)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[ai/agents/:id GET] error:', error)
      return NextResponse.json({ error: t('ai.agents.loadFailed') }, { status: 500 })
    }
    if (!agent) return NextResponse.json({ error: t('ai.agents.notFound') }, { status: 404 })
    const { data: links } = await supabase
      .from('ai_agent_knowledge')
      .select('source_id')
      .eq('agent_id', id)
    return NextResponse.json({
      agent: {
        ...agent,
        source_ids: ((links ?? []) as { source_id: string }[]).map((l) => l.source_id),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/ai/agents/[id]  (admin+): update any subset of the fields. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const parsed = parseAgentInput(await request.json().catch(() => null), { partial: true })
    if ('error' in parsed) return agentInputErrorResponse(parsed.error)
    if (!(await isAccountMember(supabase, accountId, parsed.data.handoff_agent_id))) {
      return NextResponse.json({ error: t('ai.handoffNotMember') }, { status: 400 })
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ai_agents')
      .update(parsed.data)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT)
      .maybeSingle()
    if (error) {
      console.error('[ai/agents/:id PATCH] error:', error)
      return NextResponse.json({ error: t('ai.agents.saveFailed') }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: t('ai.agents.notFound') }, { status: 404 })
    return NextResponse.json({ agent: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/agents/[id]  (admin+). The default agent can't be deleted. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { data: agent } = await supabase
      .from('ai_agents')
      .select('id, is_default')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!agent) return NextResponse.json({ error: t('ai.agents.notFound') }, { status: 404 })
    if (agent.is_default) {
      return NextResponse.json({ error: t('ai.agents.defaultUndeletable') }, { status: 400 })
    }
    const { error } = await supabase.from('ai_agents').delete().eq('id', id).eq('account_id', accountId)
    if (error) {
      console.error('[ai/agents/:id DELETE] error:', error)
      return NextResponse.json({ error: t('ai.agents.deleteFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
