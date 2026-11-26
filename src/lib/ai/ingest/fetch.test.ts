import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ blocked: new Set<string>() }))
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: async (url: string) => !h.blocked.has(new URL(url).hostname),
}))

import { fetchPage, normalizeHttpUrl } from './fetch'

const realFetch = globalThis.fetch
let responses: Record<string, Response>

beforeEach(() => {
  h.blocked = new Set(['169.254.169.254', 'internal.test'])
  responses = {}
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const res = responses[url]
    if (!res) throw new TypeError('network')
    return res
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('fetchPage', () => {
  it('returns the body of a public page', async () => {
    responses['https://acme.com/'] = new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } })
    await expect(fetchPage('https://acme.com/')).resolves.toMatchObject({ body: '<p>hi</p>' })
  })

  it('refuses private addresses', async () => {
    await expect(fetchPage('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ code: 'blocked' })
  })

  it('re-checks every redirect hop', async () => {
    responses['https://acme.com/go'] = new Response(null, { status: 302, headers: { location: 'http://internal.test/admin' } })
    await expect(fetchPage('https://acme.com/go')).rejects.toMatchObject({ code: 'blocked' })
  })

  it('follows a public redirect', async () => {
    responses['https://acme.com/old'] = new Response(null, { status: 301, headers: { location: '/new' } })
    responses['https://acme.com/new'] = new Response('ok', { headers: { 'content-type': 'text/plain' } })
    await expect(fetchPage('https://acme.com/old')).resolves.toMatchObject({ url: 'https://acme.com/new', body: 'ok' })
  })

  it('rejects non-text content and oversized bodies', async () => {
    responses['https://acme.com/img'] = new Response('x', { headers: { 'content-type': 'image/png' } })
    await expect(fetchPage('https://acme.com/img')).rejects.toMatchObject({ code: 'unsupported' })
    responses['https://acme.com/big'] = new Response('x'.repeat(2_100_000), { headers: { 'content-type': 'text/html' } })
    await expect(fetchPage('https://acme.com/big')).rejects.toMatchObject({ code: 'too_large' })
  })

  it('reports HTTP errors', async () => {
    responses['https://acme.com/missing'] = new Response('no', { status: 404 })
    await expect(fetchPage('https://acme.com/missing')).rejects.toMatchObject({ code: 'http' })
  })
})

describe('normalizeHttpUrl', () => {
  it('accepts http(s) only, without credentials', () => {
    expect(normalizeHttpUrl(' https://a.com/x#y ')).toBe('https://a.com/x')
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeHttpUrl('https://u:p@a.com')).toBeNull()
  })
})
