// How much of each plan limit a workspace uses, for the Billing page and the public API / MCP (get_plan).
// Counts match what the limits enforce: items a lower plan archived, archived forms and system automations do
// not count; seats include pending invitations.
import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/flows/admin-client'

import type { LimitKey } from './plans'
import { countBillableMessages, monthStartUtc } from './usage'

export interface UsageLine {
  key: LimitKey
  used: number
  limit: number | null
  /** Form leads over the monthly quota, kept until released or the plan grows. */
  held?: number
}

async function count(db: SupabaseClient, table: string, accountId: string) {
  const { count: n } = await db.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId)
  return n ?? 0
}

// Items the plan archived (migration 132) do not count toward the limit; neither do system automations.
async function countLive(db: SupabaseClient, table: string, accountId: string) {
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('plan_archived_at', null)
  if (table === 'automations') q = q.is('system_key', null)
  const { count: n } = await q
  return n ?? 0
}

async function countActiveKeys(db: SupabaseClient, accountId: string) {
  const { count: n } = await db.from('api_keys').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('revoked_at', null)
  return n ?? 0
}

async function countPendingInvites(db: SupabaseClient, accountId: string) {
  const { count: n } = await db
    .from('account_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
  return n ?? 0
}

/**
 * @param db  a client that can read this workspace (the member's own, or the service role scoped by accountId)
 * @param limits  the effective limits (getEntitlements)
 * @param opts.userId  adds the per-person "workspaces you own" meter when given
 */
export async function buildUsageReport(
  db: SupabaseClient,
  accountId: string,
  limits: Partial<Record<LimitKey, number | null>>,
  opts: { userId?: string | null } = {},
): Promise<{ usage: UsageLine[]; planArchived: Record<string, number> }> {
  const admin = supabaseAdmin()
  const [contacts, connections, automations, flows, pipelines, templates, quickReplies, apiKeys, webhooks, members, pending, formCount, leadCounts, messages] =
    await Promise.all([
      countLive(db, 'contacts', accountId),
      count(db, 'whatsapp_config', accountId),
      countLive(db, 'automations', accountId),
      countLive(db, 'flows', accountId),
      count(db, 'pipelines', accountId),
      count(db, 'message_templates', accountId),
      countLive(db, 'quick_replies', accountId),
      countActiveKeys(db, accountId),
      countLive(db, 'webhook_endpoints', accountId),
      count(db, 'profiles', accountId),
      countPendingInvites(db, accountId),
      // Forms (not archived) and this month's leads (accepted vs held over the quota).
      db.from('forms').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('archived_at', null).then((r) => r.count ?? 0),
      Promise.resolve(admin.rpc('count_form_submissions', { p_account: accountId, p_since: monthStartUtc().toISOString() })).then(
        (r) => (r.data ?? {}) as { accepted?: number; held?: number },
      ),
      // The SQL function is service-role only; the caller already proved access to this workspace.
      countBillableMessages(admin, accountId),
    ])

  const used: Partial<Record<LimitKey, number>> = {
    contacts,
    whatsapp_connections: connections,
    automations,
    flows,
    pipelines,
    templates,
    quick_replies: quickReplies,
    api_keys: apiKeys,
    webhook_endpoints: webhooks,
    seats: members + pending,
    messages_per_month: messages,
    forms_max: formCount,
    form_submissions_per_month: Number(leadCounts.accepted ?? 0),
  }

  const usage: UsageLine[] = (Object.keys(used) as LimitKey[]).map((key) => {
    const l = limits[key]
    return {
      key,
      used: used[key] ?? 0,
      limit: typeof l === 'number' ? l : null,
      ...(key === 'form_submissions_per_month' ? { held: Number(leadCounts.held ?? 0) } : {}),
    }
  })

  // Workspaces are per person: how many they own against the most any of their owned workspaces' plans allows.
  if (opts.userId) {
    try {
      const { data: allowance } = await admin.rpc('owned_workspace_allowance', { p_user: opts.userId })
      const a = allowance as { owned?: number; allowed?: number | null } | null
      if (a) usage.push({ key: 'workspaces', used: Number(a.owned ?? 0), limit: typeof a.allowed === 'number' ? a.allowed : null })
    } catch {
      /* informational */
    }
  }

  // AI credits: a missing plan limit means none (not unlimited), so this comes from the dedicated function.
  try {
    const { data: credit } = await admin.rpc('ai_credit_status', { p_account: accountId })
    const c = credit as { used?: number; limit?: number | null; reason?: string } | null
    if (c && c.reason !== 'not_member') {
      usage.push({ key: 'ai_tokens_per_month', used: Number(c.used ?? 0), limit: c.reason === 'plan_feature' ? 0 : typeof c.limit === 'number' ? c.limit : null })
    }
  } catch {
    /* informational */
  }

  // What a lower plan archived (restored automatically when there is room again).
  let planArchived: Record<string, number> = {}
  try {
    const { data: pa } = await admin.rpc('plan_archived_summary', { p_account: accountId })
    if (pa && typeof pa === 'object') planArchived = pa as Record<string, number>
  } catch {
    planArchived = {}
  }

  return { usage, planArchived }
}
