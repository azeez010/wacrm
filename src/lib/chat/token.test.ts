import { describe, expect, it } from 'vitest'
import { signChatToken, verifyChatToken, type ChatTokenPayload } from './token'

const SECRET = 'test-secret-key'
const NOW = 1_800_000_000
const base: ChatTokenPayload = { cid: 'conv-1', aid: 'acc-1', sub: 'visitor-abc', role: 'visitor', exp: NOW + 60 }

describe('chat token', () => {
  it('round-trips a valid token', async () => {
    const t = await signChatToken(base, SECRET)
    expect(await verifyChatToken(t, SECRET, NOW)).toEqual(base)
  })
  it('rejects a wrong secret, a tampered payload and a tampered signature', async () => {
    const t = await signChatToken(base, SECRET)
    expect(await verifyChatToken(t, 'other', NOW)).toBeNull()
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...base, cid: 'conv-2' })).toString('base64url')
    expect(await verifyChatToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull()
    expect(await verifyChatToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull()
  })
  it('rejects expired, malformed and empty tokens', async () => {
    const t = await signChatToken({ ...base, exp: NOW - 1 }, SECRET)
    expect(await verifyChatToken(t, SECRET, NOW)).toBeNull()
    for (const bad of ['', 'abc', 'a.', '.b', 'not.a.token', null, undefined, 'x'.repeat(3000)]) {
      expect(await verifyChatToken(bad as string, SECRET, NOW)).toBeNull()
    }
  })
  it('rejects an unknown role even with a valid signature', async () => {
    const t = await signChatToken({ ...base, role: 'admin' as never }, SECRET)
    expect(await verifyChatToken(t, SECRET, NOW)).toBeNull()
  })
  it('refuses to sign or verify without a secret', async () => {
    await expect(signChatToken(base, '')).rejects.toThrow()
    expect(await verifyChatToken('a.b', '', NOW)).toBeNull()
  })
})
