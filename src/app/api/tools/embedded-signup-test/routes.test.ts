import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platform-config', () => ({ metaValue: async (k: string) => process.env[k] }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => { throw new Error('this tool must never touch the database') } }))

import { GET as getConfig } from './config/route'
import { POST as postVerify } from './verify/route'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 11)))
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function ticket(exp = Date.now() / 1000 + 600) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ p: 'embedded-signup-test', exp, n: 'n' })))
  const k = await crypto.subtle.importKey('raw', Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `${payload}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`embedded-signup-test.${payload}`))))}`
}
const req = (path: string, token: string | null, body?: unknown) =>
  new Request(`https://ogadesk.com${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
  vi.stubEnv('META_APP_ID', '1234567890')
  vi.stubEnv('META_APP_SECRET', 'appsecret')
  vi.stubEnv('META_WHATSAPP_CONFIG_ID', '99887766')
  vi.stubEnv('META_SYSTEM_USER_ACCESS_TOKEN', 'systoken')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('embedded signup test: config', () => {
  it('needs a valid ticket and returns only non-secret ids', async () => {
    expect((await getConfig(req('/api/tools/embedded-signup-test/config', null))).status).toBe(401)
    expect((await getConfig(req('/api/tools/embedded-signup-test/config', await ticket(Date.now() / 1000 - 5)))).status).toBe(401)
    const res = await getConfig(req('/api/tools/embedded-signup-test/config', await ticket()))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text)).toMatchObject({ configured: true, appId: '1234567890', configId: '99887766', graphApiVersion: 'v21.0', missing: [] })
    expect(text).not.toContain('appsecret')
    expect(text).not.toContain('systoken')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('lists what is missing', async () => {
    vi.stubEnv('META_WHATSAPP_CONFIG_ID', '')
    expect(await (await getConfig(req('/api/tools/embedded-signup-test/config', await ticket()))).json()).toMatchObject({ configured: false, missing: ['META_WHATSAPP_CONFIG_ID'] })
  })
})

describe('embedded signup test: verify', () => {
  it('rejects without a ticket and without a code', async () => {
    expect((await postVerify(req('/api/tools/embedded-signup-test/verify', null, { code: 'c' }))).status).toBe(401)
    expect((await postVerify(req('/api/tools/embedded-signup-test/verify', await ticket(), {}))).status).toBe(400)
  })

  it('exchanges the code, checks the token and looks the number up, all read-only', async () => {
    const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u)
      if (url.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'usertoken' }), { status: 200 })
      if (url.includes('/debug_token')) return new Response(JSON.stringify({ data: { is_valid: true, app_id: '1234567890', scopes: ['whatsapp_business_management', 'email'] } }), { status: 200 })
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer systoken')
      return new Response(JSON.stringify({ id: '555000111', display_phone_number: '+234 801 234 5678', verified_name: 'Kena', quality_rating: 'GREEN' }), { status: 200 })
    })
    vi.stubGlobal('fetch', f)
    const res = await postVerify(req('/api/tools/embedded-signup-test/verify', await ticket(), { code: 'abc', wabaId: '777', phoneNumberId: '555000111' }))
    const j = (await res.json()) as { steps: { name: string; ok: boolean | null; detail: string }[] }
    expect(j.steps.map((s) => [s.name, s.ok])).toEqual([['Exchange the code', true], ['Token belongs to your app', true], ['Look up the phone number', true]])
    expect(j.steps[1]!.detail).toContain('whatsapp_business_management')
    expect(j.steps[1]!.detail).not.toContain('email')
    expect(j.steps[2]!.detail).toContain('+234 801 234 5678')
    expect(JSON.stringify(j)).not.toMatch(/usertoken|appsecret|systoken/)
    // Read-only: no registration, no webhook subscription, only GETs.
    expect(f.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
    expect(f.mock.calls.some(([u]) => /register|subscribed_apps/.test(String(u)))).toBe(false)
  })

  it('reports Meta rejecting the code, and a system token that cannot see the number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'This authorization code has expired.' } }), { status: 400 })))
    let j = (await (await postVerify(req('/api/tools/embedded-signup-test/verify', await ticket(), { code: 'old', phoneNumberId: '555000111' }))).json()) as { steps: { ok: boolean | null; detail: string }[] }
    expect(j.steps).toHaveLength(2) // the exchange failed, and the phone lookup still runs
    expect(j.steps[0]).toMatchObject({ ok: false, detail: 'This authorization code has expired.' })

    vi.stubGlobal('fetch', vi.fn(async (u: string | URL | Request) => {
      const url = String(u)
      if (url.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      if (url.includes('/debug_token')) return new Response(JSON.stringify({ data: { is_valid: true, app_id: '1234567890', scopes: [] } }), { status: 200 })
      return new Response(JSON.stringify({ error: { message: 'Unsupported get request' } }), { status: 400 })
    }))
    j = (await (await postVerify(req('/api/tools/embedded-signup-test/verify', await ticket(), { code: 'c', phoneNumberId: '555000111' }))).json()) as typeof j
    expect(j.steps[2]).toMatchObject({ ok: false })
    expect(j.steps[2]!.detail).toContain('cannot see this number yet')
  })

  it('says so when the app id or secret is not configured', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    const j = (await (await postVerify(req('/api/tools/embedded-signup-test/verify', await ticket(), { code: 'c' }))).json()) as { steps: { ok: boolean }[] }
    expect(j.steps[0]).toMatchObject({ ok: false })
  })
})
