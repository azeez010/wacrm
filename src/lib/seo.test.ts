import { describe, expect, it } from 'vitest'
import { localizedAlternates, localizedPath, localizedUrl, publicOrigin, SITE_URL } from './seo'

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

const req = (url: string) => new Request(url)

describe('publicOrigin', () => {
  it('the configured domain always wins, trailing slash removed', () => {
    expect(publicOrigin(req('https://mcp.internal/api/v1/forms'), { NEXT_PUBLIC_APP_URL: 'https://ogadesk.com/' })).toBe('https://ogadesk.com')
    expect(publicOrigin(req('https://x.workers.dev/a'), { NEXT_PUBLIC_APP_URL: 'https://ogadesk.com' })).toBe('https://ogadesk.com')
  })
  it('without config it uses the real request origin, but never the internal MCP host', () => {
    expect(publicOrigin(req('https://ogadesk.dataslid.com.ng/api/v1/forms'), {})).toBe('https://ogadesk.dataslid.com.ng')
    expect(publicOrigin(req('https://mcp.internal/api/v1/forms'), {})).not.toContain('mcp.internal')
    expect(publicOrigin(undefined, {})).toMatch(/^https:\/\//)
  })
})
