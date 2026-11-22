import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertFeature: vi.fn(async () => undefined),
  getLimit: vi.fn(async (_db: unknown, _acc: string, key: string) => ({ planName: 'Free', limit: key === 'forms_max' ? null : null as number | null })),
  addContactTags: vi.fn(async () => undefined),
  findOrCreateContact: vi.fn(async () => ({ id: 'c-new', created: true })),
  resolveAuditUserId: vi.fn(async () => 'owner-1'),
  findExistingContact: vi.fn(async () => null as Record<string, unknown> | null),
  addContactTagAndDispatch: vi.fn(async () => ({})),
  writeContactCustomFields: vi.fn(async () => ({ ok: true as const })),
  bulkResolveRecords: vi.fn(async () => ({ ok: true as const, data: { results: [{ label: 'Lekki', id: 'rec-1', created: true }] } })),
  assertQuota: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => ({ messageId: 'm', whatsappMessageId: 'w' })),
  runAutomations: vi.fn(async () => undefined),
  dispatchWebhook: vi.fn(async () => undefined),
  resolveConversationByPhone: vi.fn(async () => ({ conversationId: 'conv-1', contactId: 'c-new', contactCreated: false, conversationCreated: true })),
  defs: {
    customFields: new Map(),
    tableColumns: new Map(),
    refFields: new Map(),
  } as { customFields: Map<string, unknown>; tableColumns: Map<string, unknown>; refFields: Map<string, unknown> },
}))

vi.mock('@/lib/billing/entitlements', () => ({ assertFeature: h.assertFeature, getLimit: h.getLimit }))
vi.mock('@/lib/api/v1/contacts', () => ({
  addContactTags: h.addContactTags,
  findOrCreateContact: h.findOrCreateContact,
  resolveAuditUserId: h.resolveAuditUserId,
}))
vi.mock('@/lib/contacts/dedupe', () => ({ findExistingContact: h.findExistingContact }))
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch: h.addContactTagAndDispatch }))
vi.mock('@/lib/custom-fields/contact-values', () => ({ writeContactCustomFields: h.writeContactCustomFields }))
vi.mock('@/lib/custom-fields/server', () => ({ bulkResolveRecords: h.bulkResolveRecords }))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone: h.resolveConversationByPhone }))
vi.mock('@/lib/billing/usage', () => ({ monthStartUtc: () => new Date('2026-01-01T00:00:00Z'), assertMessageQuota: h.assertQuota }))
vi.mock('@/lib/whatsapp/send-message', () => ({ sendMessageToConversation: h.sendMessage }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.runAutomations }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhook }))
vi.mock('./definitions', () => ({ loadFormDefinitions: vi.fn(async () => h.defs) }))

import { answerVars, buildWhatsappUrl, openState, purgeExpired, renderWhatsappText, runSideEffects, slugTag, submitForm } from './submit'
import type { FormRow } from './types'

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] }

function makeDb(handlers: Record<string, (c: Call) => unknown> = {}) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      let single = false
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return b },
        update: (p: unknown) => { call.op = 'update'; call.payload = p; return b },
        delete: () => { call.op = 'delete'; return b },
        eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b },
        neq: (k: string, v: unknown) => { call.filters.push([`!${k}`, v]); return b },
        in: (k: string, v: unknown) => { call.filters.push([k, v]); return b },
        is: (k: string, v: unknown) => { call.filters.push([k, v]); return b },
        gte: (k: string, v: unknown) => { call.filters.push([k, v]); return b },
        lt: (k: string, v: unknown) => { call.filters.push([`<${k}`, v]); return b },
        filter: (k: string, _o: string, v: unknown) => { call.filters.push([k, v]); return b },
        limit: () => b,
        order: () => b,
        single: () => { single = true; return b },
        maybeSingle: () => { single = true; return b },
        then: (res: (v: unknown) => unknown) => {
          calls.push({ ...call })
          const key = `${table}.${call.op}`
          const out = (handlers[key] ?? (() => ({ data: call.op === 'select' ? [] : null, count: 0 })))(call) as { data?: unknown; count?: number; error?: unknown }
          const data = single && Array.isArray(out.data) ? out.data[0] ?? null : out.data
          return Promise.resolve({ data: data ?? null, count: out.count ?? 0, error: out.error ?? null }).then(res)
        },
      }
      return b
    },
    rpc: vi.fn(async () => ({ data: { accepted: 0, held: 0 }, error: null })),
  }
  return { db: db as never, calls, rpc: db.rpc }
}

