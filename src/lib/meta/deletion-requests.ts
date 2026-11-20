import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export type DeletionStatus = 'received' | 'in_progress' | 'completed' | 'rejected'

/** Public base URL used in the status link handed back to Meta. */
export function publicBaseUrl(request: Request): string {
  const fixed = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  return fixed || new URL(request.url).origin
}

/** Unguessable, human-quotable confirmation code. */
export function newConfirmationCode(): string {
  return crypto.randomBytes(9).toString('base64url')
}

export async function recordDeletionRequest(input: {
  source: 'meta_callback' | 'meta_deauthorize'
  metaUserId?: string
}): Promise<string> {
  const code = newConfirmationCode()
  const { error } = await admin().from('data_deletion_requests').insert({
    confirmation_code: code,
    source: input.source,
    meta_user_id: input.metaUserId ?? null,
  })
  if (error) throw new Error(error.message)
  return code
}

export async function getDeletionRequest(
  code: string,
): Promise<{ status: DeletionStatus; created_at: string; completed_at: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(code)) return null
  const { data } = await admin()
    .from('data_deletion_requests')
    .select('status, created_at, completed_at')
    .eq('confirmation_code', code)
    .maybeSingle()
  return (data as { status: DeletionStatus; created_at: string; completed_at: string | null } | null) ?? null
}
