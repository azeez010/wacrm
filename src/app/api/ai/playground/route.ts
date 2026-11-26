import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAgentConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { runGeneration } from '@/lib/ai/run'
import { loadToolRuntime } from '@/lib/ai/tools/registry'
import { loadPlatformPrompt, personaPrompt } from '@/lib/ai/persona'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { buildRetrievalQuery } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses - knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider - so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: t('ai.messagesRequired') }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: t('ai.sendMessageToTest') },
        { status: 400 },
      )
    }

    // Test one agent (any state) when the body names it; otherwise the
    // default agent.
    const agentId = typeof body?.agent_id === 'string' && body.agent_id ? body.agent_id : null
    const config = await loadAgentConfig(
      supabase,
      accountId,
      agentId ? { agentId } : { defaultAgent: true },
      { requireActive: false },
    ).catch((err) => {
      console.error('[ai/playground] loadAgentConfig error:', err)
      throw new AiError(t('ai.storedKeyUndecryptable'), {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: t('ai.noAgentConfigured'),
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      buildRetrievalQuery(messages),
      { sourceIds: config.knowledgeSourceIds ?? null },
    )
    const platform = personaPrompt(await loadPlatformPrompt(supabaseAdmin()), config.persona, config.agentName)
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      platform,
    })

    // Same path as the live bot (own key, or the platform chain). Platform playground calls use credits like real ones.
    // Read tools really run; actions are only described ("would run"). The calls are returned so the tester sees them.
    const toolCalls: { name: string; arguments: Record<string, unknown>; result: string; isError: boolean }[] = []
    const runtime = await loadToolRuntime(supabaseAdmin(), {
      accountId, conversationId: null, agentId: config.agentId ?? null, mode: 'playground', allowedIntegrations: config.toolIntegrations ?? null,
    })
    const tools = runtime && {
      ...runtime,
      execute: async (call: Parameters<typeof runtime.execute>[0]) => {
        const out = await runtime.execute(call)
        toolCalls.push({ name: call.name, arguments: call.arguments, result: out.content.slice(0, 1000), isError: !!out.isError })
        return out
      },
    }
    const { text, handoff } = await runGeneration(supabaseAdmin(), {
      config, systemPrompt, messages, accountId, conversationId: null, mode: 'playground', agentId: config.agentId ?? null, tools,
    })
    return NextResponse.json({
      reply: text,
      handoff,
      toolCalls,
      agent: config.agentName ?? null,
      sources: knowledge.map((k) => ({
        title: k.title,
        snippet: k.content.slice(0, 280),
        score: k.score,
        matchedBy: k.matchedBy,
      })),
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
