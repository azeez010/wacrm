// End the current support session (banner button, or the middleware once it has expired): deletes the throwaway login.
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { createClient } from '@/lib/supabase/server'
import { relativeRedirect } from '@/lib/auth/callback'
import { supportInfo } from '@/lib/support/session'

export const dynamic = 'force-dynamic'

async function end(request: Request) {
  const expired = new URL(request.url).searchParams.get('reason') === 'expired'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const info = supportInfo(user)
  if (info) await supabaseAdmin().rpc('end_support_sessions', { p_session: info.sessionId, p_reason: expired ? 'expired' : 'ended in the app' })
  await supabase.auth.signOut({ scope: 'local' })
  return relativeRedirect(`/support/ended?reason=${expired ? 'expired' : 'ended'}`)
}

export const GET = end
export const POST = end
