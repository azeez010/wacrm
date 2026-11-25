import { computeOnline, isWithinHours, loadChatAvailability } from '@/lib/chat/online'
import { chatJson, chatPreflight, loadChatForm } from '@/lib/chat/http'

export function OPTIONS() {
  return chatPreflight()
}

/** Is the chat reachable right now, and what should the pre-chat ask for? */
export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const loaded = await loadChatForm(publicId)
  if (!loaded.ok) return loaded.res
  const { db, form, settings } = loaded.value

  // 'always' skips the hours/presence lookups entirely.
  let online = true
  if (settings.chat?.onlineMode !== 'always') {
    const { data: acct } = await db.from('accounts').select('timezone').eq('id', form.account_id).maybeSingle()
    const tz = (acct as { timezone?: string } | null)?.timezone ?? 'UTC'
    const availability = await loadChatAvailability(db, form.account_id)
    online = computeOnline(isWithinHours(settings.widget?.hours, tz, new Date()), availability)
  }

  const fields = Array.isArray(form.fields) ? (form.fields as { kind?: string; required?: boolean; label?: string }[]) : []
  const ask = (kind: string) => {
    const f = fields.find((x) => x.kind === kind)
    // Every field the widget asks for is mandatory.
    return f ? { required: true, label: f.label ?? '' } : null
  }
  return chatJson({
    ok: true,
    online,
    showOnlineBadge: settings.chat?.showOnlineBadge !== false,
    showTyping: settings.chat?.showTyping !== false,
    allowSkip: settings.chat?.allowSkip === true,
    greeting: settings.chat?.greeting ?? null,
    offlineText: settings.chat?.offlineText ?? settings.widget?.hours?.offlineText ?? null,
    ask: { name: ask('name'), phone: ask('phone'), email: ask('email') },
  })
}