const PLAN = '11111111-1111-4111-8111-111111111111'
const AGENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AGENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function form(over: Partial<FormRow> = {}, settings: Record<string, unknown> = {}): FormRow {
  return {
    id: 'form-1',
    account_id: 'acc-1',
    public_id: 'abc',
    kind: 'lead',
    name: 'Gym join',
    status: 'active',
    version: 3,
    rr_cursor: 0,
    archived_at: null,
    fields: [
      { id: 'phone', kind: 'phone', label: 'WhatsApp' },
      { id: 'name', kind: 'name', label: 'Name', required: true },
      { id: 'msg', kind: 'message', label: 'Message' },
      { id: 'ok', kind: 'consent', label: 'Agree', consentText: 'I agree to be contacted' },
    ],
    settings,
    ...over,
  }
}
const good = { answers: { phone: '08031234567', name: 'Ada', msg: 'Need a trial', ok: true }, elapsedMs: 5000, utm: { source: 'facebook', campaign: 'spring' }, referrer: 'https://x.test' }
const submissionsInsert = (calls: Call[]) => calls.filter((c) => c.table === 'form_submissions' && c.op === 'insert')
const handlersOk: Record<string, (c: Call) => unknown> = {
  'form_submissions.insert': () => ({ data: { id: 'sub-1' } }),
  'contacts.select': () => ({ data: [{ id: 'c-new', phone: '+2348031234567', name: '+2348031234567' }] }),
  'profiles.select': () => ({ data: [{ user_id: 'admin-1' }] }),
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findExistingContact.mockResolvedValue(null)
  h.getLimit.mockResolvedValue({ planName: 'Free', limit: null })
  h.assertFeature.mockResolvedValue(undefined)
})

describe('openState', () => {
  const s = (rules: Record<string, unknown>) => ({ rules }) as never
  const now = new Date('2026-06-01T12:00:00Z')
  it('only active, non-archived forms inside their window accept leads', () => {
    expect(openState({ status: 'active', archived_at: null }, s({}), now)).toEqual({ open: true })
    expect(openState({ status: 'paused', archived_at: null }, s({}), now)).toEqual({ open: false, reason: 'unavailable' })
    expect(openState({ status: 'active', archived_at: 'x' }, s({}), now)).toEqual({ open: false, reason: 'not_found' })
    expect(openState({ status: 'active', archived_at: null }, s({ opensAt: '2026-06-02T00:00:00Z' }), now)).toEqual({ open: false, reason: 'closed' })
    expect(openState({ status: 'active', archived_at: null }, s({ closesAt: '2026-06-01T00:00:00Z' }), now)).toEqual({ open: false, reason: 'closed' })
  })
})

describe('whatsapp hand-off helpers', () => {
  it('fills placeholders, leaves unknown ones blank and builds a wa.me link', () => {
    expect(renderWhatsappText('Hi, I am {{name}}. {{message}} {{nope}}', { name: 'Ada', message: 'Need help' })).toBe('Hi, I am Ada. Need help')
    expect(renderWhatsappText('', {})).toContain('form')
    expect(buildWhatsappUrl('+234 801 234 5678', 'Hi there')).toBe('https://wa.me/2348012345678?text=Hi%20there')
    expect(buildWhatsappUrl(null, 'x')).toBeNull()
  })
  it('slugs the form name into a tag', () => {
    expect(slugTag('  Gym Join!! 2026 ')).toBe('gym-join-2026')
  })
})

