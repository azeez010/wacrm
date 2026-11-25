import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPost, imageUrl, cardImageUrl } from './api'
import { buildRss } from './rss'
import { blogEntries } from './sitemap'
import { hardenLinks, injectHeadingIdsAndBuildToc, lazyImages } from './toc'
import { blogPostingJsonLd, breadcrumbJsonLd, faqJsonLd, graph, jsonLd } from '@/lib/seo'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

afterEach(() => vi.restoreAllMocks())

describe('table of contents', () => {
  it('adds unique ids to h2/h3, replacing any existing id, and lists them in order', () => {
    const { html, toc } = injectHeadingIdsAndBuildToc('<h2 id="x">Getting started</h2><p>a</p><h3>Step <b>one</b></h3><h2>Getting started</h2><h4>skip</h4>')
    expect(toc).toEqual([
      { level: 2, id: 'getting-started', text: 'Getting started' },
      { level: 3, id: 'step-one', text: 'Step one' },
      { level: 2, id: 'getting-started-1', text: 'Getting started' },
    ])
    expect(html).toContain('<h2 id="getting-started">')
    expect(html).not.toContain('id="x"')
    expect(html.match(/ id=/g)).toHaveLength(3)
  })
  it('makes external links safe and leaves internal ones alone', () => {
    const out = hardenLinks('<a href="https://other.example/x" target="_self">a</a> <a href="https://ogadesk.com/pricing">b</a> <a href="/blog/x">c</a>', 'ogadesk.com')
    expect(out).toContain('<a href="https://other.example/x" rel="noopener noreferrer nofollow" target="_blank">a</a>')
    expect(out).toContain('<a href="https://ogadesk.com/pricing">b</a>')
    expect(out).toContain('<a href="/blog/x">c</a>')
  })
  it('lazy-loads body images without overriding an explicit choice', () => {
    expect(lazyImages('<img src="a"><img loading="eager" src="b">')).toBe('<img loading="lazy" decoding="async" src="a"><img loading="eager" src="b">')
  })
})

describe('structured data', () => {
  const post = { slug: 's', title: 'T', description: 'D', images: ['https://i/1.png'], publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', author: 'Ada', category: 'Guides', tags: ['crm'], keywords: ['whatsapp crm'], wordCount: 900, canonical: 'https://ogadesk.com/blog/s' }
  it('builds a BlogPosting with dates, Person author and publisher logo', () => {
    const ld = blogPostingJsonLd(post, 'OgaDesk', 'https://ogadesk.com')
    expect(ld).toMatchObject({ '@type': 'BlogPosting', headline: 'T', datePublished: post.publishedAt, dateModified: post.updatedAt, author: { '@type': 'Person', name: 'Ada' }, articleSection: 'Guides', keywords: 'whatsapp crm, crm', wordCount: 900 })
    expect(ld.publisher).toMatchObject({ '@type': 'Organization', logo: { url: 'https://ogadesk.com/android-chrome-512x512.png' } })
    expect(blogPostingJsonLd({ ...post, author: null }, 'OgaDesk', 'https://ogadesk.com').author).toEqual({ '@id': 'https://ogadesk.com/#organization' })
  })
  it('builds breadcrumbs and FAQ, and escapes "<" so the script tag cannot be closed', () => {
    expect(breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }], 'https://x').itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://x/blog' })
    const s = jsonLd(graph(faqJsonLd([{ question: 'Q</script><script>alert(1)', answer: 'A' }])))
    expect(s).not.toContain('</script>')
    expect(JSON.parse(s)['@graph'][0].mainEntity[0].name).toBe('Q</script><script>alert(1)')
  })
})

describe('blog API client', () => {
  it('maps 301 to moved, 410 to gone, 404 to missing', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    f.mockResolvedValueOnce(json({ redirectTo: 'new-slug' }, 301, { location: '/blog/new-slug' }))
    expect(await fetchPost('old')).toEqual({ kind: 'moved', slug: 'new-slug' })
    f.mockResolvedValueOnce(json({ error: 'gone' }, 410))
    expect(await fetchPost('x')).toEqual({ kind: 'gone' })
    f.mockResolvedValueOnce(json({ error: 'not_found' }, 404))
    expect(await fetchPost('x')).toEqual({ kind: 'missing' })
  })
  it('throws on an upstream error instead of pretending the post is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'internal_error' }, 500))
    await expect(fetchPost('x')).rejects.toThrow(/500/)
  })
  it('makes stored image paths absolute', () => {
    expect(imageUrl('/files/a.png')).toBe('https://api.ogadesk.com/files/a.png')
    expect(imageUrl('https://cdn/x.png')).toBe('https://cdn/x.png')
    expect(imageUrl(null)).toBeNull()
    expect(cardImageUrl('a b')).toBe('https://api.ogadesk.com/card/blog/a%20b')
  })
})

describe('sitemap blog entries', () => {
  it('lists the index, extra pages, categories and posts with lastModified and images', async () => {
    const posts = Array.from({ length: 13 }, (_, i) => ({ slug: `p${i}`, title: `P${i}`, cover_image_url: i === 0 ? '/files/c.png' : null, published_at: '2026-01-01T00:00:00Z', updated_at: `2026-03-${String(20 - i).padStart(2, '0')}T00:00:00Z` }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
      String(u).endsWith('/blog/sitemap') ? json({ posts }) : json({ categories: [{ name: 'Guides', slug: 'guides', posts: 3, updated_at: '2026-03-01T00:00:00Z' }] }),
    )
    const e = await blogEntries()
    const urls = e.map((x) => x.url)
    expect(urls).toContain('https://ogadesk.com/blog')
    expect(urls).toContain('https://ogadesk.com/blog/page/2')
    expect(urls).not.toContain('https://ogadesk.com/blog/page/3')
    expect(urls).toContain('https://ogadesk.com/blog/category/guides')
    const p0 = e.find((x) => x.url.endsWith('/blog/p0'))!
    expect(p0.lastModified).toEqual(new Date('2026-03-20T00:00:00Z'))
    expect(p0.images).toEqual(['https://api.ogadesk.com/files/c.png'])
  })
  it('is empty (blog left out) when there are no posts or the API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => (String(u).endsWith('/blog/sitemap') ? json({ posts: [] }) : json({ categories: [] })))
    expect(await blogEntries()).toEqual([])
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    expect(await blogEntries()).toEqual([])
  })
})

describe('RSS', () => {
  it('is well-formed, escaped, absolute and carries full content', () => {
    const xml = buildRss([{ slug: 'a-b', title: 'Tom & "Jerry" <3', excerpt: 'Ex & co', body_html: '<p>Hi <a href="/blog/x">x</a> ]]> end</p><img src="/files/i.png">', cover_image_url: '/files/c.png', author: 'Ada', category: 'Guides', tags: ['crm'], published_at: '2026-01-02T03:04:05Z', updated_at: '2026-01-03T00:00:00Z' }])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;3</title>')
    expect(xml).toContain('<guid isPermaLink="true">https://ogadesk.com/blog/a-b</guid>')
    expect(xml).toContain('<pubDate>Fri, 02 Jan 2026 03:04:05 GMT</pubDate>')
    expect(xml).toContain('href="https://ogadesk.com/blog/x"')
    expect(xml).toContain('src="https://ogadesk.com/files/i.png"')
    expect(xml).toContain(']]]]><![CDATA[>')
    expect(xml).toContain('<atom:link href="https://ogadesk.com/blog/feed.xml" rel="self" type="application/rss+xml"/>')
    expect((xml.match(/<item>/g) ?? []).length).toBe(1)
  })
})
