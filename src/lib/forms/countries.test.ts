import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COUNTRIES, callingCode, composeFormPhone, resolveDefaultCountry, splitInternational } from './countries'

describe('country list', () => {
  it('covers the world with unique ISO codes, common markets first', () => {
    expect(COUNTRIES.length).toBeGreaterThan(230)
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length)
    expect(COUNTRIES[0].iso).toBe('NG')
  })

  it('has a flag file for every country', () => {
    const missing = COUNTRIES.filter((c) => !existsSync(join(process.cwd(), 'public/flags', `${c.iso.toLowerCase()}.svg`)))
    expect(missing.map((c) => c.iso)).toEqual([])
  })

  it('keeps the existing phone behaviour', () => {
    expect(callingCode('ng')).toBe('234')
    expect(composeFormPhone('08031234567', 'NG')).toBe('+2348031234567')
    expect(resolveDefaultCountry('auto', 'FR')).toBe('FR')
    expect(resolveDefaultCountry('auto', 'ZZ')).toBe('NG')
  })
})

describe('splitInternational', () => {
  it('splits by the longest calling code', () => {
    expect(splitInternational('+2348031234567')).toEqual({ iso: 'NG', national: '8031234567' })
    expect(splitInternational('+971501234567')).toEqual({ iso: 'AE', national: '501234567' })
  })

  it('resolves shared codes to their main market', () => {
    expect(splitInternational('+14155551212')?.iso).toBe('US')
    expect(splitInternational('+447911123456')?.iso).toBe('GB')
    expect(splitInternational('+79161234567')?.iso).toBe('RU')
  })

  it('needs a leading +', () => {
    expect(splitInternational('08031234567')).toBeNull()
    expect(splitInternational('')).toBeNull()
  })
})
