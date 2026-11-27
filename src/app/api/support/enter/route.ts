// GET /api/support/enter?t=<one-time token>: an OgaDesk admin opening this business (admin console → "Open as this
// business"). Claims the token (once, within 2 minutes), creates a throwaway login that is an admin member of the
// business until the session ends, and signs it in. Expiry and read-only mode are enforced by the database (migration 130).
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { createClient } from '@/lib/supabase/server'
import { relativeRedirect } from '@/lib/auth/callback'
import { sha256Hex, SUPPORT_EMAIL_DOMAIN } from '@/lib/support/session'

export const dynamic = 'force-dynamic'

const fail = (why: string) => relativeRedirect(`/support/ended?reason=${why}`)

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t') ?? ''
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return fail('invalid')
  const admin = supabaseAdmin()
  const { data: claimed } = await admin.rpc('claim_support_session', { p_token_hash: await sha256Hex(token) })
  const s = (Array.isArray(claimed) ? claimed[0] : claimed) as { id: string; account_id: string; admin_email: string; allow_changes: boolean; expires_at: string } | undefined
  if (!s) return fail('invalid')

  const email = `support-${s.id}@${SUPPORT_EMAIL_DOMAIN}`
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: 'OgaDesk Support' },
      app_metadata: { support_session: s.id, support_admin: s.admin_email, support_read_only: !s.allow_changes, support_expires_at: s.expires_at },
    })
    if (createError || !created.user) throw new Error(createError?.message ?? 'create failed')
    const { error: attachError } = await admin.rpc('attach_support_user', { p_session: s.id, p_user: created.user.id })
    if (attachError) throw new Error(attachError.message)
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkError || !link.properties?.hashed_token) throw new Error(linkError?.message ?? 'link failed')
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: 'local' }) // drop any login this browser already had
    const { error: otpError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
    if (otpError) throw new Error(otpError.message)
  } catch (e) {
    console.error('[support] could not start session', s.id, e instanceof Error ? e.message : e)
    await admin.rpc('end_support_sessions', { p_session: s.id, p_reason: 'failed to start' })
    return fail('failed')
  }
  return relativeRedirect('/dashboard')
}
