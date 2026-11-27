import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getT } from '@/lib/i18n/translate'
import type { AgentInputError } from './agent-input'

const t = getT('Api')

/** 400 response for a parseAgentInput error. */
export function agentInputErrorResponse(error: AgentInputError) {
  const key = {
    name_required: 'ai.agents.nameRequired',
    name_too_long: 'ai.agents.nameTooLong',
    prompt_too_long: 'ai.agents.promptTooLong',
    knowledge_mode_invalid: 'ai.agents.knowledgeModeInvalid',
    persona_too_long: 'ai.agents.personaTooLong',
  }[error]
  return NextResponse.json({ error: t(key), code: error }, { status: 400 })
}

/** A handoff target must be a member of the account (else a chat would be
 *  assigned to a stranger). null/undefined is always fine (shared queue). */
export async function isAccountMember(
  db: SupabaseClient,
  accountId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return true
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

/** The dashboard's response for a failed AI service call (the API maps the same codes to its own envelope). */
export function agentServiceErrorResponse(
  r: { status: number; code: string },
  failKey: 'ai.agents.loadFailed' | 'ai.agents.saveFailed' | 'ai.agents.deleteFailed' | 'ai.agents.linkFailed' | 'ai.updateConversationFailed',
) {
  const agentInput = ['name_required', 'name_too_long', 'prompt_too_long', 'knowledge_mode_invalid', 'persona_too_long']
  if (agentInput.includes(r.code)) return agentInputErrorResponse(r.code as AgentInputError)
  const key: Record<string, string> = {
    handoff_not_member: 'ai.handoffNotMember',
    agent_limit: 'ai.agents.limitReached',
    not_found: 'ai.agents.notFound',
    default_undeletable: 'ai.agents.defaultUndeletable',
    empty_update: 'common.invalidRequestBody',
    source_ids_required: 'ai.agents.sourceIdsRequired',
    unknown_sources: 'ai.agents.unknownSources',
  }
  const k = key[r.code] ?? failKey
  return NextResponse.json({ error: t(k, k === 'ai.agents.limitReached' ? { max: 20 } : undefined) }, { status: r.status })
}
