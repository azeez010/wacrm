import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ rpc: h.rpc }) }))
vi.mock('@/lib/payments/secrets', () => ({ decryptSecretsObject: h.decrypt }))

import { invalidateEmailPlatform, loadEmailPlatform, platformEmailEnabled, sendPlatformEmail } from './platform'

const ENV = { ...process.env }
beforeEach(() => {
  invalidateEmailPlatform()
  h.rpc.mockReset()
  h.decrypt.mockReset()
  delete process.env.EMAIL_PROVIDER
  delete process.env.BREVO_API_KEY
  delete process.env.EMAIL_FROM_ADDRESS
})
afterEach(() => { process.env = { ...ENV } })

const config = (instances: unknown[], sender = { fromAddress: 'hello@ogadesk.com', fromName: 'OgaDesk', replyTo: 'info@ogadesk.com' }) =>
  h.rpc.mockImplementation(async (fn: string) => (fn === 'email_platform_config' ? { data: { sender, instances }, error: null } : { data: null, error: null }))

describe('platform email', () => {
  it('loads the console sender and decrypted instances in order, cached for a minute', async () => {
    config([{ id: 'a', kind: 'resend', name: 'Resend', config: {}, secrets: 'blob-a' }, { id: 'b', kind: 'brevo', name: 'Brevo', config: {}, secrets: 'blob-b' }])
    h.decrypt.mockImplementation(async (b: string) => ({ api_key: `key-of-${b}` }))
    const p = await loadEmailPlatform()
    expect(p.sender).toEqual({ email: 'hello@ogadesk.com', name: 'OgaDesk', replyTo: 'info@ogadesk.com' })
    expect(p.instances.map((i) => [i.id, i.secrets.api_key])).toEqual([['a', 'key-of-blob-a'], ['b', 'key-of-blob-b']])
    await loadEmailPlatform()
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('falls back to the old Brevo environment variables while nothing is set in the console', async () => {
    config([], { fromAddress: null as never, fromName: null as never, replyTo: null as never })
    process.env.EMAIL_PROVIDER = 'brevo'
    process.env.BREVO_API_KEY = 'xkeysib-env'
    process.env.EMAIL_FROM_ADDRESS = 'env@ogadesk.com'
    const p = await loadEmailPlatform()
    expect(p.instances).toEqual([expect.objectContaining({ id: 'env', kind: 'brevo', secrets: { api_key: 'xkeysib-env' } })])
    expect(p.sender?.email).toBe('env@ogadesk.com')
  })

  it('is off with no provider, and never throws when the settings cannot be read', async () => {
    h.rpc.mockRejectedValue(new Error('db down'))
    expect(await platformEmailEnabled()).toBe(false)
  })

  it('sends with failover and reports each provider', async () => {
    config([{ id: 'a', kind: 'resend', name: 'Resend', config: {}, secrets: 's' }, { id: 'b', kind: 'brevo', name: 'Brevo', config: {}, secrets: 's' }])
    h.decrypt.mockResolvedValue({ api_key: 'k' })
    const f = vi.fn(async (u: string | URL | Request) => (String(u).includes('resend') ? new Response('{"message":"down"}', { status: 503 }) : new Response('{"messageId":"m"}', { status: 201 }))) as unknown as typeof fetch
    const r = await sendPlatformEmail({ to: { email: 'ada@example.com' }, subject: 'Hi', html: '', text: 'Hi' }, { fetch: f })
    expect(r).toMatchObject({ ok: true, instanceId: 'b' })
    const reports = h.rpc.mock.calls.filter(([fn]) => fn === 'email_instance_report').map(([, a]) => a)
    expect(reports).toEqual([{ p_id: 'a', p_ok: false, p_error: 'Resend: down' }, { p_id: 'b', p_ok: true, p_error: null }])
    const body = JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]![1].body))
    expect(body.replyTo).toEqual({ email: 'info@ogadesk.com' })
  })
})
