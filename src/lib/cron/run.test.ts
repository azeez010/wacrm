import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRON_JOBS, CRON_ORIGIN, runScheduled, type CronEnv } from './run'

const fetchSelf = vi.fn()
const env = (over: Partial<CronEnv> = {}): CronEnv => ({
  WORKER_SELF_REFERENCE: { fetch: (r: Request) => fetchSelf(r) },
  AUTOMATION_CRON_SECRET: 'auto-secret',
  ...over,
})

beforeEach(() => {
  fetchSelf.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('runScheduled', () => {
  it('calls each job with its own secret, method and path through the self binding', async () => {
    const out = await runScheduled(env())
    expect(out).toEqual([
      { job: 'crm-flush', result: 200 },
      { job: 'fx-refresh', result: 200 },
      { job: 'automations', result: 200 },
      { job: 'flows', result: 200 },
    ])
    const sent = fetchSelf.mock.calls.map((call) => {
      const r = call[0] as Request
      return [r.method, new URL(r.url).pathname, r.headers.get('x-cron-secret'), new URL(r.url).origin]
    })
    expect(sent).toEqual([
      ['POST', '/api/crm/flush', 'auto-secret', CRON_ORIGIN],
      ['POST', '/api/currency/refresh', 'auto-secret', CRON_ORIGIN],
      ['GET', '/api/automations/cron', 'auto-secret', CRON_ORIGIN],
      ['GET', '/api/flows/cron', 'auto-secret', CRON_ORIGIN],
    ])
  })

  it('skips jobs whose secret is not set, without calling them', async () => {
    expect((await runScheduled(env({ AUTOMATION_CRON_SECRET: undefined }))).every((o) => o.result === 'skipped')).toBe(true)
  })

  it('keeps going when one job fails or answers an error', async () => {
    fetchSelf
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const out = await runScheduled(env())
    expect(out.map((o) => o.result)).toEqual(['error', 503, 200, 200])
  })

  it('lists exactly the jobs the app has endpoints for', () => {
    expect(CRON_JOBS.map((j) => j.path)).toEqual(['/api/crm/flush', '/api/currency/refresh', '/api/automations/cron', '/api/flows/cron'])
  })
})
