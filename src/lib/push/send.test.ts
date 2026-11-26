import { describe, expect, it } from 'vitest'
import { PUSH_RATE_PER_MINUTE, withinRate } from './send'

describe('withinRate', () => {
  const now = 1_000_000
  it('starts a window for a fresh device', () => {
    expect(withinRate({ window_started_at: null, window_count: 0 }, now)).toEqual({ allowed: true, started: now, count: 1 })
  })
  it('counts inside the window and blocks at the cap', () => {
    const started = new Date(now - 10_000).toISOString()
    expect(withinRate({ window_started_at: started, window_count: 5 }, now).count).toBe(6)
    expect(withinRate({ window_started_at: started, window_count: PUSH_RATE_PER_MINUTE }, now).allowed).toBe(false)
  })
  it('resets after a minute', () => {
    const started = new Date(now - 61_000).toISOString()
    expect(withinRate({ window_started_at: started, window_count: PUSH_RATE_PER_MINUTE }, now)).toEqual({ allowed: true, started: now, count: 1 })
  })
})
