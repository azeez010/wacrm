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
