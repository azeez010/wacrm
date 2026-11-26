import { describe, it, expect } from 'vitest'
import { inScope, parsePathPrefixes, parseRobots, parseSitemap, robotsAllows } from './crawl-rules'

describe('parseSitemap', () => {
  it('reads page URLs from a urlset', () => {
    const xml = `<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/faq?x=1&amp;y=2 </loc></url></urlset>`
    expect(parseSitemap(xml)).toEqual({ urls: ['https://a.com/', 'https://a.com/faq?x=1&y=2'], sitemaps: [] })
  })

  it('reads child sitemaps from an index', () => {
    const xml = `<sitemapindex><sitemap><loc><![CDATA[https://a.com/s1.xml]]></loc></sitemap></sitemapindex>`
    expect(parseSitemap(xml)).toEqual({ urls: [], sitemaps: ['https://a.com/s1.xml'] })
  })
})

describe('robots.txt', () => {
  const rules = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /admin
Disallow: /*.json$
Allow: /admin/help
Sitemap: https://a.com/sitemap_index.xml
`)

  it('uses only the * group and collects sitemaps', () => {
    expect(rules.disallow).toEqual(['/admin', '/*.json$'])
    expect(rules.sitemaps).toEqual(['https://a.com/sitemap_index.xml'])
  })

  it('applies the longest matching rule, allow winning ties', () => {
    expect(robotsAllows(rules, '/')).toBe(true)
    expect(robotsAllows(rules, '/admin/users')).toBe(false)
    expect(robotsAllows(rules, '/admin/help/returns')).toBe(true)
    expect(robotsAllows(rules, '/data.json')).toBe(false)
    expect(robotsAllows(rules, '/data.json/x')).toBe(true)
  })
})

describe('inScope', () => {
  const scope = {
    host: 'acme.com',
    include: ['/help'],
    exclude: ['/help/internal'],
    robots: { disallow: ['/help/private'], allow: [], sitemaps: [] },
  }

  it('keeps same-site pages under the include prefixes', () => {
    expect(inScope('https://www.acme.com/help/returns#a', scope)).toBe('https://www.acme.com/help/returns')
  })

  it('drops other hosts, excluded or disallowed paths, and files', () => {
    expect(inScope('https://evil.com/help', scope)).toBeNull()
    expect(inScope('https://acme.com/blog', scope)).toBeNull()
    expect(inScope('https://acme.com/help/internal/x', scope)).toBeNull()
    expect(inScope('https://acme.com/help/private', scope)).toBeNull()
    expect(inScope('https://acme.com/help/logo.png', scope)).toBeNull()
    expect(inScope('ftp://acme.com/help', scope)).toBeNull()
  })
})

describe('parsePathPrefixes', () => {
  it('accepts lists or comma/newline text and adds the leading slash', () => {
    expect(parsePathPrefixes('help, /docs\nfaq')).toEqual(['/help', '/docs', '/faq'])
    expect(parsePathPrefixes(['/a', 3, ''])).toEqual(['/a'])
  })
})
