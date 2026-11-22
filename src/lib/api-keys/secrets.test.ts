import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  clientSignOut: vi.fn(async () => ({})),
  adminSignOut: vi.fn(async () => ({})),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword: h.signIn, signOut: h.clientSignOut } }),
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ auth: { admin: { signOut: h.adminSignOut } } }) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => s, decrypt: (s: string) => s }))

import { passwordIsCorrect } from './secrets'

beforeEach(() => vi.clearAllMocks())

describe('passwordIsCorrect', () => {
  it('a wrong password is false and revokes nothing', async () => {
    h.signIn.mockResolvedValue({ data: { session: null }, error: { message: 'bad' } })
    expect(await passwordIsCorrect('a@x.test', 'nope')).toBe(false)
    expect(h.adminSignOut).not.toHaveBeenCalled()
    expect(h.clientSignOut).not.toHaveBeenCalled()
  })

  it('the right password is true and ends only the throwaway session (never a global sign-out)', async () => {
    h.signIn.mockResolvedValue({ data: { session: { access_token: 'tmp-jwt' } }, error: null })
    expect(await passwordIsCorrect('a@x.test', 'pw')).toBe(true)
    expect(h.adminSignOut).toHaveBeenCalledWith('tmp-jwt', 'local')
    expect(h.clientSignOut).not.toHaveBeenCalled()
  })
})