describe('submitForm: what the visitor sees', () => {
  it('rejects bad input without storing anything', async () => {
    const { db, calls } = makeDb(handlersOk)
    const out = await submitForm(db, form(), { answers: { phone: 'abc', name: '' } })
    expect(out.result).toMatchObject({ status: 'invalid' })
    expect((out.result as { errors: Record<string, string> }).errors).toMatchObject({ phone: 'invalid_phone', name: 'required' })
    expect(submissionsInsert(calls)).toHaveLength(0)
  })

  it('stores the submission first, then returns success with a WhatsApp link', async () => {
    const { db, calls } = makeDb({ ...handlersOk, 'whatsapp_config.select': () => ({ data: [{ display_phone_number: '+234 801 234 5678' }] }) })
    const f = form({}, { success: { action: 'whatsapp', whatsappText: 'Hi, I am {{name}}. {{message}}', followUpLine: true } })
    const out = await submitForm(db, f, good)
    const ins = submissionsInsert(calls)
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).toMatchObject({ outcome: 'accepted', form_version: 3, utm: { source: 'facebook' } })
    expect(out.result).toMatchObject({ status: 'ok', held: false })
    const ok = out.result as { success: { whatsappUrl: string } }
    expect(ok.success.whatsappUrl).toBe('https://wa.me/2348012345678?text=Hi%2C%20I%20am%20Ada.%20Need%20a%20trial')
    expect(out.finish).toBeTypeOf('function')
  })

  it('honeypot and too-fast submits look successful but create nothing', async () => {
    const a = makeDb(handlersOk)
    const r1 = await submitForm(a.db, form(), { ...good, website: 'http://spam' })
    expect(r1.result.status).toBe('ok')
    expect(r1.finish).toBeUndefined()
    expect(submissionsInsert(a.calls)[0].payload).toMatchObject({ outcome: 'rejected', reject_reason: 'honeypot' })
    const b = makeDb(handlersOk)
    const r2 = await submitForm(b.db, form(), { ...good, elapsedMs: 200 })
    expect(r2.finish).toBeUndefined()
    expect(submissionsInsert(b.calls)[0].payload).toMatchObject({ reject_reason: 'too_fast' })
    // API callers are server-side: no time trap.
    const c = makeDb(handlersOk)
    const r3 = await submitForm(c.db, form(), { ...good, elapsedMs: 10 }, { source: 'api' })
    expect(submissionsInsert(c.calls)[0].payload).toMatchObject({ outcome: 'accepted' })
    expect(r3.finish).toBeTypeOf('function')
  })

  it('paused, archived, scheduled-out and feature-locked forms accept nothing', async () => {
    const { db, calls } = makeDb(handlersOk)
    expect((await submitForm(db, form({ status: 'paused' }), good)).result.status).toBe('unavailable')
    expect((await submitForm(db, form({ archived_at: 'x' }), good)).result.status).toBe('not_found')
    const closed = await submitForm(db, form({}, { rules: { closesAt: '2020-01-01T00:00:00Z', closedMessage: 'Closed' } }), good)
    expect(closed.result).toEqual({ status: 'closed', message: 'Closed' })
    h.assertFeature.mockRejectedValueOnce(new Error('locked'))
    expect((await submitForm(db, form(), good)).result.status).toBe('unavailable')
    expect(submissionsInsert(calls)).toHaveLength(0)
  })

  it('qualification can block an entry (logged, no contact)', async () => {
    const { db, calls } = makeDb(handlersOk)
    const f = form(
      { fields: [{ id: 'phone', kind: 'phone' }, { id: 'name', kind: 'name' }, { id: 'budget', kind: 'custom_field', customFieldId: PLAN, points: { low: 1 } }] },
      { qualification: { enabled: true, threshold: 5, onUnqualified: 'block', blockMessage: 'Not a fit' } },
    )
    h.defs.customFields = new Map([[PLAN, { id: PLAN, key: 'budget', field_name: 'Budget', field_type: 'text' }]])
    const out = await submitForm(db, f, { answers: { phone: '08031234567', budget: 'low' }, elapsedMs: 3000 })
    h.defs.customFields = new Map()
    expect(out.result).toEqual({ status: 'gated', message: 'Not a fit' })
    expect(submissionsInsert(calls)[0].payload).toMatchObject({ outcome: 'blocked', qualified: false })
    expect(out.finish).toBeUndefined()
  })

  it('over the monthly quota the lead is held, not lost, and nothing else runs', async () => {
    h.getLimit.mockImplementation(async (_d, _a, key) => ({ planName: 'Free', limit: key === 'form_submissions_per_month' ? 100 : null }))
    const { db, calls, rpc } = makeDb(handlersOk)
    rpc.mockResolvedValue({ data: { accepted: 100, held: 3 }, error: null })
    const out = await submitForm(db, form(), good)
    expect(out.result).toMatchObject({ status: 'ok', held: true })
    expect(submissionsInsert(calls)[0].payload).toMatchObject({ outcome: 'held' })
    expect(out.finish).toBeUndefined()
  })

  it('stops accepting once held leads reach the quota too', async () => {
    h.getLimit.mockImplementation(async (_d, _a, key) => ({ planName: 'Free', limit: key === 'form_submissions_per_month' ? 100 : null }))
    const { db, calls, rpc } = makeDb(handlersOk)
    rpc.mockResolvedValue({ data: { accepted: 100, held: 100 }, error: null })
    const out = await submitForm(db, form(), good)
    expect(out.result.status).toBe('unavailable')
    expect(submissionsInsert(calls)).toHaveLength(0)
  })

  it('a quota counter failure fails open (the lead is accepted)', async () => {
    h.getLimit.mockRejectedValue(new Error('db down'))
    const { db, calls } = makeDb(handlersOk)
    const out = await submitForm(db, form(), good)
    expect(submissionsInsert(calls)[0].payload).toMatchObject({ outcome: 'accepted' })
    expect(out.result.status).toBe('ok')
  })

  it('one entry per phone: a second one is logged as rejected but looks like success', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'c-old', phone: '+2348031234567', name: 'Ada' })
    const { db, calls } = makeDb({ ...handlersOk, 'form_submissions.select': () => ({ data: [], count: 1 }) })
    const out = await submitForm(db, form({}, { rules: { onePerPhone: true } }), good)
    expect(out.result.status).toBe('ok')
    expect(submissionsInsert(calls)[0].payload).toMatchObject({ outcome: 'rejected', reject_reason: 'duplicate_phone' })
    expect(out.finish).toBeUndefined()
  })

  it('a repeated client key (double click) returns success without a second row', async () => {
    const { db, calls } = makeDb({ ...handlersOk, 'form_submissions.select': () => ({ data: [{ id: 'sub-0' }] }) })
    const out = await submitForm(db, form(), { ...good, key: 'abcdef123456' })
    expect(out.result.status).toBe('ok')
    expect(submissionsInsert(calls)).toHaveLength(0)
  })

  it('stops at the submission cap', async () => {
    const { db } = makeDb({ ...handlersOk, 'form_submissions.select': () => ({ data: [], count: 50 }) })
    const out = await submitForm(db, form({}, { rules: { maxSubmissions: 50, closedMessage: 'Full' } }), good)
    expect(out.result).toEqual({ status: 'closed', message: 'Full' })
  })
})

