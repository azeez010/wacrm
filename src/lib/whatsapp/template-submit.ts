import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveWhatsAppConfig, resolveWhatsAppCredentials, AmbiguousConnectionError, NoConnectionError } from '@/lib/whatsapp/resolve-config'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureMediaHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

function buildTemplateRow(
  accountId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
    whatsappConfigId: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    // Which WABA/connection this template belongs to — a template
    // approved under one WABA doesn't exist under another, so this
    // disambiguates accounts with more than one connection.
    whatsapp_config_id: extras.whatsappConfigId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

type ExistingTemplate = {
  id: string
  status: string | null
  meta_template_id: string | null
}

function isUnsubmittedDraft(existing: ExistingTemplate) {
  return existing.meta_template_id === null && (existing.status ?? 'DRAFT') === 'DRAFT'
}

async function findExistingTemplate(
  supabase: SupabaseClient,
  accountId: string,
  payload: TemplatePayload,
  whatsappConfigId: string | null,
) {
  let query = supabase
    .from('message_templates')
    .select('id, status, meta_template_id')
    .eq('account_id', accountId)
    .eq('name', payload.name)
    .eq('language', payload.language)
  // Scope by connection when known — a name/language pair can
  // legitimately repeat across two different WABAs on the same
  // account (060_whatsapp_multi_connection.sql).
  query = whatsappConfigId ? query.eq('whatsapp_config_id', whatsappConfigId) : query.is('whatsapp_config_id', null)
  return query.maybeSingle<ExistingTemplate>()
}

async function saveTemplateRow(
  supabase: SupabaseClient,
  existingDraftId: string | null,
  userId: string,
  row: ReturnType<typeof buildTemplateRow>,
) {
  if (existingDraftId) {
    return supabase
      .from('message_templates')
      .update(row)
      .eq('id', existingDraftId)
      .eq('account_id', row.account_id)
      .is('meta_template_id', null)
      .select()
      .single()
  }
  return supabase
    .from('message_templates')
    .insert({ ...row, user_id: userId })
    .select()
    .single()
}

/**
 * Validate a template payload, submit it to Meta for approval and
 * persist it locally. Shared by the dashboard route
 * (/api/whatsapp/templates/submit, cookie session) and the public API
 * (/api/v1/templates, API key) so both behave identically.
 *
 * Callers are responsible for authenticating the caller and enforcing
 * role/scope. Returns a Response in the dashboard's `{ error }` /
 * `{ success, template }` shape; throws only on unexpected errors.
 */
export async function submitTemplateForAccount(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  payload: TemplatePayload,
): Promise<Response> {
  if (payload.category === 'Authentication') {
    return NextResponse.json(
      {
        error:
          t('templates.authNotSupported'),
      },
      { status: 400 },
    )
  }

  try {
    validateTemplatePayload(payload)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : t('templates.validationFailed') },
      { status: 400 },
    )
  }

  const requestedConfigId =
    typeof (payload as unknown as { whatsapp_config_id?: unknown }).whatsapp_config_id === 'string'
      ? (payload as unknown as { whatsapp_config_id: string }).whatsapp_config_id
      : null

  const dryRun =
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

  // Resolve the connection this template belongs to up front — needed
  // both for the Meta submit call below and to scope the existing-
  // template lookup correctly for accounts with more than one
  // connection. Dry-run tolerates having none configured at all
  // (CI/local dev), since there's no real WABA to submit against.
  let configId: string | null = null
  if (!dryRun) {
    try {
      const config = await resolveWhatsAppConfig(supabase, accountId, requestedConfigId)
      if (!config.waba_id) {
        return NextResponse.json({ error: t('common.wabaIdMissing') }, { status: 400 })
      }
      configId = config.id
    } catch (err) {
      if (err instanceof AmbiguousConnectionError) {
        return NextResponse.json(
          { error: 'This account has more than one WhatsApp connection — specify whatsapp_config_id.' },
          { status: 400 },
        )
      }
      if (err instanceof NoConnectionError) {
        return NextResponse.json({ error: t('common.whatsappNotConfiguredConnect') }, { status: 400 })
      }
      throw err
    }
  } else if (requestedConfigId) {
    configId = requestedConfigId
  }

  const { data: existing, error: existingErr } = await findExistingTemplate(
    supabase,
    accountId,
    payload,
    configId,
  )
  if (existingErr) {
    return NextResponse.json({ error: t('templates.submitFailed') }, { status: 500 })
  }
  if (existing && !isUnsubmittedDraft(existing)) {
    return NextResponse.json(
      {
        error: t('templates.alreadyExists', {
          name: payload.name,
          language: payload.language,
        }),
      },
      { status: 409 },
    )
  }
  const existingDraftId = existing?.id ?? null

  let metaTemplateId: string
  let metaStatus: string

  if (dryRun) {
    metaTemplateId = `dry-run-${crypto.randomUUID()}`
    metaStatus = 'PENDING'
  } else {
    // configId was resolved above; re-resolve the full row (cheap,
    // avoids threading the whole config object through the dry-run
    // branch above just for its id).
    const config = await resolveWhatsAppConfig(supabase, accountId, configId)
    if (!config.waba_id) {
      return NextResponse.json({ error: t('common.wabaIdMissing') }, { status: 400 })
    }
    const accessToken = resolveWhatsAppCredentials(config).accessToken

    // Media headers (image/video/document) need a Resumable-Upload
    // handle (Meta rejects a plain URL at creation). Derive it from
    // header_media_url before building the payload. Surfaces a 400 with
    // an actionable message (missing META_APP_ID, unreachable URL,
    // wrong type/size).
    try {
      await ensureMediaHeaderHandle(payload, accessToken)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : t('templates.headerUploadFailed') },
        { status: 400 },
      )
    }

    const metaPayload = buildMetaTemplatePayload(payload)
    try {
      const meta = await submitMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        payload: metaPayload,
      })
      metaTemplateId = meta.id
      metaStatus = meta.status
    } catch (e) {
      const message = e instanceof Error ? e.message : t('templates.metaSubmitFailed')
      // Persist the failure so the user can retry; row stays DRAFT
      // until they fix and re-submit.
      await saveTemplateRow(
        supabase,
        existingDraftId,
        userId,
        buildTemplateRow(accountId, payload, {
          status: 'DRAFT',
          metaTemplateId: null,
          submissionError: message,
          whatsappConfigId: configId,
        }),
      )
      const isRateLimit = /\b429\b/.test(message)
      return NextResponse.json(
        {
          error: isRateLimit
            ? t('templates.rateLimit')
            : message,
        },
        { status: isRateLimit ? 429 : 502 },
      )
    }
  }

  const { data: row, error: saveErr } = await saveTemplateRow(
    supabase,
    existingDraftId,
    userId,
    buildTemplateRow(accountId, payload, {
      status: normalizeStatus(metaStatus),
      metaTemplateId,
      submissionError: null,
      whatsappConfigId: configId,
    }),
  )

  if (saveErr) {
    // The submit succeeded on Meta's side but we failed to persist
    // locally. That's a data-drift state — surface the meta_template_id
    // so the user can recover via "Sync from Meta".
    return NextResponse.json(
      {
        error: t('templates.submittedSaveFailed', { message: saveErr.message }),
        meta_template_id: metaTemplateId,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    template: row,
    dry_run: dryRun,
  })
}
