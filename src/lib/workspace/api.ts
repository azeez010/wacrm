// Workspace management for API keys / MCP. Same rules as the dashboard (Settings > Team), enforced by the
// service-role functions of migration 135; the person acting is the key's creator.
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'

import { clampExpiryDays, generateInviteToken, inviteExpiresAt, inviteUrl } from '@/lib/auth/invitations'
import { isAccountRole, type AccountRole } from '@/lib/auth/roles'
import { assertCanAddSeat } from '@/lib/billing/entitlements'
import { fail } from '@/lib/api/v1/respond'
import { CANONICAL_ORIGIN } from '@/lib/canonical-host'

export const MAX_WORKSPACE_NAME = 80
const MAX_LABEL = 80

/** A database refusal from the 135 functions as an API error (plan limits are left to toApiErrorResponse). */
export function rpcFailure(error: PostgrestError): NextResponse | null {
  if (/plan_limit:/.test(error.message ?? '')) return null
  if (error.code === '42501') return fail('forbidden', error.message, 403)
  if (error.code === '22023') return fail('bad_request', error.message, 400)
  if (error.code === 'P0002') return fail('not_found', error.message, 404)
  return fail('internal', 'The workspace change failed', 500)
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface InvitationRow {
  id: string
  role: AccountRole
  label: string | null
  created_at: string
  expires_at: string
}

export async function listInvitations(db: SupabaseClient, accountId: string): Promise<InvitationRow[]> {
  const { data, error } = await db
    .from('account_invitations')
    .select('id, role, label, created_at, expires_at')
    .eq('account_id', accountId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as InvitationRow[]
}

export type CreateInvitationInput = { role?: unknown; label?: unknown; expires_in_days?: unknown }

/**
 * A one-time invite link (the token is shown once; only its hash is stored). The seat limit counts members plus
 * pending invitations, as in the app.
 */
export async function createInvitation(
  db: SupabaseClient,
  accountId: string,
  createdBy: string,
  input: CreateInvitationInput,
): Promise<{ ok: true; value: { invitation: InvitationRow; url: string; expires_in_days: number } } | { ok: false; message: string }> {
  const role = input.role ?? 'agent'
  if (!isAccountRole(role) || role === 'owner') return { ok: false, message: "role must be 'admin', 'agent' or 'viewer'" }
  let label: string | null = null
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== 'string' || input.label.trim().length > MAX_LABEL) return { ok: false, message: `label must be text of at most ${MAX_LABEL} characters` }
    label = input.label.trim() || null
  }
  const days = clampExpiryDays(typeof input.expires_in_days === 'number' ? input.expires_in_days : undefined)
  await assertCanAddSeat(db, accountId)
  const { token, hash } = generateInviteToken()
  const { data, error } = await db
    .from('account_invitations')
    .insert({ account_id: accountId, token_hash: hash, role, created_by_user_id: createdBy, label, expires_at: inviteExpiresAt(days).toISOString() })
    .select('id, role, label, created_at, expires_at')
    .single()
  if (error || !data) throw error ?? new Error('invitation insert failed')
  return { ok: true, value: { invitation: data as InvitationRow, url: inviteUrl(token, CANONICAL_ORIGIN), expires_in_days: days } }
}
