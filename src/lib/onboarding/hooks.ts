// What happens when something notable occurs in a workspace. Callers invoke these
// from request handlers; every one is safe to await (it never throws) and does
// its slow work after the response has been sent.

import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { crmSyncAccount, crmTrack } from '@/lib/crm'
import { ensureOtpTemplate, wantsDeveloperSetup } from './otp-template'

function later(label: string, fn: () => Promise<unknown>) {
  const run = () =>
    fn().catch((err) => console.error(`[onboarding] ${label} failed:`, err instanceof Error ? err.message : err))
  try {
    after(run)
  } catch {
    // Outside a request (script/test): run it now.
    return run()
  }
}

/** A WhatsApp number was connected (manually or through Embedded Signup). */
export async function onWhatsAppConnected(
  accountId: string,
  configId: string,
  properties: Record<string, string | number | boolean> = {},
) {
  await crmTrack('whatsapp_connected', { accountId, properties })
  later('auto OTP template', async () => {
    const db = supabaseAdmin()
    // Developers get their authentication template without having to ask for it.
    if (await wantsDeveloperSetup(db, accountId)) await ensureOtpTemplate(db, accountId, configId)
  })
}

export async function onWhatsAppDisconnected(accountId: string) {
  await crmTrack('whatsapp_disconnected', { accountId })
}

export async function onApiKeyCreated(accountId: string, userId: string) {
  await crmTrack('api_key_created', { userId, accountId })
}

/** Team or plan facts changed: refresh everyone in the workspace. */
export async function onWorkspaceChanged(accountId: string) {
  await crmSyncAccount(accountId)
}
