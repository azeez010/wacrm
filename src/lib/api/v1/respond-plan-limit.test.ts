import { describe, expect, it } from 'vitest'

import { toApiErrorResponse } from './respond'

describe('toApiErrorResponse: limits the database enforces', () => {
  it('turns the plan_limit text from a trigger into a 402', async () => {
    const res = toApiErrorResponse({ message: 'plan_limit:automations:2', code: 'P0001' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('plan_limit')
    expect(body.error.message).toContain('2 automations')
  })

  it('handles thrown errors and strips the _max suffix', async () => {
    const res = toApiErrorResponse(new Error('insert failed: plan_limit:forms_max:10'))
    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('10 forms')
  })

  it('leaves other errors as 500', () => {
    expect(toApiErrorResponse(new Error('boom')).status).toBe(500)
  })
})

describe('planLimitResponse (dashboard routes)', () => {
  it('turns the database text into a readable 402 the upgrade dialog understands', async () => {
    const { planLimitResponse } = await import('@/lib/billing/plan-limit-response')
    const res = planLimitResponse({ message: 'plan_limit:quick_replies:10' })
    expect(res?.status).toBe(402)
    expect(await res?.json()).toEqual({
      error: 'Your plan allows 10 quick replies. Upgrade to add more.',
      code: 'plan_limit',
      limit_key: 'quick_replies',
      limit: 10,
    })
    expect(planLimitResponse(new Error('duplicate key'))).toBeNull()
    expect(planLimitResponse(null)).toBeNull()
  })
})
