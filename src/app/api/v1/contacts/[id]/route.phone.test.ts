import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

const h = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: vi.fn(async () => ({ supabase: (h.db as { asClient(): unknown }).asClient(), accountId: 'a1' })) }))
vi.mock('@/lib/api/v1/contacts', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/v1/contacts')>()),
  getContactById: vi.fn(async (_db: unknown, _a: string, id: string) => ({ id })),
  resolveAuditUserId: vi.fn(async () => 'owner'),
}))
vi.mock('@/lib/contacts/block-write', () => ({ setContactBlocked: vi.fn() }))
vi.mock('@/lib/custom-fields/contact-values', () => ({ writeContactCustomFields: vi.fn(async () => ({ ok: true })) }))

import { PATCH } from './route'

const call = (body: unknown) => PATCH(new Request('https://x.test/api/v1/contacts/c1', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => {
  h.db = new FakeDb({}, {
    contacts: [
      { id: 'c1', account_id: 'a1', phone: '', phone_normalized: '', email: 'ada@example.com' },
      { id: 'c2', account_id: 'a1', phone: '2348000000002', phone_normalized: '2348000000002' },
      { id: 'c3', account_id: 'other', phone: '2348111111111', phone_normalized: '2348111111111' },
    ],
  })
})

describe('PATCH /api/v1/contacts/:id phone', () => {
  it('sets a valid international number', async () => {
    expect((await call({ phone: '+234 811 111 1111' })).status).toBe(200)
    expect((h.db as FakeDb).rows('contacts').find((r) => r.id === 'c1')).toMatchObject({ phone: '2348111111111' })
  })

  it('rejects a number without the + or country code', async () => {
    expect((await call({ phone: '08111111111' })).status).toBe(400)
    expect((await call({ phone: 12345 })).status).toBe(400)
  })

  it('answers 409 phone_in_use when another contact in the workspace has it', async () => {
    const res = await call({ phone: '+2348000000002' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('phone_in_use')
    expect((h.db as FakeDb).rows('contacts').find((r) => r.id === 'c1')).toMatchObject({ phone: '' })
  })
})
