import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  responses: {} as Record<string, unknown>,
  calls: [] as { table: string; op: string; payload?: unknown; filters: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: unknown }[],
  pushed: [] as unknown[],
  webhooks: [] as { event: string; data: unknown }[],
  existingContact: null as null | { id: string; phone: string },
}))

function respond(table: string, op: string, single: boolean, filters: Record<string, unknown>) {
  const raw = h.responses[`${table}.${op}`]
  const r = (typeof raw === 'function' ? (raw as (f: Record<string, unknown>) => unknown)(filters) : raw) as { data?: unknown; error?: unknown } | undefined
  const data = r && 'data' in r ? r.data : null
  const error = r?.error ?? null
  return { data: single && Array.isArray(data) ? (data[0] ?? null) : data, error }
}

function fakeDb() {
  return {
    from(table: string) {
      let op = 'select'
      let payload: unknown
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      const record = () => h.calls.push({ table, op, payload, filters })
      const terminal = (single: boolean) => {
        record()
        return Promise.resolve(respond(table, op, single, filters))
      }
      for (const m of ['select', 'order', 'limit', 'gte', 'gt', 'in', 'is']) chain[m] = () => chain
      chain.eq = (k: string, v: unknown) => { filters[k] = v; return chain }
      chain.insert = (p: unknown) => { op = 'insert'; payload = p; return chain }
      chain.upsert = (p: unknown) => { op = 'upsert'; payload = p; return chain }
      chain.update = (p: unknown) => { op = 'update'; payload = p; return chain }
      chain.maybeSingle = () => terminal(true)
      chain.single = () => terminal(true)
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => terminal(false).then(res, rej)
      return chain
    },
    rpc(name: string, args: unknown) {
      h.rpcs.push({ name, args })
      return Promise.resolve({ error: null })
    },
  }
}

vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: async () => 'owner-1' }))
vi.mock('@/lib/contacts/dedupe', async (orig) => ({
  ...(await orig<object>()),
  findExistingContact: async () => h.existingContact,
}))
vi.mock('@/lib/chat/room', () => ({ pushToRoom: async (...a: unknown[]) => { h.pushed.push(a); return 1 } }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: async (_d: unknown, _a: string, event: string, data: unknown) => { h.webhooks.push({ event, data }) } }))

import { openVisitorThread, recordVisitorMessage } from './web-chat'

const widget = { formId: 'form-1', formName: 'Support', accountId: 'acc-1' }
const db = () => fakeDb() as never
const stored = { id: 'm1', sender_type: 'customer', content_type: 'text', content_text: 'hello', media_url: null, created_at: '2026-11-24T10:00:00Z' }

beforeEach(() => {
  h.responses = {}
  h.calls = []
  h.rpcs = []
  h.pushed = []
  h.webhooks = []
  h.existingContact = null
})

