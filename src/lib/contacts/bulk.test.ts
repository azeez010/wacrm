import { describe, expect, it } from 'vitest'
import { buildDealRows, chunk, dealTitle, runBulk } from './bulk'

describe('runBulk', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }))
  it('counts ok, skipped and failed without stopping on errors', async () => {
    const progress: number[] = []
    const out = await runBulk(
      items,
      5,
      async (it) => {
        const n = Number(it.id.slice(1))
        if (n % 4 === 0) throw new Error('boom ' + it.id)
        return n % 4 === 1 ? 'skipped' : 'ok'
      },
      (p) => progress.push(p.done),
    )
    expect(out.ok + out.skipped + out.failed).toBe(12)
    expect(out.failed).toBe(3)
    expect(out.skipped).toBe(3)
    expect(out.errors[0]).toEqual({ id: 'c0', reason: 'boom c0' })
    expect(progress.at(-1)).toBe(12)
  })
  it('never runs more than the limit at once', async () => {
    let active = 0
    let max = 0
    await runBulk(items, 3, async () => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return 'ok'
    })
    expect(max).toBeLessThanOrEqual(3)
  })
  it('handles an empty list', async () => {
    expect(await runBulk([], 5, async () => 'ok')).toEqual({ ok: 0, skipped: 0, failed: 0, errors: [] })
  })
})

describe('deals', () => {
  const contacts = [
    { id: 'a', name: 'Ada', phone: '+1' },
    { id: 'b', name: null, phone: '+2' },
  ]
  it('fills the title template and falls back to the phone', () => {
    expect(dealTitle('Renewal: {name}', contacts[0])).toBe('Renewal: Ada')
    expect(dealTitle('{name}', contacts[1])).toBe('+2')
    expect(dealTitle('  ', contacts[0])).toBe('Ada')
  })
  it('builds one open deal row per contact', () => {
    const rows = buildDealRows({
      contacts,
      titleTemplate: '{name}',
      pipelineId: 'p',
      stageId: 's',
      value: 5000,
      currency: 'NGN',
      userId: 'u',
      accountId: 'acc',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ contact_id: 'a', pipeline_id: 'p', stage_id: 's', status: 'open', value: 5000, currency: 'NGN' })
  })
  it('chunks lists', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
