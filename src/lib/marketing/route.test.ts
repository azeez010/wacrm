import { describe, expect, it } from 'vitest'
import { guardLocale, LOCALE_AUTH_PATH, pagePath } from './route'

describe('marketing locale routing', () => {
  const en = { kind: 'solutions', slug: 'whatsapp-crm' } as const
  const fr = { kind: 'solutions', slug: 'whatsapp-business-api-cameroun', lang: 'fr' } as const
  it('serves each page only in its own language', () => {
    expect(guardLocale(en, 'en')).toEqual({ kind: 'ok' })
    expect(guardLocale(en, 'fr')).toEqual({ kind: 'redirect', to: '/solutions/whatsapp-crm' })
    expect(guardLocale(fr, 'fr')).toEqual({ kind: 'ok' })
    expect(guardLocale(fr, 'en')).toEqual({ kind: 'notfound' })
    expect(guardLocale(fr, 'es')).toEqual({ kind: 'notfound' })
  })
  it('builds the public path', () => {
    expect(pagePath(en)).toBe('/solutions/whatsapp-crm')
    expect(pagePath(fr)).toBe('/fr/solutions/whatsapp-business-api-cameroun')
  })
  it('matches /<lang>/signup and /login only', () => {
    expect(LOCALE_AUTH_PATH.test('/fr/signup')).toBe(true)
    expect(LOCALE_AUTH_PATH.test('/sw/login')).toBe(true)
    expect(LOCALE_AUTH_PATH.test('/fr/signupx')).toBe(false)
    expect(LOCALE_AUTH_PATH.test('/signup')).toBe(false)
    expect(LOCALE_AUTH_PATH.test('/en/signup')).toBe(false)
  })
})
