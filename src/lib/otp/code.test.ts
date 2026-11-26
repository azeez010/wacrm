import { describe, expect, it } from 'vitest'
import { generateOtpCode, hashOtp, isAcceptableProvidedCode, verifyOtp } from './code'

describe('otp code helpers', () => {
  it('generates numeric codes of the requested length (leading zeros kept)', () => {
    for (const len of [4, 6, 8]) {
      const c = generateOtpCode(len)
      expect(c).toMatch(new RegExp(`^\\d{${len}}$`))
    }
    // Over many draws a leading zero must occur: codes are strings, not numbers.
    const draws = Array.from({ length: 400 }, () => generateOtpCode(6))
    expect(draws.some((c) => c.startsWith('0'))).toBe(true)
  })

  it('binds the hash to the verification id and the code', () => {
    const h = hashOtp('id-1', '123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyOtp('id-1', '123456', h)).toBe(true)
    expect(verifyOtp('id-1', '123457', h)).toBe(false)
    expect(verifyOtp('id-2', '123456', h)).toBe(false)
  })

  it('accepts 4 to 15 alphanumeric caller-supplied codes only', () => {
    expect(isAcceptableProvidedCode('482913')).toBe(true)
    expect(isAcceptableProvidedCode('AB12CD')).toBe(true)
    expect(isAcceptableProvidedCode('123')).toBe(false)
    expect(isAcceptableProvidedCode('1234567890123456')).toBe(false)
    expect(isAcceptableProvidedCode('12 34')).toBe(false)
    expect(isAcceptableProvidedCode(123456)).toBe(false)
  })
})

describe('signed tokens (form verification challenge / proof)', () => {
  it('round-trips, and cannot be read as another purpose or after tampering', async () => {
    const { signToken, readToken } = await import('./code')
    const tok = signToken('vp', { f: 'form-1', ph: '2348031234567' }, 60, 1_000)
    expect(readToken('vp', tok, 2_000)).toMatchObject({ f: 'form-1', ph: '2348031234567' })
    expect(readToken('vc', tok, 2_000)).toBeNull() // a proof is not a challenge
    const [body, mac] = tok.split('.')
    const forged = Buffer.from(JSON.stringify({ f: 'other', ph: '2348031234567', exp: 99_999_999 })).toString('base64url')
    expect(readToken('vp', `${forged}.${mac}`, 2_000)).toBeNull()
    expect(readToken('vp', `${body}.${mac}x`, 2_000)).toBeNull()
    expect(readToken('vp', 'garbage', 2_000)).toBeNull()
    expect(readToken('vp', undefined, 2_000)).toBeNull()
  })
  it('expires', async () => {
    const { signToken, readToken } = await import('./code')
    const tok = signToken('vp', { a: 1 }, 60, 1_000)
    expect(readToken('vp', tok, 1_000 + 59_000)).not.toBeNull()
    expect(readToken('vp', tok, 1_000 + 61_000)).toBeNull()
  })
})
