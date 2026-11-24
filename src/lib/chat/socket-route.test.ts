import { describe, expect, it, vi } from 'vitest'
import { isChatSocketRequest, routeChatSocket, type ChatSocketEnv } from './socket-route'
import { signChatToken } from './token'

const SECRET = 'k'
const CID = '11111111-2222-3333-4444-555555555555'
const exp = () => Math.floor(Date.now() / 1000) + 60

function setup() {
  const forwarded: Request[] = []
  const env: ChatSocketEnv = {
    ENCRYPTION_KEY: SECRET,
    CHAT_ROOM: {
      idFromName: (n: string) => `id:${n}`,
      get: () => ({ fetch: vi.fn(async (r: Request) => { forwarded.push(r); return new Response('ok') }) }),
    },
  }
  return { env, forwarded }
}
const req = (path: string, upgrade = 'websocket') =>
  new Request(`https://ogadesk.com${path}`, { headers: upgrade ? { Upgrade: upgrade } : {} })

describe('isChatSocketRequest', () => {
  it('matches only websocket upgrades on /ws/chat/<uuid>', () => {
    expect(isChatSocketRequest(req(`/ws/chat/${CID}?t=x`))).toBe(true)
    expect(isChatSocketRequest(req(`/ws/chat/${CID}`, ''))).toBe(false)
    expect(isChatSocketRequest(req('/ws/chat/not-a-uuid'))).toBe(false)
    expect(isChatSocketRequest(req('/api/whatsapp/webhook'))).toBe(false)
  })
})

describe('routeChatSocket', () => {
  it('forwards a valid visitor token with trusted role headers', async () => {
    const { env, forwarded } = setup()
    const t = await signChatToken({ cid: CID, aid: 'a', sub: 'vis-1', role: 'visitor', exp: exp() }, SECRET)
    const res = await routeChatSocket(req(`/ws/chat/${CID}?t=${t}`), env)
    expect(res.status).toBe(200)
    expect(forwarded[0].headers.get('x-chat-role')).toBe('visitor')
    expect(forwarded[0].headers.get('x-chat-sub')).toBe('vis-1')
  })
  it('ignores role headers a client tries to smuggle in', async () => {
    const { env, forwarded } = setup()
    const t = await signChatToken({ cid: CID, aid: 'a', sub: 'vis-1', role: 'visitor', exp: exp() }, SECRET)
    const r = new Request(`https://ogadesk.com/ws/chat/${CID}?t=${t}`, { headers: { Upgrade: 'websocket', 'x-chat-role': 'agent' } })
    await routeChatSocket(r, env)
    expect(forwarded[0].headers.get('x-chat-role')).toBe('visitor')
  })
  it('rejects a missing, forged, expired or other-conversation token', async () => {
    const { env } = setup()
    const other = await signChatToken({ cid: '99999999-2222-3333-4444-555555555555', aid: 'a', sub: 's', role: 'visitor', exp: exp() }, SECRET)
    const old = await signChatToken({ cid: CID, aid: 'a', sub: 's', role: 'visitor', exp: 1 }, SECRET)
    const forged = await signChatToken({ cid: CID, aid: 'a', sub: 's', role: 'agent', exp: exp() }, 'wrong')
    for (const t of ['', 'abc', other, old, forged]) {
      const res = await routeChatSocket(req(`/ws/chat/${CID}?t=${t}`), env)
      expect(res.status).toBe(401)
    }
  })
  it('answers 503 when chat is not configured', async () => {
    const res = await routeChatSocket(req(`/ws/chat/${CID}?t=x`), { ENCRYPTION_KEY: SECRET })
    expect(res.status).toBe(503)
  })
})
