import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueTrialEmail = vi.fn(async (..._a: unknown[]) => true)
const crmTrack = vi.fn(async (..._a: unknown[]) => true)
vi.mock('@/lib/email/queue', () => ({ queueTrialEmail: (...a: unknown[]) => queueTrialEmail(...a) }))
vi.mock('@/lib/crm', () => ({ crmTrack: (...a: unknown[]) => crmTrack(...a) }))

const { runTrialNotices } = await import('./trial-notices')

const NOW = new Date('2026-12-10T12:00:00Z').getTime()
const DAY = 86_400_000

function fakeDb(opts: { ending?: { accountId: string; planId: string; endsAt: string }[] } = {}) {
  const inserted: Record<string, unknown>[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return { data: fn === 'trials_ending' ? opts.ending ?? [] : null, error: null }
    },
    from: (table: string) => {
      if (table === 'plans') return { select: () => ({ in: async () => ({ data: [{ id: 'pro', name: 'Pro' }, { id: 'starter', name: 'Starter' }] }) }) }
      if (table === 'account_members') return { select: () => ({ eq: () => ({ in: async () => ({ data: [{ user_id: 'owner1' }, { user_id: 'admin1' }] }) }) }) }
      if (table === 'notifications') return { insert: async (rows: Record<string, unknown>[]) => { inserted.push(...rows); return { error: null } } }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, inserted, rpcCalls }
}

beforeEach(() => { queueTrialEmail.mockClear(); crmTrack.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('runTrialNotices: ending soon', () => {
  it('emails, notifies the owner and admins, tracks it once, and stamps the reminder', async () => {
    const endsAt = new Date(NOW + 2 * DAY + 3600_000).toISOString() // 2 days and an hour left -> "3 days" (rounded up)
    const f = fakeDb({ ending: [{ accountId: 'a1', planId: 'pro', endsAt }] })
    const r = await runTrialNotices(f.db, [], 3, NOW)
    expect(r).toEqual({ reminded: 1, ended: 0 })
    expect(f.rpcCalls[0]).toEqual({ fn: 'trials_ending', args: { p_days: 3 } })
    expect(queueTrialEmail).toHaveBeenCalledWith(f.db, 'a1', 'trial_ending', 'Pro', endsAt, 3)
    expect(f.inserted).toEqual([
      expect.objectContaining({ account_id: 'a1', user_id: 'owner1', type: 'trial_ending', title: 'Your Pro trial ends in 3 days' }),
      expect.objectContaining({ user_id: 'admin1', type: 'trial_ending' }),
    ])
    expect(crmTrack).toHaveBeenCalledWith('trial_ending', expect.objectContaining({ accountId: 'a1', properties: { plan: 'pro', days_left: 3 }, onceKey: `trial_ending:a1:${endsAt}` }))
    expect(f.rpcCalls.at(-1)).toEqual({ fn: 'trial_reminded', args: { p_account: 'a1' } })
  })

  it('says "1 day" on the last day and never "0 days"', async () => {
    const f = fakeDb({ ending: [{ accountId: 'a1', planId: 'pro', endsAt: new Date(NOW + 3600_000).toISOString() }] })
    await runTrialNotices(f.db, [], 3, NOW)
    expect(f.inserted[0]!.title).toBe('Your Pro trial ends in 1 day')
  })

  it('keeps going when one account fails, and does not stamp the failed one', async () => {
    const f = fakeDb({ ending: [{ accountId: 'bad', planId: 'pro', endsAt: new Date(NOW + DAY).toISOString() }, { accountId: 'good', planId: 'pro', endsAt: new Date(NOW + DAY).toISOString() }] })
    queueTrialEmail.mockRejectedValueOnce(new Error('mail down'))
    const r = await runTrialNotices(f.db, [], 3, NOW)
    expect(r.reminded).toBe(1)
    const stamped = f.rpcCalls.filter((c) => c.fn === 'trial_reminded').map((c) => c.args.p_account)
    expect(stamped).toEqual(['good']) // the failed one is retried by the next sweep
  })
})

describe('runTrialNotices: ended', () => {
  it('emails and notifies that they are back on Free', async () => {
    const f = fakeDb()
    const r = await runTrialNotices(f.db, [{ accountId: 'a2', planId: 'starter' }], 3, NOW)
    expect(r).toEqual({ reminded: 0, ended: 1 })
    expect(queueTrialEmail).toHaveBeenCalledWith(f.db, 'a2', 'trial_ended', 'Starter', '2026-12-10')
    expect(f.inserted[0]).toMatchObject({ account_id: 'a2', type: 'trial_ended', title: 'Your Starter trial has ended' })
    expect(crmTrack).toHaveBeenCalledWith('trial_ended', expect.objectContaining({ accountId: 'a2', properties: { plan: 'starter' } }))
  })
  it('does nothing when there is nothing to do', async () => {
    const f = fakeDb()
    expect(await runTrialNotices(f.db, [], 3, NOW)).toEqual({ reminded: 0, ended: 0 })
    expect(queueTrialEmail).not.toHaveBeenCalled()
  })
})
