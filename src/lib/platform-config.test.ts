import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { encryptPlatformSecret } from '@/lib/payments/secrets'
import { invalidatePlatformConfig, metaValue, PLATFORM_CONFIG_TTL_MS, splitList } from './platform-config'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)))
const db = (rpc: () => unknown) => ({ rpc }) as unknown as SupabaseClient

beforeEach(() => {
  invalidatePlatformConfig()
  vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
  vi.stubEnv('META_APP_ID', 'env-app')
  vi.stubEnv('META_APP_SECRET', 'env-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('platform config', () => {
  it('prefers the console value (plain or decrypted secret) over the environment', async () => {
    const secret = await encryptPlatformSecret('console-secret', KEY)
    const rpc = vi.fn().mockResolvedValue({ data: { META_APP_ID: { value: 'console-app', secret: null }, META_APP_SECRET: { value: null, secret } }, error: null })
    expect(await metaValue('META_APP_ID', db(rpc))).toBe('console-app')
    expect(await metaValue('META_APP_SECRET', db(rpc))).toBe('console-secret')
    expect(rpc).toHaveBeenCalledTimes(1) // cached
  })

  it('falls back to the environment for keys the console does not set', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null })
    expect(await metaValue('META_APP_ID', db(rpc))).toBe('env-app')
    expect(await metaValue('META_WHATSAPP_CONFIG_ID', db(rpc))).toBeUndefined()
  })

  it('falls back to the environment on any error, a wrong key or a missing function', async () => {
    expect(await metaValue('META_APP_ID', db(vi.fn().mockRejectedValue(new Error('down'))))).toBe('env-app')
    invalidatePlatformConfig()
    expect(await metaValue('META_APP_ID', db(vi.fn().mockResolvedValue({ data: null, error: { message: 'no function' } })))).toBe('env-app')
    invalidatePlatformConfig()
    const blob = await encryptPlatformSecret('x', btoa(String.fromCharCode(...new Uint8Array(32))))
    expect(await metaValue('META_APP_SECRET', db(vi.fn().mockResolvedValue({ data: { META_APP_SECRET: { value: null, secret: blob } }, error: null })))).toBe('env-secret')
  })

  it('refreshes after the TTL and does not cache failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { META_APP_ID: { value: 'a', secret: null } }, error: null })
    let t = 1000
    await metaValue('META_APP_ID', db(rpc), () => t)
    t += PLATFORM_CONFIG_TTL_MS + 1
    await metaValue('META_APP_ID', db(rpc), () => t)
    expect(rpc).toHaveBeenCalledTimes(2)
    invalidatePlatformConfig()
    const flaky = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ data: { META_APP_ID: { value: 'now', secret: null } }, error: null })
    expect(await metaValue('META_APP_ID', db(flaky))).toBe('env-app')
    expect(await metaValue('META_APP_ID', db(flaky))).toBe('now')
  })

  it('splits comma-separated lists', () => {
    expect(splitList(' a, b ,,c')).toEqual(['a', 'b', 'c'])
    expect(splitList(undefined)).toEqual([])
  })
})