describe('openVisitorThread', () => {
  it('returns a known visitor to their own contact and thread without creating anything', async () => {
    h.responses['contacts.select'] = { data: { id: 'c-1' } }
    h.responses['conversations.select'] = { data: [{ id: 'conv-1', status: 'open', first_inbound_at: null }] }
    const t = await openVisitorThread(db(), widget, { visitorId: 'vis-12345678' })
    expect(t).toMatchObject({ contactId: 'c-1', conversationId: 'conv-1', contactCreated: false, conversationCreated: false })
    expect(h.calls.some((c) => c.op === 'insert')).toBe(false)
    expect(h.webhooks).toEqual([])
  })

  it('creates a contact (tagged with the widget as lead source) and a web_chat thread for a new visitor', async () => {
    h.responses['contacts.select'] = { data: null }
    h.responses['contacts.insert'] = { data: { id: 'c-new' } }
    h.responses['conversations.select'] = { data: [] }
    h.responses['conversations.insert'] = { data: { id: 'conv-new', status: 'open', first_inbound_at: null } }
    const t = await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', name: 'Ada', email: 'ada@example.com' })
    expect(t).toMatchObject({ contactId: 'c-new', conversationId: 'conv-new', contactCreated: true, conversationCreated: true })
    const contact = h.calls.find((c) => c.table === 'contacts' && c.op === 'insert')!.payload as Record<string, unknown>
    expect(contact).toMatchObject({ account_id: 'acc-1', web_visitor_id: 'vis-12345678', name: 'Ada', email: 'ada@example.com', phone: '', source_form_id: 'form-1' })
    expect(contact.lead_source).toBe('Live chat: Support')
    const conv = h.calls.find((c) => c.table === 'conversations' && c.op === 'insert')!.payload as Record<string, unknown>
    expect(conv).toMatchObject({ channel: 'web_chat', form_id: 'form-1', account_id: 'acc-1' })
    expect(h.webhooks[0]).toMatchObject({ event: 'conversation.created' })
  })

  it('lets a visitor claim an existing contact by phone only when it has no website thread', async () => {
    h.responses['contacts.select'] = { data: null }
    h.existingContact = { id: 'c-wa', phone: '+2348012345678' }
    h.responses['conversations.select'] = { data: [] } // no web thread on that contact
    h.responses['contacts.update'] = { data: null }
    h.responses['conversations.insert'] = { data: { id: 'conv-x', status: 'open', first_inbound_at: null } }
    const t = await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', phone: '+2348012345678' })
    expect(t.contactId).toBe('c-wa')
    expect(h.calls.find((c) => c.table === 'contacts' && c.op === 'update')!.payload).toEqual({ web_visitor_id: 'vis-12345678' })
  })

  it('never lands a stranger in someone else\'s earlier chat: a number that already has a website thread gets a separate, phone-less contact and a note', async () => {
    h.responses['contacts.select'] = { data: null }
    h.existingContact = { id: 'c-wa', phone: '+2348012345678' }
    // Only the existing contact has a website thread; the stranger's new contact has none.
    h.responses['conversations.select'] = (f: Record<string, unknown>) => ({ data: f.contact_id === 'c-wa' ? [{ id: 'someone-elses-thread' }] : [] })
    h.responses['contacts.insert'] = { data: { id: 'c-stranger' } }
    h.responses['conversations.insert'] = { data: { id: 'conv-stranger', status: 'open', first_inbound_at: null } }
    const t = await openVisitorThread(db(), widget, { visitorId: 'vis-87654321', phone: '+2348012345678' })
    expect(t.contactId).toBe('c-stranger')
    expect(t.conversationId).toBe('conv-stranger')
    const insert = h.calls.find((c) => c.table === 'contacts' && c.op === 'insert')!.payload as Record<string, unknown>
    expect(insert.phone).toBe('')
    expect(h.calls.some((c) => c.table === 'contact_notes' && c.op === 'insert')).toBe(true)
    expect(h.calls.some((c) => c.table === 'contacts' && c.op === 'update')).toBe(false)
  })
})

describe('visitor phone as the route passes it (bare digits, no +)', () => {
  it('saves it on a brand-new contact', async () => {
    h.responses['contacts.select'] = { data: null }
    h.responses['contacts.insert'] = { data: { id: 'c-new' } }
    h.responses['conversations.select'] = { data: [] }
    h.responses['conversations.insert'] = { data: { id: 'conv-new', status: 'open', first_inbound_at: null } }
    await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', name: 'Ada', phone: '2348142018001' })
    const ins = h.calls.find((c) => c.table === 'contacts' && c.op === 'insert')
    expect(ins?.payload).toMatchObject({ phone: '2348142018001', name: 'Ada' })
  })
  it('saves it on a returning visitor\'s contact that has none', async () => {
    h.responses['contacts.select'] = { data: { id: 'c-1', name: 'Website visitor', email: null, phone: '' } }
    h.responses['conversations.select'] = { data: [{ id: 'conv-1', status: 'open', first_inbound_at: null }] }
    await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', phone: '2348142018001' })
    expect(h.calls.find((c) => c.table === 'contacts' && c.op === 'update')?.payload).toMatchObject({ phone: '2348142018001' })
  })
})

describe('openVisitorThread: returning visitor details', () => {
  it('fills the placeholder name, email and phone on the existing contact', async () => {
    h.responses['contacts.select'] = { data: { id: 'c-1', name: 'Website visitor', email: null, phone: '' } }
    h.responses['conversations.select'] = { data: [{ id: 'conv-1', status: 'open', first_inbound_at: null }] }
    await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', name: 'Ada Obi', email: 'ada@x.co', phone: '+2348031234567' })
    const upd = h.calls.find((c) => c.table === 'contacts' && c.op === 'update')
    expect(upd?.payload).toMatchObject({ name: 'Ada Obi', email: 'ada@x.co', phone: '2348031234567' })
  })

  it('never overwrites a real name or a number that belongs to another contact (adds a note instead)', async () => {
    h.responses['contacts.select'] = { data: { id: 'c-1', name: 'Real Name', email: 'a@b.co', phone: '' } }
    h.responses['conversations.select'] = { data: [{ id: 'conv-1', status: 'open', first_inbound_at: null }] }
    h.existingContact = { id: 'other', phone: '+2348031234567' }
    await openVisitorThread(db(), widget, { visitorId: 'vis-12345678', name: 'Someone', email: 'z@y.co', phone: '+2348031234567' })
    expect(h.calls.some((c) => c.table === 'contacts' && c.op === 'update')).toBe(false)
    expect(h.calls.some((c) => c.table === 'contact_notes' && c.op === 'insert')).toBe(true)
  })
})

