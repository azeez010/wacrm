import type { ChatMessageView } from './protocol'

// ============================================================
// Pure helpers behind the visitor's chat widget: merging the thread from the
// server, the WebSocket and the polling fallback without duplicates, and the
// reconnect schedule. Kept apart from the component so they are unit-tested.
// ============================================================

/** A message in the widget: either confirmed by the server, or still local. */
export interface LocalMessage extends ChatMessageView {
  /** Set while it exists only in this browser. */
  local?: 'sending' | 'failed'
  clientId?: string
}

const byTime = (a: ChatMessageView, b: ChatMessageView) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0

/** Add server messages to the thread: known ids are skipped, order is by time, unsent local messages stay last. */
export function mergeMessages(current: LocalMessage[], incoming: ChatMessageView[]): LocalMessage[] {
  const known = new Set(current.map((m) => m.id))
  const fresh = incoming.filter((m) => !known.has(m.id))
  if (fresh.length === 0) return current
  const confirmed = current.filter((m) => !m.local)
  const pending = current.filter((m) => m.local)
  return [...[...confirmed, ...fresh].sort(byTime), ...pending]
}

export const localId = (clientId: string) => `local:${clientId}`

export function addLocal(current: LocalMessage[], msg: LocalMessage): LocalMessage[] {
  return [...current, msg]
}

/** The server confirmed our send: swap the local copy for the real one (or drop it if the real one already arrived). */
export function confirmLocal(current: LocalMessage[], clientId: string, real: ChatMessageView): LocalMessage[] {
  const without = current.filter((m) => m.id !== localId(clientId))
  if (without.some((m) => m.id === real.id)) return without
  return mergeMessages(without, [real])
}

export function failLocal(current: LocalMessage[], clientId: string): LocalMessage[] {
  return current.map((m) => (m.id === localId(clientId) ? { ...m, local: 'failed' as const } : m))
}

export function retryLocal(current: LocalMessage[], clientId: string): LocalMessage[] {
  return current.map((m) => (m.id === localId(clientId) ? { ...m, local: 'sending' as const } : m))
}

/** Timestamp to poll "since": the newest confirmed message. */
export function newestConfirmedAt(messages: LocalMessage[]): string | null {
  let best: string | null = null
  for (const m of messages) if (!m.local && (best === null || m.created_at > best)) best = m.created_at
  return best
}

/** Reconnect delay: 1s, 2s, 4s ... capped at 20s, with jitter so a deploy does not stampede. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(20_000, 1000 * 2 ** Math.max(0, attempt))
  return Math.round(base * (0.75 + random() * 0.5))
}

export function chatSocketUrl(origin: string, conversationId: string, token: string): string {
  const u = new URL(origin)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `/ws/chat/${conversationId}`
  u.search = `?t=${encodeURIComponent(token)}`
  return u.toString()
}

export interface QuickReply {
  id: string
  title: string
}

/**
 * The options a bot message offers (buttons, or every row of a list), shown
 * as tappable chips while it is the newest message in the chat.
 */
export function quickReplies(payload: unknown): QuickReply[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as { kind?: unknown; buttons?: unknown; sections?: unknown }
  const pick = (v: unknown): QuickReply | null => {
    const o = v as { id?: unknown; title?: unknown } | null
    return o && typeof o.id === 'string' && typeof o.title === 'string' && o.id && o.title ? { id: o.id, title: o.title } : null
  }
  const out: QuickReply[] = []
  if (p.kind === 'buttons' && Array.isArray(p.buttons)) {
    for (const b of p.buttons) {
      const r = pick(b)
      if (r) out.push(r)
    }
  } else if (p.kind === 'list' && Array.isArray(p.sections)) {
    for (const s of p.sections) {
      const rows = (s as { rows?: unknown } | null)?.rows
      if (Array.isArray(rows)) for (const row of rows) {
        const r = pick(row)
        if (r) out.push(r)
      }
    }
  }
  return out.slice(0, 20)
}
