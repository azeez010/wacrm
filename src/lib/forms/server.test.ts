import { describe, expect, it } from 'vitest'

import { deviceFromUserAgent, hashIp, isBotUserAgent } from './public-http'
import { buildFormUpdate, FormError, publicId, usesAdvancedFeatures } from './server'
import { parseFormSettings } from './types'

// Stored fields are zod output, so they carry the default label.
const current = { version: 3, fields: [{ id: 'phone', kind: 'phone', label: '' }] }

describe('buildFormUpdate', () => {
  it('requires a name, a valid status and strict settings', () => {
    expect(() => buildFormUpdate(current, { name: '  ' })).toThrow(FormError)
    expect(() => buildFormUpdate(current, { status: 'nope' as never })).toThrow(FormError)
    expect(() => buildFormUpdate(current, { settings: { evil: true } })).toThrow(FormError)
    expect(buildFormUpdate(current, { name: ' Gym ', status: 'active' })).toEqual({ name: 'Gym', status: 'active' })
  })

  it('a form must keep its phone field and unique field ids', () => {
    expect(() => buildFormUpdate(current, { fields: [{ id: 'name', kind: 'name' }] })).toThrow('phone')
    expect(() => buildFormUpdate(current, { fields: [{ id: 'a', kind: 'phone' }, { id: 'a', kind: 'name' }] })).toThrow('Duplicate')
  })

  it('bumps the version only when the fields actually change', () => {
    const same = buildFormUpdate(current, { fields: [{ id: 'phone', kind: 'phone' }] })
    expect(same.version).toBeUndefined()
    const changed = buildFormUpdate(current, { fields: [{ id: 'phone', kind: 'phone' }, { id: 'name', kind: 'name' }] })
    expect(changed.version).toBe(4)
  })
})

describe('publicId', () => {
  it('is 16 lowercase hex characters and effectively unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => publicId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('usesAdvancedFeatures', () => {
  it('flags scoring, round robin, pipeline and welcome template only', () => {
    expect(usesAdvancedFeatures(parseFormSettings({}))).toBe(false)
    expect(usesAdvancedFeatures(parseFormSettings({ qualification: { enabled: true, threshold: 3 } }))).toBe(true)
    expect(usesAdvancedFeatures(parseFormSettings({ assignment: { mode: 'round_robin', agentIds: [] } }))).toBe(true)
    expect(usesAdvancedFeatures(parseFormSettings({ assignment: { mode: 'agent' } }))).toBe(false)
    expect(usesAdvancedFeatures(parseFormSettings({ welcomeTemplate: { name: 'w', language: 'en' } }))).toBe(true)
    expect(usesAdvancedFeatures(undefined)).toBe(false)
  })
})

describe('public http helpers', () => {
  it('recognises bots and link previews, not people', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent('WhatsApp/2.23')).toBe(true)
    expect(isBotUserAgent(null)).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari')).toBe(false)
  })
  it('detects device class', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile')).toBe('mobile')
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad)')).toBe('tablet')
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh)')).toBe('desktop')
  })
  it('hashes IPs with a daily salt: stable within a day, different across days, not the raw IP', async () => {
    const a = await hashIp('1.2.3.4', new Date('2026-01-01T10:00:00Z'))
    const b = await hashIp('1.2.3.4', new Date('2026-01-01T23:00:00Z'))
    const c = await hashIp('1.2.3.4', new Date('2026-01-02T00:00:01Z'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toContain('1.2.3.4')
  })
})
