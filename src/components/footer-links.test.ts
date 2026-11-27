import { describe, expect, it } from 'vitest'
import { footerColumns } from './footer-links'

describe('footer links', () => {
  it('has unique keys and only site-internal paths', () => {
    const cols = footerColumns((p) => (p === '/' ? '/fr' : `/fr${p}`))
    const links = cols.flatMap((c) => c.links)
    expect(new Set(links.map((l) => l.key)).size).toBe(links.length)
    for (const l of links) expect(l.href.startsWith('/')).toBe(true)
    expect(links.find((l) => l.key === 'blog')?.href).toBe('/fr/blog')
    expect(links.find((l) => l.key === 'pricing')?.href).toBe('/fr#pricing')
  })
})
