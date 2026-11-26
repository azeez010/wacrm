import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decryptPlatformSecret } from '@/lib/payments/secrets'

// ============================================================
// Platform integration settings (Meta / WhatsApp). The admin console stores them (migration 112,
// Platform settings → WhatsApp (Meta)); this reads the console value first and falls back to the
// Worker environment variable of the same name, so nothing changes until a value is saved there.
//   - 60 s cache per server instance
//   - any error (function missing, wrong key, database down) -> the environment value
// ============================================================

export const META_KEYS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_SYSTEM_USER_ACCESS_TOKEN',
  'META_WHATSAPP_CONFIG_ID',
  'META_WHATSAPP_COEXISTENCE_CONFIG_ID',
  'META_WHATSAPP_COEXISTENCE_FEATURE_TYPE',
  'META_GRAPH_API_VERSION',
  'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
] as const
export type MetaKey = (typeof META_KEYS)[number]

export const PLATFORM_CONFIG_TTL_MS = 60_000

type Raw = Record<string, { value: string | null; secret: string | null }>
let cache: { values: Map<string, string>; expiresAt: number } | null = null

export function invalidatePlatformConfig(): void {
  cache = null
}

async function load(db: SupabaseClient, now: number): Promise<Map<string, string>> {
  if (cache && cache.expiresAt > now) return cache.values
  const values = new Map<string, string>()
  try {
    const { data, error } = await db.rpc('platform_integration_values')
    if (!error && data && typeof data === 'object') {
      const key = process.env.PLATFORM_SECRETS_KEY
      for (const [k, v] of Object.entries(data as Raw)) {
        if (typeof v?.value === 'string' && v.value) values.set(k, v.value)
        else if (typeof v?.secret === 'string' && v.secret && key) {
          try {
            values.set(k, await decryptPlatformSecret(v.secret, key))
          } catch {
            /* wrong/missing key: this value falls back to the environment */
          }
        }
      }
      cache = { values, expiresAt: now + PLATFORM_CONFIG_TTL_MS }
    }
  } catch {
    /* fall back to the environment */
  }
  return values
}

/** The console value for `key`, else the environment variable, else undefined. */
export async function metaValue(key: MetaKey, db?: SupabaseClient, now: () => number = Date.now): Promise<string | undefined> {
  let fromConsole: string | undefined
  try {
    fromConsole = (await load(db ?? supabaseAdmin(), now())).get(key)
  } catch {
    /* no database client (e.g. not configured): environment only */
  }
  return fromConsole || process.env[key] || undefined
}

/** App secrets can be a comma-separated list (several Meta apps). */
export function splitList(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}
