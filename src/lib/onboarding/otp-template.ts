import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { submitTemplateForAccount } from '@/lib/whatsapp/template-submit'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import { crmTrack } from '@/lib/crm'

export const OTP_TEMPLATE_NAME = 'otp_verification'
export const OTP_TEMPLATE_LANGUAGE = 'en_US'

export type EnsureOtpTemplateResult =
  | { created: false; status: string | null }
  | { created: true; status: string | null }
  | { created: false; error: string }

/**
 * Make sure a connection has the default authentication template that
 * POST /api/v1/verifications uses (`otp_verification`, en_US, copy-code, 10 min).
 * Idempotent: if any row with that name exists for this connection (whatever its
 * status) nothing is submitted. Needs the service-role client.
 */
export async function ensureOtpTemplate(
  db: SupabaseClient,
  accountId: string,
  configId: string,
): Promise<EnsureOtpTemplateResult> {
  const { data: existing } = await db
    .from('message_templates')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('whatsapp_config_id', configId)
    .eq('name', OTP_TEMPLATE_NAME)
    .limit(1)
  if (existing && existing.length > 0) return { created: false, status: (existing[0].status as string | null) ?? null }

  const userId = await resolveAuditUserId(db, accountId)
  const payload = {
    name: OTP_TEMPLATE_NAME,
    category: 'Authentication',
    language: OTP_TEMPLATE_LANGUAGE,
    body_text: '',
    auth_options: { add_security_recommendation: true, code_expiration_minutes: 10, otp_type: 'COPY_CODE' },
    whatsapp_config_id: configId,
  } as unknown as TemplatePayload

  const res = await submitTemplateForAccount(db, accountId, userId, payload)
  const body = (await res.json().catch(() => ({}))) as { error?: string; template?: { status?: string } }
  if (!res.ok) return { created: false, error: body.error ?? `Template submission failed (${res.status})` }

  await crmTrack('otp_template_created', { accountId })
  return { created: true, status: body.template?.status ?? null }
}

/** True when the workspace said it will use the Developer API. */
export async function wantsDeveloperSetup(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data } = await db.from('accounts').select('use_cases').eq('id', accountId).maybeSingle()
  return Array.isArray(data?.use_cases) && (data.use_cases as string[]).includes('developer')
}
