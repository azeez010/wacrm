// ============================================================
// ChatRoom: one Durable Object per live-chat conversation. It is only a push
// channel: visitors and teammates hold a hibernating WebSocket to it, the
// server pushes new messages in over an internal POST /push, and it relays
// "typing" between the two sides and tells agents when the visitor is online.
// Messages themselves are written over HTTP (validated, stored, then pushed),
// so nothing a socket sends can create a message.
//
// The Worker entry (worker/custom-worker.ts) verifies the signed token and
// forwards the upgrade with x-chat-role / x-chat-sub set; those headers are
// only ever added by that code, never taken from the client.
// ============================================================

// @ts-expect-error: provided by the Workers runtime (the worker/ folder is excluded from tsc)
import { DurableObject } from 'cloudflare:workers'
import {
  createFrameLimiter,
  parseClientFrame,
  roomHasCapacity,
  typingTarget,
  type ServerFrame,
} from '../src/lib/chat/protocol'

type Role = 'visitor' | 'agent'
interface Attachment {
  role: Role
  sub: string
}

type Sock = WebSocket & {
  serializeAttachment(v: unknown): void
  deserializeAttachment(): unknown
}

export class ChatRoom extends DurableObject {
  // Per-socket flood limiters. Lost on hibernation, which only resets a window.
  private limiters = new Map<WebSocket, (now: number) => boolean>()

  constructor(ctx: unknown, env: unknown) {
    super(ctx, env)
    // Keepalive without waking the object: client sends "ping", runtime answers "pong".
    // @ts-expect-error: Workers runtime API, not in the DOM types
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private sockets(except?: WebSocket): Sock[] {
    // @ts-expect-error: Workers runtime API, not in the DOM types
    return (this.ctx.getWebSockets() as Sock[]).filter((s) => s !== except && s.readyState === 1)
  }

  private roleOf(ws: Sock): Role | null {
    const a = ws.deserializeAttachment() as Attachment | null
    return a?.role ?? null
  }

  private counts(except?: WebSocket) {
    const c = { visitor: 0, agent: 0 }
    for (const s of this.sockets(except)) {
      const r = this.roleOf(s)
      if (r) c[r] += 1
    }
    return c
  }

  private send(ws: WebSocket, frame: ServerFrame) {
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      /* socket already gone */
    }
  }

  private broadcast(frame: ServerFrame, to: Role | 'all', except?: WebSocket): number {
    let n = 0
    for (const s of this.sockets(except)) {
      const r = this.roleOf(s)
      if (to === 'all' || r === to) {
        this.send(s, frame)
        n += 1
      }
    }
    return n
  }

  private announcePresence(except?: WebSocket) {
    const c = this.counts(except)
    this.broadcast({ type: 'presence', visitorOnline: c.visitor > 0, agentsOnline: c.agent }, 'all', except)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Internal: the app server pushes a frame to the room's sockets.
    if (url.pathname === '/push' && request.method === 'POST') {
      let body: { frame?: ServerFrame; to?: Role | 'all' } | null = null
      try {
        body = await request.json()
      } catch {
        return new Response('bad json', { status: 400 })
      }
      if (!body?.frame || typeof body.frame.type !== 'string') return new Response('bad frame', { status: 400 })
      const delivered = this.broadcast(body.frame, body.to ?? 'all')
      return Response.json({ delivered })
    }

    if (url.pathname === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const role = request.headers.get('x-chat-role')
      const sub = request.headers.get('x-chat-sub') ?? ''
      if (role !== 'visitor' && role !== 'agent') return new Response('forbidden', { status: 403 })
      if (!roomHasCapacity(role, this.counts())) return new Response('room full', { status: 429 })

      // @ts-expect-error: WebSocketPair is a Workers runtime global
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as [WebSocket, Sock]
      // @ts-expect-error: Workers runtime API, not in the DOM types
      this.ctx.acceptWebSocket(server, [role])
      server.serializeAttachment({ role, sub } satisfies Attachment)
      this.limiters.set(server, createFrameLimiter())
      // Tell everyone (including the newcomer) who is here.
      this.announcePresence()
      return new Response(null, { status: 101, webSocket: client } as ResponseInit)
    }

    return new Response('not found', { status: 404 })
  }

  async webSocketMessage(ws: Sock, message: string | ArrayBuffer) {
    const allow = this.limiters.get(ws) ?? createFrameLimiter()
    this.limiters.set(ws, allow)
    if (!allow(Date.now())) {
      this.send(ws, { type: 'error', code: 'rate_limited' })
      return
    }
    const frame = parseClientFrame(message)
    if (!frame) return
    const role = this.roleOf(ws)
    if (!role) return
    if (frame.type === 'ping') {
      this.send(ws, { type: 'pong' })
      return
    }
    if (frame.type === 'typing') {
      this.broadcast({ type: 'typing', from: role, on: frame.on }, typingTarget(role), ws)
    }
  }

  async webSocketClose(ws: Sock, code: number) {
    this.limiters.delete(ws)
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
      /* already closed */
    }
    this.announcePresence(ws)
  }

  async webSocketError(ws: Sock) {
    this.limiters.delete(ws)
    this.announcePresence(ws)
  }
}
