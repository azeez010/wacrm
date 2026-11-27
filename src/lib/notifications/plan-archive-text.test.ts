import { describe, expect, it } from 'vitest'

import { isBillingNotification, notificationText } from './notification-text'

const t = ((key: string) => `t:${key}`) as unknown as Parameters<typeof notificationText>[2]

describe('plan archive notifications', () => {
  it('open Billing', () => {
    expect(isBillingNotification('plan_archived')).toBe(true)
    expect(isBillingNotification('plan_restored')).toBe(true)
    expect(isBillingNotification('trial_ended')).toBe(true)
    expect(isBillingNotification('form_submission')).toBe(false)
  })

  it('are shown in the reader language, not the stored English', () => {
    const n = { type: 'plan_archived' as const, title: 'Some items were archived by your plan', body: 'Archived: 2 forms.' }
    expect(notificationText(n, {}, t)).toEqual({ title: 't:planArchivedTitle', body: 't:planArchivedBody' })
    expect(notificationText({ ...n, type: 'plan_restored' }, {}, t).title).toBe('t:planRestoredTitle')
  })
})
