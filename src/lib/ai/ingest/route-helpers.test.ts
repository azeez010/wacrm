import { describe, it, expect, vi } from 'vitest'

vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown) => body } }))

import { canEditSource } from './route-helpers'

describe('canEditSource', () => {
  it('lets admins edit any source', () => {
    expect(canEditSource({ role: 'admin', userId: 'u1' }, 'u2')).toBe(true)
    expect(canEditSource({ role: 'owner', userId: 'u1' }, null)).toBe(true)
  })

  it('lets agents edit only what they added', () => {
    expect(canEditSource({ role: 'agent', userId: 'u1' }, 'u1')).toBe(true)
    expect(canEditSource({ role: 'agent', userId: 'u1' }, 'u2')).toBe(false)
  })

  it('never lets viewers edit', () => {
    expect(canEditSource({ role: 'viewer', userId: 'u1' }, 'u1')).toBe(false)
  })
})
