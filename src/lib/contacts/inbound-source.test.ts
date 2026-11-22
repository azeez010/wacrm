import { describe, expect, it } from 'vitest'
import { inboundSourcePatch } from './inbound-source'

const now = new Date('2026-03-03T00:00:00Z')

describe('inboundSourcePatch', () => {
  it('a Click-to-WhatsApp ad becomes the lead source, with the ad id as campaign', () => {
    const p = inboundSourcePatch({}, { source_type: 'ad', source_id: '123', headline: 'Spring sale', source_url: 'https://fb.me/x' }, true, now)
    expect(p).toMatchObject({
      lead_source: 'Click-to-WhatsApp ad',
      utm_source: 'whatsapp_ad',
      utm_medium: 'click_to_whatsapp',
      utm_campaign: '123',
      utm_content: 'Spring sale',
      source_referrer: 'https://fb.me/x',
      first_seen_at: now.toISOString(),
    })
  })
  it('a new contact without a referral is simply "WhatsApp"', () => {
    expect(inboundSourcePatch({}, undefined, true, now)).toEqual({ lead_source: 'WhatsApp', first_seen_at: now.toISOString() })
  })
  it('an existing contact without a referral is left alone', () => {
    expect(inboundSourcePatch({ id: 'c' }, undefined, false, now)).toEqual({})
    expect(inboundSourcePatch({ id: 'c' }, {}, false, now)).toEqual({})
  })
  it('never overwrites a source the contact already has (first touch)', () => {
    const p = inboundSourcePatch({ lead_source: 'Form: Gym', utm_campaign: 'spring', first_seen_at: 'x' }, { source_id: '999' }, false, now)
    expect(p.lead_source).toBeUndefined()
    expect(p.utm_campaign).toBeUndefined()
    expect(p.utm_source).toBe('whatsapp_ad')
  })
})
