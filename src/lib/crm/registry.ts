import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { platformEmailEnabled, sendPlatformEmail } from '@/lib/email/platform'
import { decryptPlatformSecret } from '@/lib/payments/secrets'
import { ogadeskCrmProvider } from './ogadesk'
import { CrmError, type CrmProvider, type EmailMessage, type EmailProvider } from './types'

// Where CRM syncs and platform emails go. Both are set in the admin console (Platform settings → Email & CRM,
// migration 131):
//   CRM    OgaDesk's own workspace in this app, through its public API (./ogadesk.ts)
//   email  the email providers, tried in order with failover (@/lib/email/platform)
// With nothing set, both are off: nothing is queued and the app behaves as before.

const TTL_MS = 60_000
type CrmConfig = { enabled: boolean; baseUrl: string; apiKey: string | null; workspaceId: string | null }
let crmCache: { at: number; value: { provider: CrmProvider; workspaceId: string | null } | null } | null = null

export function invalidateCrmConfig(): void {
  crmCache = null
}

async function loadCrm(db?: SupabaseClient): Promise<{ provider: CrmProvider; workspaceId: string | null } | null> {
  if (crmCache && Date.now() - crmCache.at < TTL_MS) return crmCache.value
  let value: { provider: CrmProvider; workspaceId: string | null } | null = null
  try {
    const { data, error } = await (db ?? supabaseAdmin()).rpc('crm_platform_config')
    if (error) throw new Error(error.message)
    const c = data as CrmConfig | null
    const secretsKey = process.env.PLATFORM_SECRETS_KEY
    if (c?.enabled && c.apiKey && secretsKey) {
      const apiKey = await decryptPlatformSecret(c.apiKey, secretsKey)
      value = { provider: ogadeskCrmProvider({ baseUrl: c.baseUrl, apiKey }), workspaceId: c.workspaceId }
    }
  } catch (e) {
    console.error('[crm] could not load CRM settings:', e instanceof Error ? e.message : e)
  }
  crmCache = { at: Date.now(), value }
  return value
}

export async function getCrmProvider(): Promise<CrmProvider | null> {
  return (await loadCrm())?.provider ?? null
}

/** The OgaDesk workspace the CRM writes to: its own members are not synced into it. */
export async function crmWorkspaceId(): Promise<string | null> {
  return (await loadCrm())?.workspaceId ?? null
}

/** Sends through the platform providers; a failure of every provider becomes a CrmError the outbox can retry. */
const platformEmailProvider: EmailProvider = {
  name: 'platform',
  async send(message: EmailMessage) {
    const r = await sendPlatformEmail(message)
    if (!r.ok) throw new CrmError(r.error, r.retryable)
    return { id: r.messageId }
  },
}

export async function getEmailProvider(): Promise<EmailProvider | null> {
  return (await platformEmailEnabled()) ? platformEmailProvider : null
}

export const isCrmEnabled = async () => (await getCrmProvider()) !== null
export const isEmailEnabled = async () => (await getEmailProvider()) !== null
