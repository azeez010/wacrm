import type { SupabaseClient } from '@supabase/supabase-js'

import type { FormRow, FormSettings } from '@/lib/forms/types'
import { computeOnline, isWithinHours, loadChatAvailability } from './online'

/** What the widget needs to draw itself before any chat exists. Shared by the status API and the SSR'd embed page. */
export interface ChatStatusBody {
  online: boolean
  agentName: string | null
  showOnlineBadge: boolean
  showTyping: boolean
  allowSkip: boolean
  greeting: string | null
  offlineText: string | null
  ask: Record<'name' | 'phone' | 'email', { required: boolean; label: string } | null>
}

export async function buildChatStatus(db: SupabaseClient, form: Pick<FormRow, 'account_id' | 'fields'>, settings: FormSettings): Promise<ChatStatusBody> {
  // 'always' skips the hours/presence lookups entirely.
  let online = true
  let agentName: string | null = null
  if (settings.chat?.onlineMode !== 'always') {
    const [{ data: acct }, availability] = await Promise.all([
      db.from('accounts').select('timezone').eq('id', form.account_id).maybeSingle(),
      loadChatAvailability(db, form.account_id),
    ])
    const tz = (acct as { timezone?: string } | null)?.timezone ?? 'UTC'
    online = computeOnline(isWithinHours(settings.widget?.hours, tz, new Date()), availability)
    agentName = availability.agentName ?? null
  }

  const fields = Array.isArray(form.fields) ? (form.fields as { kind?: string; label?: string }[]) : []
  const ask = (kind: string) => {
    const f = fields.find((x) => x.kind === kind)
    // Every field the widget asks for is mandatory.
    return f ? { required: true, label: f.label ?? '' } : null
  }
  return {
    online,
    agentName,
    showOnlineBadge: settings.chat?.showOnlineBadge !== false,
    showTyping: settings.chat?.showTyping !== false,
    allowSkip: settings.chat?.allowSkip === true,
    greeting: settings.chat?.greeting ?? null,
    offlineText: settings.chat?.offlineText ?? settings.widget?.hours?.offlineText ?? null,
    ask: { name: ask('name'), phone: ask('phone'), email: ask('email') },
  }
}
