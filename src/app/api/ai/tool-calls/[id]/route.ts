// /api/ai/tool-calls/[id] - POST { decision: 'approve' | 'reject' }
// A teammate decides on an action the AI asked for in a conversation. Approve runs it now and the AI sends the
// customer a short follow-up with the outcome (e.g. the payment link). Reject runs nothing.

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAgentConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { loadPlatformPrompt, personaPrompt } from '@/lib/ai/persona'
import { runGeneration } from '@/lib/ai/run'
import { decideToolCall, followUpInstruction } from '@/lib/ai/tools/approval'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const rl = checkRateLimit(`ai:toolDecision:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return rateLimitResponse(rl)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { decision?: unknown } | null
    const decision = body?.decision
    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const out = await decideToolCall(db, { accountId: ctx.accountId, callId: id, userId: ctx.userId, decision })
    if (out.status === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (out.status === 'conflict') return NextResponse.json({ error: 'Someone already decided on this action.' }, { status: 409 })
    if (out.status === 'expired') return NextResponse.json({ error: 'This request expired.', status: 'expired' }, { status: 410 })
    if (out.status === 'rejected') return NextResponse.json({ status: 'rejected' })

    // Approved (ran, or failed): the AI tells the customer. Best-effort - the teammate sees the result either way.
    let followUpSent = false
    if (out.conversationId) {
      try {
        followUpSent = await sendFollowUp(db, ctx.accountId, ctx.userId, out.conversationId, followUpInstruction(out.toolName, out.result, out.status === 'approved'))
      } catch (e) {
        console.error('[ai tool decision] follow-up failed:', e instanceof Error ? e.message : e)
      }
    }
    return NextResponse.json({ status: out.status, result: out.result, followUpSent })
  } catch (err) {
    return toErrorResponse(err)
  }
}

async function sendFollowUp(db: ReturnType<typeof supabaseAdmin>, accountId: string, userId: string, conversationId: string, instruction: string): Promise<boolean> {
  const { data: conv } = await db.from('conversations').select('contact_id, channel, ai_agent_id').eq('id', conversationId).eq('account_id', accountId).maybeSingle()
  if (!conv) return false
  const config = await loadAgentConfig(db, accountId, { conversationAgentId: conv.ai_agent_id ?? null, channel: conv.channel ?? 'whatsapp' })
  if (!config) return false
  const messages = await buildConversationContext(db, conversationId)
  if (messages.length === 0) return false
  const platform = personaPrompt(await loadPlatformPrompt(db), config.persona, config.agentName)
  const systemPrompt = `${buildSystemPrompt({ userPrompt: config.systemPrompt, mode: 'auto_reply', platform })}\n\n${instruction}`
  const { text } = await runGeneration(db, { config, systemPrompt, messages, accountId, conversationId, mode: 'auto_reply', agentId: config.agentId ?? null })
  if (!text) return false
  await engineSendText({ accountId, userId, conversationId, contactId: conv.contact_id, text, aiGenerated: true, aiAgentId: config.agentId ?? null })
  return true
}
