import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AccountSuspendedError, assertAccountNotSuspended, checkAccountSuspension, invalidateSuspension, SUSPENSION_TTL_MS } from './suspension'

const db = (rpc: (...a: unknown[]) => unknown) => ({ rpc }) as unknown as SupabaseClient

beforeEach(() => invalidateSuspension())

describe('checkAccountSuspension', () => {
  it('reports a suspended business with its message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suspended: true, message: 'Paused for review' }, error: null })
    expect(await checkAccountSuspension(db(rpc), 'a1')).toEqual({ suspended: true, message: 'Paused for review' })
    expect(rpc).toHaveBeenCalledWith('account_suspension_gate', { p_account: 'a1' })
  })

  it('reports not suspended', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suspended: false, message: null }, error: null })
    expect((await checkAccountSuspension(db(rpc), 'a1')).suspended).toBe(false)
  })

  it('fails open on an RPC error, a missing function, a malformed answer or a throw', async () => {
    for (const rpc of [
      vi.fn().mockResolvedValue({ data: null, error: { message: 'function does not exist' } }),
      vi.fn().mockResolvedValue({ data: 'nope', error: null }),
      vi.fn().mockResolvedValue({ data: { suspended: 'yes' }, error: null }),
      vi.fn().mockRejectedValue(new Error('network')),
    ]) {
      invalidateSuspension()
      expect((await checkAccountSuspension(db(rpc), 'a1')).suspended).toBe(false)
    }
  })

  it('caches per business for the TTL, then asks again', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suspended: true, message: 'm' }, error: null })
    const t = 1_000
    await checkAccountSuspension(db(rpc), 'a1', () => t)
    await checkAccountSuspension(db(rpc), 'a1', () => t + SUSPENSION_TTL_MS - 1)
    expect(rpc).toHaveBeenCalledTimes(1)
    await checkAccountSuspension(db(rpc), 'a1', () => t + SUSPENSION_TTL_MS + 1)
    expect(rpc).toHaveBeenCalledTimes(2)
    await checkAccountSuspension(db(rpc), 'a2', () => t)
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('does not cache failures, so a recovered database is noticed immediately', async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ data: { suspended: true, message: 'm' }, error: null })
    expect((await checkAccountSuspension(db(rpc), 'a1')).suspended).toBe(false)
    expect((await checkAccountSuspension(db(rpc), 'a1')).suspended).toBe(true)
  })
})

describe('assertAccountNotSuspended', () => {
  it('throws a 403 AccountSuspendedError carrying the message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suspended: true, message: 'Paused' }, error: null })
    const err = await assertAccountNotSuspended(db(rpc), 'a1').catch((e) => e)
    expect(err).toBeInstanceOf(AccountSuspendedError)
    expect(err).toMatchObject({ status: 403, code: 'account_suspended', message: 'Paused' })
  })
  it('resolves when not suspended', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suspended: false }, error: null })
    await expect(assertAccountNotSuspended(db(rpc), 'a1')).resolves.toBeUndefined()
  })
})
