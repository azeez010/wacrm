import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import nextConfig from '../next.config'

const getUser = vi.fn(async () => ({ data: { user: null } }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser } }) }))
const { middleware } = await import('./middleware')

afterEach(() => { vi.restoreAllMocks(); getUser.mockClear() })

describe('middleware, public blog', () => {
  it('serves blog pages without the auth round trip', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    for (const p of ['/blog', '/blog/page/2', '/blog/category/guides', '/blog/feed.xml', '/blog/some-post']) {
      const res = await middleware(new NextRequest(`https://app.test${p}`))
      expect(res.status, p).toBe(200)
      expect(res.headers.get('location'), p).toBeNull()
    }
    expect(getUser).not.toHaveBeenCalled()
  })
  it('answers 410 Gone for a deleted post, and falls through when the API is down', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"error":"gone"}', { status: 410 }))
    const gone = await middleware(new NextRequest('https://app.test/blog/old-post'))
    expect(gone.status).toBe(410)
    expect(gone.headers.get('x-robots-tag')).toBe('noindex')
    f.mockRejectedValueOnce(new Error('down'))
    expect((await middleware(new NextRequest('https://app.test/blog/old-post'))).status).toBe(200)
  })
  it('does not treat /blogger or similar as the blog', async () => {
    await middleware(new NextRequest('https://app.test/blogger'))
    expect(getUser).toHaveBeenCalled()
  })
})

async function cacheControlFor(pathname: string) {
  const rules = (await nextConfig.headers?.()) ?? []
  return rules
    .filter((rule) => getPathMatch(rule.source, { strict: true })(pathname))
    .flatMap((rule) => rule.headers)
    .filter((h) => h.key.toLowerCase() === 'cache-control')
    .map((h) => h.value)
    .at(-1)
}

describe('next.config, blog caching', () => {
  it.each(['/blog', '/blog/a-post', '/blog/page/2', '/blog/feed.xml'])('lets shared caches keep %s briefly', async (p) => {
    expect(await cacheControlFor(p)).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=600')
  })
  it('keeps app pages that merely start with "blog" private', async () => {
    expect(await cacheControlFor('/blogger')).toBe('private, no-store')
  })
  it('caches the sitemap publicly', async () => {
    expect(await cacheControlFor('/sitemap.xml')).toMatch(/^public/)
  })
})
