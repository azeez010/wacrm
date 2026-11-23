// ============================================================
// Delete a message template: on Meta first (when it was submitted), then the local row.
// Shared by the dashboard route and the public API so both behave the same.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { getT } from '@/lib/i18n/translate'
import { decrypt } from '@/lib/whatsapp/encryption'
import { deleteMessageTemplate } from '@/lib/whatsapp/meta-api'

const t = getT('Api')

export function templatesDryRun(): boolean {
  return process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' || process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
}

export type DeleteTemplateResult = { ok: true; dryRun: boolean } | { ok: false; status: number; message: string }

/** Caller must already have checked the role / scope. Always scoped by account. */
export async function deleteTemplateForAccount(db: SupabaseClient, accountId: string, id: string): Promise<DeleteTemplateResult> {
  const { data: existing, error: lookupErr } = await db
    .from('message_templates')
    .select('id, name, meta_template_id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (lookupErr || !existing) return { ok: false, status: 404, message: t('templates.notFound') }

  if (existing.meta_template_id && !templatesDryRun()) {
    const { data: config, error: configError } = await db.from('whatsapp_config').select('*').eq('account_id', accountId).single()
    if (configError || !config || !config.waba_id) return { ok: false, status: 400, message: t('templates.notConfiguredDelete') }
    try {
      await deleteMessageTemplate({
        wabaId: config.waba_id,
        accessToken: decrypt(config.access_token),
        name: existing.name,
        metaTemplateId: existing.meta_template_id,
      })
    } catch (e) {
      return { ok: false, status: 502, message: e instanceof Error ? e.message : t('templates.metaDeleteFailed') }
    }
  }

  const { error: delErr } = await db.from('message_templates').delete().eq('id', id).eq('account_id', accountId)
  if (delErr) return { ok: false, status: 500, message: t('templates.deletedLocalFailed', { message: delErr.message }) }
  return { ok: true, dryRun: templatesDryRun() }
}
