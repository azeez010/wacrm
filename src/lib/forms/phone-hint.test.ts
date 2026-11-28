import { describe, expect, it } from 'vitest'
import { phoneHint } from './phone-hint'

describe('phoneHint', () => {
  it('says nothing for an empty or country-code-only field', () => {
    expect(phoneHint('', 'NG')).toEqual({ state: 'empty' })
    expect(phoneHint('+234', 'NG')).toEqual({ state: 'empty' })
  })
  it('asks to keep typing while it is too short', () => {
    expect(phoneHint('+234812', 'NG')).toEqual({ state: 'partial' })
  })
  it('confirms a complete number and shows it back in groups, with the country', () => {
    expect(phoneHint('+2348127423455', 'NG')).toEqual({ state: 'valid', formatted: '+234 812 742 3455', country: 'Nigeria' })
  })
  it('flags a number that is too long', () => {
    expect(phoneHint('+234812742345599999', 'NG')).toEqual({ state: 'invalid' })
  })
})