describe('side effects (finish)', () => {
  async function run(handlers = handlersOk, f = form({}, {}), existing: Record<string, unknown> | null = null) {
    h.findExistingContact.mockResolvedValue(existing)
    const m = makeDb(handlers)
    const out = await submitForm(m.db, f, good)
    await out.finish?.()
    return { ...m, out }
  }
  const processing = (calls: Call[]) => (calls.filter((c) => c.table === 'form_submissions' && c.op === 'update').pop()?.payload as { processing: { steps: Record<string, { ok: boolean }> }; contact_id: string; is_repeat: boolean })

  it('creates the contact, fills first-touch source, tags, notes and notifies admins', async () => {
    const { calls } = await run()
    expect(h.findOrCreateContact).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'owner-1', expect.objectContaining({ phone: '+2348031234567', name: 'Ada' }))
    const contactUpdate = calls.find((c) => c.table === 'contacts' && c.op === 'update')!.payload as Record<string, unknown>
    expect(contactUpdate).toMatchObject({
      name: 'Ada',
      lead_source: 'Form: Gym join',
      utm_source: 'facebook',
      utm_campaign: 'spring',
      source_referrer: 'https://x.test',
      source_form_id: 'form-1',
      opt_in_source: 'Form: Gym join',
      opt_in_text: 'I agree to be contacted',
    })
    expect(contactUpdate.first_seen_at).toBeTruthy()
    expect(h.addContactTags).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'owner-1', 'c-new', ['gym-join'])
    expect(calls.find((c) => c.table === 'contact_notes' && c.op === 'insert')!.payload).toMatchObject({ account_id: 'acc-1', contact_id: 'c-new', note_text: 'Gym join: Need a trial' })
    const note = calls.find((c) => c.table === 'notifications' && c.op === 'insert')!.payload as { user_id: string; type: string; title: string }[]
    expect(note[0]).toMatchObject({ user_id: 'admin-1', type: 'form_submission', title: 'New lead: Ada' })
    const p = processing(calls)
    expect(p.contact_id).toBe('c-new')
    expect(Object.values(p.processing.steps).every((s) => s.ok)).toBe(true)
  })

  it('an explicit empty auto tag means no tag; a custom one is used as typed', async () => {
    await run(handlersOk, form({}, { autoTag: null }))
    expect(h.addContactTags).not.toHaveBeenCalled()
    h.addContactTags.mockClear()
    await run(handlersOk, form({}, { autoTag: 'support' }))
    expect(h.addContactTags).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'owner-1', 'c-new', ['support'])
  })

  it('never overwrites what an existing contact already has (fill empty only)', async () => {
    const existing = { id: 'c-old', phone: '+2348031234567', name: 'Real Name', email: 'real@x.com', company: null, lead_source: 'Import', first_seen_at: '2025-01-01', opt_in_at: '2025-01-01' }
    const { calls } = await run(handlersOk, form({}, {}), existing)
    expect(h.findOrCreateContact).not.toHaveBeenCalled()
    const upd = calls.find((c) => c.table === 'contacts' && c.op === 'update')!.payload as Record<string, unknown>
    expect(upd.name).toBeUndefined()
    expect(upd.email).toBeUndefined()
    expect(upd.lead_source).toBeUndefined()
    expect(upd.opt_in_at).toBeUndefined()
    expect(upd.utm_source).toBe('facebook') // was empty, so it is filled
  })

  it('a blocked contact is left completely alone', async () => {
    const { calls } = await run(handlersOk, form({}, {}), { id: 'c-b', phone: '+2348031234567', blocked_at: '2026-01-01' })
    expect(calls.some((c) => c.table === 'contacts' && c.op === 'update')).toBe(false)
    expect(h.addContactTags).not.toHaveBeenCalled()
    expect(calls.some((c) => c.table === 'notifications')).toBe(false)
    expect(processing(calls).processing.steps.contact).toMatchObject({ ok: true, skipped: 'blocked' })
  })

  it('round robin assigns the next agent and advances the cursor', async () => {
    const f = form({ rr_cursor: 3 }, { assignment: { mode: 'round_robin', agentIds: [AGENT_A, AGENT_B] } })
    const { calls } = await run(handlersOk, f)
    const convUpdate = calls.find((c) => c.table === 'conversations' && c.op === 'update')!
    expect(convUpdate.payload).toEqual({ assigned_agent_id: AGENT_B }) // 3 % 2 = 1
    expect(calls.find((c) => c.table === 'forms' && c.op === 'update')!.payload).toEqual({ rr_cursor: 4 })
    // Everyone who handles leads is notified, and the assignee once (not twice).
    const note = calls.find((c) => c.table === 'notifications')!.payload as { user_id: string }[]
    expect(note.map((n) => n.user_id).sort()).toEqual(['admin-1', AGENT_B].sort())
  })

  it('removes the generic assignment notification the trigger made, so the assignee gets one entry', async () => {
    const handlers = { ...handlersOk, 'conversations.update': () => ({ data: [{ id: 'conv-1' }] }) }
    const f = form({ rr_cursor: 0 }, { assignment: { mode: 'agent', agentIds: [AGENT_A] } })
    const { calls } = await run(handlers, f)
    const del = calls.find((c) => c.table === 'notifications' && c.op === 'delete')!
    expect(del.filters).toEqual(expect.arrayContaining([['user_id', AGENT_A], ['type', 'conversation_assigned']]))
    const note = calls.find((c) => c.table === 'notifications' && c.op === 'insert')!.payload as { user_id: string }[]
    expect(note.map((n) => n.user_id)).toContain(AGENT_A)
  })

  it('notify "selected" narrows recipients but always includes the assignee', async () => {
    const handlers = { ...handlersOk, 'profiles.select': () => ({ data: [{ user_id: 'admin-1' }, { user_id: AGENT_A }, { user_id: AGENT_B }] }) }
    const f = form({}, { notify: { mode: 'selected', agentIds: [AGENT_A] }, assignment: { mode: 'agent', agentIds: [AGENT_B] } })
    const { calls } = await run(handlers, f)
    const note = calls.find((c) => c.table === 'notifications')!.payload as { user_id: string }[]
    expect(note.map((n) => n.user_id).sort()).toEqual([AGENT_A, AGENT_B].sort())
  })

  it('the notification body quotes the visitor message first, then the form name', async () => {
    const { calls } = await run()
    const note = calls.find((c) => c.table === 'notifications')!.payload as { body: string }[]
    expect(note[0].body).toBe('\u201CNeed a trial\u201D\nGym join')
  })

  it('a repeat within the window is recorded but does not notify or assign again', async () => {
    const existing = { id: 'c-old', phone: '+2348031234567', name: 'Ada' }
    const { calls } = await run(
      { ...handlersOk, 'form_submissions.select': () => ({ data: [], count: 1 }) },
      form({}, { assignment: { mode: 'agent', agentIds: [AGENT_A] } }),
      existing,
    )
    expect(processing(calls).is_repeat).toBe(true)
    expect(calls.some((c) => c.table === 'notifications')).toBe(false)
    expect(calls.some((c) => c.table === 'conversations')).toBe(false)
  })

  it('one failing step does not stop the others and is recorded for retry', async () => {
    h.addContactTags.mockRejectedValueOnce(new Error('tag boom'))
    const { calls } = await run()
    const steps = processing(calls).processing.steps as Record<string, { ok: boolean; error?: string }>
    expect(steps.tags).toMatchObject({ ok: false, error: 'tag boom' })
    expect(steps.note.ok).toBe(true)
    expect(steps.notify.ok).toBe(true)
  })

  it('no WhatsApp connection yet is skipped, not a failure; the lead is still saved', async () => {
    h.resolveConversationByPhone.mockRejectedValueOnce(new Error('No WhatsApp connected'))
    const { calls } = await run(handlersOk, form({}, { assignment: { mode: 'agent', agentIds: [AGENT_A] } }))
    const steps = processing(calls).processing.steps as Record<string, { ok: boolean; skipped?: string }>
    expect(steps.conversation).toMatchObject({ ok: true, skipped: 'no whatsapp connection' })
    expect(steps.assign).toMatchObject({ ok: true, skipped: 'no conversation' })
    expect(steps.contact.ok).toBe(true)
  })

  it('fires the form_submitted automation and the form.submitted webhook with the answers', async () => {
    await run(handlersOk, form({ id: 'form-9' }, {}))
    expect(h.runAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        triggerType: 'form_submitted',
        contactId: 'c-new',
        context: expect.objectContaining({ form_id: 'form-9', conversation_id: 'conv-1', vars: expect.objectContaining({ name: 'Ada', phone: '+2348031234567', message: 'Need a trial', form_name: 'Gym join' }) }),
      }),
    )
    expect(h.dispatchWebhook).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'form.submitted', expect.objectContaining({ contact_id: 'c-new', form: { id: 'form-9', name: 'Gym join' } }))
  })

  it('sends the welcome template only with consent, from the shared send core', async () => {
    const f = form({}, { welcomeTemplate: { name: 'welcome', language: 'en_US', params: ['{{name}}'] } })
    await run(handlersOk, f)
    expect(h.sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      expect.objectContaining({ conversationId: 'conv-1', messageType: 'template', templateName: 'welcome', templateParams: ['Ada'] }),
    )
    h.sendMessage.mockClear()
    // No consent ticked: nothing is sent.
    h.findExistingContact.mockResolvedValue(null)
    const m = makeDb(handlersOk)
    const out = await submitForm(m.db, f, { ...good, answers: { phone: '08031234567', name: 'Ada', ok: false } })
    await out.finish?.()
    expect(h.sendMessage).not.toHaveBeenCalled()
  })

  it('creates a deal in the chosen stage for a qualified lead, once per open deal', async () => {
    const PIPE = 'aaaaaaaa-0000-4000-8000-000000000001'
    const STAGE = 'bbbbbbbb-0000-4000-8000-000000000002'
    const f = form({}, { pipeline: { pipelineId: PIPE, stageId: STAGE } })
    const { calls } = await run({ ...handlersOk, 'pipeline_stages.select': () => ({ data: [{ id: STAGE }] }), 'accounts.select': () => ({ data: [{ default_currency: 'NGN' }] }) }, f)
    const deal = calls.find((c) => c.table === 'deals' && c.op === 'insert')!.payload as Record<string, unknown>
    expect(deal).toMatchObject({ account_id: 'acc-1', pipeline_id: PIPE, stage_id: STAGE, contact_id: 'c-new', currency: 'NGN', status: 'open', title: 'Ada (Gym join)' })
    // A returning lead that already has an open deal does not get a second one.
    const again = await run({ ...handlersOk, 'pipeline_stages.select': () => ({ data: [{ id: STAGE }] }), 'deals.select': () => ({ data: [{ id: 'd1' }] }) }, f)
    expect(again.calls.some((c) => c.table === 'deals' && c.op === 'insert')).toBe(false)
  })

  it('no deal for a lead that did not qualify', async () => {
    const PIPE = 'aaaaaaaa-0000-4000-8000-000000000001'
    const STAGE = 'bbbbbbbb-0000-4000-8000-000000000002'
    const f = form({}, { pipeline: { pipelineId: PIPE, stageId: STAGE }, qualification: { enabled: true, threshold: 5, onUnqualified: 'save' } })
    const { calls } = await run({ ...handlersOk, 'pipeline_stages.select': () => ({ data: [{ id: STAGE }] }) }, f)
    expect(calls.some((c) => c.table === 'deals' && c.op === 'insert')).toBe(false)
  })

  it('purges expired submissions only when a retention is set, and old events always', async () => {
    const a = makeDb(handlersOk)
    await purgeExpired(a.db, { id: 'f1', settings: { rules: { retentionDays: 30 } } }, new Date('2026-06-01T00:00:00Z'))
    const dels = a.calls.filter((c) => c.op === 'delete')
    expect(dels.map((d) => d.table).sort()).toEqual(['form_events', 'form_submissions'])
    const b = makeDb(handlersOk)
    await purgeExpired(b.db, { id: 'f1', settings: {} }, new Date('2026-06-01T00:00:00Z'))
    expect(b.calls.filter((c) => c.op === 'delete').map((d) => d.table)).toEqual(['form_events'])
  })

  it('answerVars exposes answers, hidden params and custom field keys flatly', () => {
    const v = { name: 'Ada', phone: '+234', email: '', customByKey: { plan: 'Gold' }, snapshot: { h: { label: 'ad_id', value: '42' } } } as never
    expect(answerVars(v, true, { name: 'Gym' })).toMatchObject({ name: 'Ada', phone: '+234', plan: 'Gold', ad_id: '42', qualified: 'true', form_name: 'Gym' })
  })

  it('a repeat does not fire automations or webhooks again', async () => {
    const existing = { id: 'c-old', phone: '+2348031234567', name: 'Ada' }
    await run({ ...handlersOk, 'form_submissions.select': () => ({ data: [], count: 1 }) }, form({}, {}), existing)
    expect(h.runAutomations).not.toHaveBeenCalled()
    expect(h.dispatchWebhook).not.toHaveBeenCalled()
  })

  it('runSideEffects stops early when the contact cannot be created', async () => {
    h.findOrCreateContact.mockRejectedValueOnce(new Error('plan_limit'))
    const { calls } = await run()
    expect(calls.some((c) => c.table === 'contact_notes')).toBe(false)
    expect(processing(calls).processing.steps.contact).toMatchObject({ ok: false })
    expect(runSideEffects).toBeTypeOf('function')
  })
})

describe('notificationBody', () => {
  it('handles no message, long message and not-qualified', async () => {
    const { notificationBody } = await import('./submit')
    expect(notificationBody('F', undefined, false)).toBe('F')
    expect(notificationBody('F', '  hi \n there ', true)).toBe('\u201Chi there\u201D\nF (not qualified)')
    expect(notificationBody('F', 'x'.repeat(300), false).split('\n')[0].length).toBeLessThanOrEqual(142)
  })
})
