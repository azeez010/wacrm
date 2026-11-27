// Platform email: the providers and default sender set in the admin console (Platform settings → Email & CRM,
// migration 131), tried in order with failover (./providers.ts, shared with the admin API).
// Fallback while nothing is set in the console: the old EMAIL_PROVIDER=brevo + BREVO_API_KEY + EMAIL_FROM_* env vars.
import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAND_NAME } from '@/lib/brand'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decryptSecretsObject } from '@/lib/payments/secrets'
import { sendWithFailover, type EmailInstance, type FailoverResult, type PlatformEmail } from './providers'

export interface PlatformSender {
  email: string
  name: string
  replyTo: string | null
}

export interface EmailPlatform {
  sender: PlatformSender | null
  instances: EmailInstance[]
}

const TTL_MS = 60_000
let cache: { at: number; value: EmailPlatform } | null = null

export function invalidateEmailPlatform(): void {
  cache = null
}

function envFallback(): EmailPlatform {
  const key = process.env.BREVO_API_KEY
  const useBrevo = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase() === 'brevo' && !!key
  const from = process.env.EMAIL_FROM_ADDRESS
  return {
    sender: from ? { email: from, name: process.env.EMAIL_FROM_NAME || BRAND_NAME, replyTo: null } : null,
    instances: useBrevo ? [{ id: 'env', kind: 'brevo', name: 'Brevo (environment)', config: {}, secrets: { api_key: key! } }] : [],
  }
}

type Raw = {
  sender: { fromAddress: string | null; fromName: string | null; replyTo: string | null } | null
  instances: { id: string; kind: string; name: string; config: Record<string, unknown>; secrets: string | null }[]
}

/** The sender and the enabled instances (decrypted), healthy first. Cached for a minute. Never throws. */
export async function loadEmailPlatform(db?: SupabaseClient, now: () => number = Date.now): Promise<EmailPlatform> {
  if (cache && now() - cache.at < TTL_MS) return cache.value
  const env = envFallback()
  let value: EmailPlatform = env
  try {
    const { data, error } = await (db ?? supabaseAdmin()).rpc('email_platform_config')
    if (error) throw new Error(error.message)
    const raw = data as Raw | null
    const instances: EmailInstance[] = []
    for (const i of raw?.instances ?? []) {
      let secrets: Record<string, string> = {}
      try { secrets = await decryptSecretsObject(i.secrets) } catch (e) { console.error('[email] cannot decrypt', i.id, e instanceof Error ? e.message : e) }
      instances.push({ id: i.id, kind: i.kind, name: i.name, config: i.config ?? {}, secrets })
    }
    const s = raw?.sender
    value = {
      sender: s?.fromAddress ? { email: s.fromAddress, name: s.fromName || BRAND_NAME, replyTo: s.replyTo ?? null } : env.sender,
      instances: instances.length ? instances : env.instances,
    }
  } catch (e) {
    console.error('[email] could not load platform email settings:', e instanceof Error ? e.message : e)
  }
  cache = { at: now(), value }
  return value
}

export async function platformSender(db?: SupabaseClient): Promise<PlatformSender | null> {
  return (await loadEmailPlatform(db)).sender
}

export async function platformEmailEnabled(db?: SupabaseClient): Promise<boolean> {
  const p = await loadEmailPlatform(db)
  return p.instances.length > 0 && p.sender !== null
}

/** Send one email through the provider chain. `from` defaults to the platform sender. */
export async function sendPlatformEmail(
  message: Omit<PlatformEmail, 'from' | 'replyTo'> & { from?: PlatformEmail['from']; replyTo?: string | null },
  opts: { db?: SupabaseClient; fetch?: typeof fetch } = {},
): Promise<FailoverResult> {
  const p = await loadEmailPlatform(opts.db)
  const from = message.from ?? (p.sender ? { email: p.sender.email, name: p.sender.name } : { email: '' })
  const admin = opts.db ?? supabaseAdmin()
  return sendWithFailover(p.instances, { ...message, from, replyTo: message.replyTo ?? p.sender?.replyTo ?? null }, {
    fetch: opts.fetch,
    report: async (id, ok, err) => {
      if (id === 'env') return
      await admin.rpc('email_instance_report', { p_id: id, p_ok: ok, p_error: err ?? null })
    },
  })
}
