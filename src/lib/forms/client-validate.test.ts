import { describe, expect, it } from 'vitest'
import { validateEmail, validateMessage, validateName, validatePhone } from './client-validate'

describe('client-validate', () => {
  it('names', () => {
    expect(validateName('', true)).toBe('required')
    expect(validateName('', false)).toBeNull()
    expect(validateName('Ada Obi', true)).toBeNull()
    expect(validateName('Jo', true)).toBeNull()
    expect(validateName('Chioma', true)).toBeNull()
    expect(validateName('aaaa', true)).toBe('invalid_name')
    expect(validateName('12345', true)).toBe('invalid_name')
    expect(validateName('x', true)).toBe('invalid_name')
    expect(validateName('!!!', true)).toBe('invalid_name')
  })
  it('emails', () => {
    expect(validateEmail('a@b.co', true)).toBeNull()
    expect(validateEmail('nope', true)).toBe('invalid_email')
    expect(validateEmail('a@b', false)).toBe('invalid_email')
    expect(validateEmail('', false)).toBeNull()
  })
  it('phones', () => {
    expect(validatePhone('+2348031234567', true)).toBeNull()
    expect(validatePhone('', true)).toBe('required')
    expect(validatePhone('', false)).toBeNull()
    expect(validatePhone('abc', true)).toBe('invalid_phone')
    expect(validatePhone('+2340000000000', true)).toBe('invalid_phone')
    expect(validatePhone('+123', true)).toBe('invalid_phone')
  })
  it('messages', () => {
    expect(validateMessage('hello', true)).toBeNull()
    expect(validateMessage('hi', true)).toBeNull()
    expect(validateMessage('   ', true)).toBe('required')
    expect(validateMessage('????', true)).toBe('invalid_message')
    expect(validateMessage('aaaaaa', true)).toBe('invalid_message')
  })
})
