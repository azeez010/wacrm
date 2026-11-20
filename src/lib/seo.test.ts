import { describe, expect, it } from 'vitest'
import { localizedAlternates, localizedPath, localizedUrl, SITE_URL } from './seo'

describe('seo helpers', () => {
  it('leaves the default language unprefixed and prefixes the others', () => {
    expect(localizedPath('en')).toBe('/')
    expect(localizedPath('fr')).toBe('/fr')
    expect(localizedPath('ko', '/pricing')).toBe('/ko/pricing')
    expect(localizedUrl('es')).toBe(`${SITE_URL}/es`)
  })

  it('emits canonical + hreflang for every language plus x-default', () => {
    const alt = localizedAlternates('fr')
    expect(alt.canonical).toBe(`${SITE_URL}/fr`)
    expect(Object.keys(alt.languages ?? {}).sort()).toEqual(
      ['en', 'es', 'fr', 'ko', 'pt-BR', 'x-default'].sort(),
    )
    expect((alt.languages as Record<string, string>)['x-default']).toBe(`${SITE_URL}/`)
  })
})