describe('recordVisitorMessage', () => {
  const args = { accountId: 'acc-1', contactId: 'c-1', conversationId: 'conv-1' }

  it('stores a text message, bumps the thread, pushes it to the room and fires message.received', async () => {
    h.responses['messages.insert'] = { data: [stored] }
    h.responses['conversations.select'] = { data: { id: 'conv-1', status: 'closed', first_inbound_at: null } }
    h.responses['contacts.select'] = { data: { blocked_at: null } }
    const r = await recordVisitorMessage(db(), { ...args, content: { text: '  hello  ' } })
    expect(r.duplicate).toBe(false)
    expect(r.message).toMatchObject({ id: 'm1', sender_type: 'customer', content_text: 'hello' })
    expect(h.calls.find((c) => c.table === 'messages' && c.op === 'insert')!.payload).toMatchObject({ sender_type: 'customer', content_type: 'text', content_text: 'hello', message_id: expect.stringMatching(/^web:/) })
    expect(h.rpcs[0]).toEqual({ name: 'bump_conversation_on_inbound', args: { p_conversation_id: 'conv-1', p_last_message_text: 'hello' } })
    expect(h.pushed).toHaveLength(1)
    expect(h.webhooks[0]).toMatchObject({ event: 'message.received', data: { channel: 'web_chat', conversation_id: 'conv-1' } })
    expect(r.react).toMatchObject({ text: 'hello', replyId: null, messageId: expect.stringMatching(/^web:/) })
  })

  it('stores an image as an image message', async () => {
    h.responses['messages.insert'] = { data: [{ ...stored, content_type: 'image', content_text: null, media_url: 'https://x/y.png' }] }
    h.responses['conversations.select'] = { data: { id: 'conv-1', status: 'open', first_inbound_at: 'x' } }
    h.responses['contacts.select'] = { data: { blocked_at: null } }
    const r = await recordVisitorMessage(db(), { ...args, content: { imageUrl: 'https://x/y.png', imageMime: 'image/png' } })
    expect(r.message.content_type).toBe('image')
    expect(h.calls.find((c) => c.table === 'messages' && c.op === 'insert')!.payload).toMatchObject({ content_type: 'image', media_url: 'https://x/y.png', media_type: 'image/png' })
    expect(h.rpcs[0].args).toMatchObject({ p_last_message_text: '[image]' })
  })

  it('rejects an empty message', async () => {
    await expect(recordVisitorMessage(db(), { ...args, content: { text: '   ' } })).rejects.toThrow('empty message')
    expect(h.calls).toHaveLength(0)
  })

  it('treats a replayed clientId as a duplicate: returns the original, pushes and fires nothing', async () => {
    h.responses['messages.upsert'] = { data: [] } // ignoreDuplicates: nothing inserted
    h.responses['messages.select'] = { data: stored }
    const r = await recordVisitorMessage(db(), { ...args, content: { text: 'hello', clientId: 'client-1234' } })
    expect(r.duplicate).toBe(true)
    expect(h.pushed).toHaveLength(0)
    expect(h.webhooks).toHaveLength(0)
    expect(h.rpcs).toHaveLength(0)
    expect(h.calls.find((c) => c.op === 'upsert')!.payload).toMatchObject({ message_id: 'web:client-1234' })
  })

  it('stores a blocked contact\'s message but fires no webhook', async () => {
    h.responses['messages.insert'] = { data: [stored] }
    h.responses['conversations.select'] = { data: { id: 'conv-1', status: 'open', first_inbound_at: 'x' } }
    h.responses['contacts.select'] = { data: { blocked_at: '2026-01-01T00:00:00Z' } }
    const r = await recordVisitorMessage(db(), { ...args, content: { text: 'hi' } })
    expect(h.webhooks).toHaveLength(0)
    expect(r.react).toBeUndefined() // no flow, automation or AI reply either
  })

  it('notifies the team when a chat begins', async () => {
    h.responses['messages.insert'] = { data: [stored] }
    h.responses['conversations.select'] = { data: { id: 'conv-1', status: 'open', first_inbound_at: null } }
    h.responses['contacts.select'] = { data: { blocked_at: null } }
    h.responses['profiles.select'] = { data: [{ user_id: 'u1' }, { user_id: 'u2' }] }
    await recordVisitorMessage(db(), { ...args, content: { text: 'hello' }, announceNew: { widgetName: 'Support', label: 'Ada' } })
    const n = h.calls.find((c) => c.table === 'notifications' && c.op === 'insert')!.payload as Record<string, unknown>[]
    expect(n.map((r) => r.user_id)).toEqual(['u1', 'u2'])
    expect(n[0]).toMatchObject({ conversation_id: 'conv-1', title: 'New chat: Ada' })
  })
})
