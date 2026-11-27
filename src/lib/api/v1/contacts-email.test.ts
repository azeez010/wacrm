import { describe, expect, it } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'
import { ContactError, findOrCreateContactByEmail } from './contacts'

describe('findOrCreateContactByEmail', () => {
  it('creates a contact with an empty phone, then finds it again case-insensitively', async () => {
    const db = new FakeDb({}, { contacts: [] })
    const a = await findOrCreateContactByEmail(db.asClient(), 'acc', 'u1', { email: ' Ada@Example.com ', name: 'Ada' })
    expect(a.created).toBe(true)
    expect(db.rows('contacts')[0]).toMatchObject({ account_id: 'acc', phone: '', email: 'ada@example.com', name: 'Ada', lead_source: 'API' })
    const b = await findOrCreateContactByEmail(db.asClient(), 'acc', 'u1', { email: 'ADA@example.com' })
    expect(b).toEqual({ id: a.id, created: false })
    expect(db.rows('contacts')).toHaveLength(1)
  })

  it('is scoped to the workspace and rejects a bad address', async () => {
    const db = new FakeDb({}, { contacts: [{ id: 'x', account_id: 'other', email: 'ada@example.com', created_at: '2026-01-01' }] })
    expect((await findOrCreateContactByEmail(db.asClient(), 'acc', 'u1', { email: 'ada@example.com' })).created).toBe(true)
    await expect(findOrCreateContactByEmail(db.asClient(), 'acc', 'u1', { email: 'not-an-email' })).rejects.toBeInstanceOf(ContactError)
  })
})
