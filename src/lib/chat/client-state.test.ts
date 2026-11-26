import { describe, expect, it } from 'vitest'
import { addLocal, chatSocketUrl, confirmLocal, failLocal, localId, mergeMessages, newestConfirmedAt, reconnectDelay, retryLocal, type LocalMessage } from './client-state'

const m = (id: string, at: string, over: Partial<LocalMessage> = {}): LocalMessage => ({
  id, sender_type: 'agent', content_type: 'text', content_text: id, media_url: null, created_at: `2026-11-24T10:00:${at}Z`, ...over,
})

describe('mergeMessages', () => {
  it('adds only unknown messages and keeps time order', () => {
    const a = [m('1', '01'), m('3', '03')]
    expect(mergeMessages(a, [m('2', '02'), m('3', '03')]).map((x) => x.id)).toEqual(['1', '2', '3'])
  })
  it('returns the same array when nothing is new', () => {
    const a = [m('1', '01')]
    expect(mergeMessages(a, [m('1', '01')])).toBe(a)
  })
  it('keeps unsent local messages at the end whatever arrives', () => {
    const a = [m('1', '01'), m(localId('c1'), '02', { local: 'sending', clientId: 'c1' })]
    expect(mergeMessages(a, [m('9', '09')]).map((x) => x.id)).toEqual(['1', '9', localId('c1')])
  })
})

describe('local messages', () => {
  const sending = m(localId('c1'), '05', { sender_type: 'customer', local: 'sending', clientId: 'c1' })
  it('swaps the local copy for the confirmed one', () => {
    const real = m('real-1', '06', { sender_type: 'customer' })
    const out = confirmLocal(addLocal([m('1', '01')], sending), 'c1', real)
    expect(out.map((x) => x.id)).toEqual(['1', 'real-1'])
    expect(out.every((x) => !x.local)).toBe(true)
  })
  it('does not duplicate when polling already delivered the real message', () => {
    const real = m('real-1', '06', { sender_type: 'customer' })
    const out = confirmLocal([real, sending], 'c1', real)
    expect(out.map((x) => x.id)).toEqual(['real-1'])
  })
  it('marks a send failed and back to sending on retry', () => {
    const failed = failLocal([sending], 'c1')
    expect(failed[0].local).toBe('failed')
    expect(retryLocal(failed, 'c1')[0].local).toBe('sending')
  })
  it('polls from the newest confirmed message only', () => {
    expect(newestConfirmedAt([m('1', '01'), m('2', '04'), sending])).toBe('2026-11-24T10:00:04Z')
    expect(newestConfirmedAt([sending])).toBeNull()
  })
})

describe('reconnect and socket url', () => {
  it('backs off exponentially, capped, with jitter', () => {
    const mid = () => 0.5
    expect([0, 1, 2, 3, 10].map((a) => reconnectDelay(a, mid))).toEqual([1000, 2000, 4000, 8000, 20000])
    expect(reconnectDelay(0, () => 0)).toBe(750)
    expect(reconnectDelay(0, () => 1)).toBe(1250)
  })
  it('builds a wss url from the page origin', () => {
    expect(chatSocketUrl('https://ogadesk.com', 'abc', 't k')).toBe('wss://ogadesk.com/ws/chat/abc?t=t%20k')
    expect(chatSocketUrl('http://localhost:3000', 'abc', 'x')).toBe('ws://localhost:3000/ws/chat/abc?t=x')
  })
})

describe('quickReplies', () => {
  it('reads buttons and list rows, ignores junk', async () => {
    const { quickReplies } = await import('./client-state')
    expect(quickReplies({ kind: 'buttons', body: 'x', buttons: [{ id: 'a', title: 'A' }, { id: '', title: 'B' }] })).toEqual([{ id: 'a', title: 'A' }])
    expect(quickReplies({ kind: 'list', body: 'x', sections: [{ rows: [{ id: 'r1', title: 'One' }] }, { rows: [{ id: 'r2', title: 'Two' }] }] })).toEqual([
      { id: 'r1', title: 'One' },
      { id: 'r2', title: 'Two' },
    ])
    expect(quickReplies(null)).toEqual([])
    expect(quickReplies({ kind: 'buttons', buttons: 'nope' })).toEqual([])
  })
})
