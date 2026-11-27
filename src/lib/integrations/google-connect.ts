import type { SupabaseClient } from '@supabase/supabase-js'

import { CALENDAR_DEFAULTS, CALENDAR_TOOLS } from '@/lib/ai/tools/executors/google-calendar'
import { sealSecrets, insertTools } from './manage'

// Saves a Google Calendar connection after the OAuth callback. Reconnecting the same Google account updates the
// existing integration (new refresh token, status back to connected) instead of adding a second one.

export const googleRedirectPath = '/api/integrations/google/callback'

export function calendarToolRows() {
  return CALENDAR_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, input_schema: t.inputSchema, kind: t.kind, source: 'builtin' as const, config: {} }))
}

export async function saveGoogleConnection(
  db: SupabaseClient,
  args: { accountId: string; userId: string; email: string | null; refreshToken: string; timezone: string | null },
): Promise<{ id: string; reconnected: boolean }> {
  const sealed = sealSecrets({ refresh_token: args.refreshToken })
  if (args.email) {
    const { data: existing } = await db
      .from('integrations')
      .select('id, config')
      .eq('account_id', args.accountId)
      .eq('kind', 'google_calendar')
      .eq('config->>email', args.email)
      .maybeSingle()
    if (existing) {
      await db.from('integrations').update({ ...sealed, status: 'connected', last_error: null, last_ok_at: new Date().toISOString() }).eq('id', existing.id)
      return { id: existing.id as string, reconnected: true }
    }
  }
  const { data: row, error } = await db
    .from('integrations')
    .insert({
      account_id: args.accountId,
      kind: 'google_calendar',
      name: args.email ? `Google Calendar (${args.email})`.slice(0, 80) : 'Google Calendar',
      status: 'connected',
      config: { ...CALENDAR_DEFAULTS, timezone: args.timezone || CALENDAR_DEFAULTS.timezone, email: args.email },
      ...sealed,
      created_by: args.userId,
      last_ok_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !row) throw new Error(error?.message ?? 'insert failed')
  try {
    await insertTools(db, args.accountId, row.id as string, calendarToolRows())
  } catch (e) {
    await db.from('integrations').delete().eq('id', row.id)
    throw e
  }
  return { id: row.id as string, reconnected: false }
}
