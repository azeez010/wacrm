import { describe, expect, it } from 'vitest'
import { parseAuthMethod } from './last-method'

describe('parseAuthMethod', () => {
  it('accepts the two known methods', () => {
    expect(parseAuthMethod('google')).toBe('google')
    expect(parseAuthMethod('email')).toBe('email')
  })
  it('ignores anything else', () => {
    expect(parseAuthMethod(null)).toBeNull()
    expect(parseAuthMethod('facebook')).toBeNull()
    expect(parseAuthMethod('')).toBeNull()
  })
})
