import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Support tickets are rows in `deals` whose pipeline has kind 'support'
 * (migration 110). The live-chat widget can open one per chat.
 */

export interface EnsureTicketArgs {
  accountId: string
  /** Audit owner for the row (deals.user_id is NOT NULL). */
  userId: string
  pipelineId: string
  stageId: string
  contactId: string
  conversationId: string
  title: string
  notes?: string | null
}

export type EnsureTicketResult =
  | { created: true; id: string }
  | { created: false; reason: 'exists' | 'invalid_pipeline' | 'invalid_stage' | 'error' }

/**
 * Open a ticket for a conversation unless it already has an open one.
 * Checks the pipeline is a support pipeline of this account and that the
 * stage belongs to it. Never throws: a ticket is a side effect and must
 * not break the chat.
 */
export async function ensureOpenTicket(
  db: SupabaseClient,
  args: EnsureTicketArgs,
): Promise<EnsureTicketResult> {
  try {
    const { data: existing } = await db
      .from('deals')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .eq('pipeline_id', args.pipelineId)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (existing) return { created: false, reason: 'exists' }

    const [{ data: pipeline }, { data: stage }] = await Promise.all([
      db
        .from('pipelines')
        .select('id, kind')
        .eq('id', args.pipelineId)
        .eq('account_id', args.accountId)
        .maybeSingle(),
      db
        .from('pipeline_stages')
        .select('id, outcome')
        .eq('id', args.stageId)
        .eq('pipeline_id', args.pipelineId)
        .maybeSingle(),
    ])
    if (!pipeline || (pipeline as { kind?: string }).kind !== 'support') {
      return { created: false, reason: 'invalid_pipeline' }
    }
    // A ticket can't start out finished.
    if (!stage || (stage as { outcome?: string | null }).outcome) {
      return { created: false, reason: 'invalid_stage' }
    }

    const { data: row, error } = await db
      .from('deals')
      .insert({
        account_id: args.accountId,
        user_id: args.userId,
        pipeline_id: args.pipelineId,
        stage_id: args.stageId,
        contact_id: args.contactId,
        conversation_id: args.conversationId,
        title: args.title.slice(0, 200),
        notes: args.notes ? args.notes.slice(0, 2000) : null,
        value: 0,
        status: 'open',
        priority: 'normal',
      })
      .select('id')
      .single()
    if (error || !row) {
      console.error('[tickets] insert failed:', error?.message)
      return { created: false, reason: 'error' }
    }
    return { created: true, id: (row as { id: string }).id }
  } catch (err) {
    console.error('[tickets] ensureOpenTicket failed:', err instanceof Error ? err.message : err)
    return { created: false, reason: 'error' }
  }
}

/** The live-chat widget's ticket setting, if it is switched on and complete. */
export function chatTicketTarget(
  settings: { chat?: { ticket?: { enabled?: boolean; pipelineId?: string; stageId?: string } } } | null | undefined,
): { pipelineId: string; stageId: string } | null {
  const t = settings?.chat?.ticket
  if (!t?.enabled || !t.pipelineId || !t.stageId) return null
  return { pipelineId: t.pipelineId, stageId: t.stageId }
}

/** "Live chat: Ada" (falls back to the widget name). */
export function chatTicketTitle(visitorLabel: string | null | undefined, widgetName: string): string {
  const who = visitorLabel?.trim()
  return who ? `Live chat: ${who}` : `Live chat: ${widgetName}`
}
