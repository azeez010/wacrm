import { describe, it, expect } from 'vitest'
import { discoverWebsitePages } from './website'
import { FetchPageError, type PageFetcher } from './fetch'

function fakeSite(pages: Record<string, string>): { fetcher: PageFetcher; calls: string[] } {
  const calls: string[] = []
  const fetcher: PageFetcher = async (url) => {
    calls.push(url)
    if (!(url in pages)) throw new FetchPageError('http', `404 ${url}`)
    return { url, contentType: 'text/html', body: pages[url] }
  }
  return { fetcher, calls }
}

const cfg = { startUrl: 'https://acme.com/', maxPages: 50, include: [], exclude: [] }

describe('discoverWebsitePages', () => {
  it('uses the sitemap named in robots.txt, following an index', async () => {
    const { fetcher } = fakeSite({
      'https://acme.com/robots.txt': 'User-agent: *\nDisallow: /admin\nSitemap: https://acme.com/idx.xml',
      'https://acme.com/idx.xml': '<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>',
      'https://acme.com/s1.xml':
        '<urlset><url><loc>https://acme.com/faq</loc></url><url><loc>https://acme.com/admin/x</loc></url><url><loc>https://other.com/y</loc></url></urlset>',
    })
    const out = await discoverWebsitePages(cfg, fetcher)
    expect(out.via).toBe('sitemap')
    expect(out.urls).toEqual(['https://acme.com/', 'https://acme.com/faq'])
  })

  it('falls back to crawling same-site links when there is no sitemap', async () => {
    const { fetcher } = fakeSite({
      'https://acme.com/': '<a href="/a">a</a><a href="https://other.com/">x</a><a href="/logo.png">l</a>',
      'https://acme.com/a': '<a href="/b">b</a><a href="/">home</a>',
      'https://acme.com/b': 'end',
    })
    const out = await discoverWebsitePages(cfg, fetcher)
    expect(out.via).toBe('links')
    expect(out.urls).toEqual(['https://acme.com/', 'https://acme.com/a', 'https://acme.com/b'])
  })

  it('stops at the page cap', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">p</a>`).join('')
    const { fetcher } = fakeSite({ 'https://acme.com/': links })
    const out = await discoverWebsitePages({ ...cfg, maxPages: 5 }, fetcher)
    expect(out.urls).toHaveLength(5)
  })
})
