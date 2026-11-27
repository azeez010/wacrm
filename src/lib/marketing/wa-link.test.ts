import { describe, expect, it } from 'vitest'
import { buildWaLink } from './wa-link'

describe('buildWaLink', () => {
  it('strips formatting and encodes the message', () => {
    expect(buildWaLink('+234 801 234 5678')).toBe('https://wa.me/2348012345678')
    expect(buildWaLink('002348012345678', 'Hi, I want #2')).toBe('https://wa.me/2348012345678?text=Hi%2C%20I%20want%20%232')
  })
  it('rejects numbers without a country code or of the wrong length', () => {
    expect(buildWaLink('08012345678')).toBeNull()
    expect(buildWaLink('123')).toBeNull()
    expect(buildWaLink('1'.repeat(16))).toBeNull()
    expect(buildWaLink('')).toBeNull()
  })
})
