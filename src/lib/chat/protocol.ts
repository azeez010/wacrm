// ============================================================
// Live-chat wire protocol (Durable Object <-> browsers) and the pure helpers
// around it. No Cloudflare types here so it is unit-testable and shared by the
// room, the route handlers and the widget.
// ============================================================

/** A message as the visitor's widget renders it. */
export interface ChatMessageView {
  id: string
  /** 'customer' = the visitor; 'agent' / 'bot' = the team. */
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: 'text' | 'image' | 'interactive'
  content_text: string | null
  media_url: string | null
  interactive_payload?: unknown
  /** Name shown for the team member, when known. */
  sender_name?: string | null
  ai_generated?: boolean
  created_at: string
}

/** Server -> client frames. */
export type ServerFrame =
  | { type: 'message'; message: ChatMessageView }
  | { type: 'typing'; from: 'agent' | 'visitor'; on: boolean }
  | { type: 'presence'; visitorOnline: boolean; agentsOnline: number }
  | { type: 'ended' }
  | { type: 'pong' }
  | { type: 'error'; code: string }

/** Client -> server frames (messages themselves are sent over HTTP so the server validates and stores them). */
export type ClientFrame = { type: 'typing'; on: boolean } | { type: 'ping' }

export const MAX_FRAME_BYTES = 512

export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FRAME_BYTES) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.type === 'ping') return { type: 'ping' }
  if (o.type === 'typing' && typeof o.on === 'boolean') return { type: 'typing', on: o.on }
  return null
}

/** Per-socket fixed-window limiter for client frames (typing spam, ping floods). */
export function createFrameLimiter(limit = 30, windowMs = 10_000) {
  let windowStart = 0
  let count = 0
  return function allow(now: number): boolean {
    if (now - windowStart >= windowMs) {
      windowStart = now
      count = 0
    }
    count += 1
    return count <= limit
  }
}

export const ROOM_LIMITS = { visitors: 5, agents: 25 } as const

/** Whether a new socket of this role fits in the room. */
export function roomHasCapacity(role: 'visitor' | 'agent', counts: { visitor: number; agent: number }): boolean {
  return counts[role] < ROOM_LIMITS[role === 'visitor' ? 'visitors' : 'agents']
}

/** The role a typing frame should be forwarded to. */
export function typingTarget(from: 'visitor' | 'agent'): 'visitor' | 'agent' {
  return from === 'visitor' ? 'agent' : 'visitor'
}
