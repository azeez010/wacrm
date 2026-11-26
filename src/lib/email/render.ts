// Renders the transactional emails in the recipient's language.
//
// Not `getT`: that is fixed to one locale at build time. Here the locale is the
// person's own, so we build a translator per call from a static loader map (a
// static map keeps the catalogues bundler-friendly; dynamic template imports
// would pull all of them in unpredictably).

import { createTranslator } from 'next-intl'
import { isLocale, type Locale } from '@/i18n/locales'
import { BRAND_NAME, COMPANY_NAME } from '@/lib/brand'
import { SITE_URL } from '@/lib/seo'

const LOADERS: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('../../../messages/en.json'),
  fr: () => import('../../../messages/fr.json'),
  es: () => import('../../../messages/es.json'),
  pt: () => import('../../../messages/pt.json'),
  ko: () => import('../../../messages/ko.json'),
  // Transactional emails for these languages are not translated yet, so they go out in English.
  ar: () => import('../../../messages/en.json'),
  hi: () => import('../../../messages/en.json'),
  id: () => import('../../../messages/en.json'),
  sw: () => import('../../../messages/en.json'),
}

export type EmailKind = 'welcome' | 'quota_80' | 'quota_100' | 'form_code'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function translator(locale: string | null | undefined) {
  const l: Locale = isLocale(locale) ? locale : 'en'
  const messages = (await LOADERS[l]()).default
  return createTranslator({ locale: l, messages: messages as never, namespace: 'Emails' as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string
}

function layout(opts: { heading: string; paragraphs: string[]; cta?: { label: string; url: string }; footer: string; code?: string }): string {
  const green = '#11875D'
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f7f6;font-family:Inter,Arial,sans-serif;color:#172A25">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#104D3C;padding-bottom:16px">${esc(BRAND_NAME)}</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${esc(opts.heading)}</td></tr>
${opts.paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px">${esc(p)}</td></tr>`).join('\n')}
${opts.code ? `<tr><td style="padding:4px 0 16px"><div style="display:inline-block;font:700 30px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:6px;color:#104D3C;background:#f1f7f4;border-radius:10px;padding:14px 20px">${esc(opts.code)}</div></td></tr>` : ''}
${opts.cta ? `<tr><td style="padding:8px 0 20px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:${green};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(opts.cta.label)}</a></td></tr>` : ''}
<tr><td style="font-size:12px;line-height:1.5;color:#6b7a76;border-top:1px solid #e3ebe8;padding-top:16px">${esc(opts.footer)}<br>${esc(COMPANY_NAME)}</td></tr>
</table></td></tr></table></body></html>`
}

function plain(heading: string, paragraphs: string[], cta?: { label: string; url: string }, footer?: string, code?: string): string {
  return [heading, '', ...paragraphs, ...(code ? ['', code] : []), ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), ...(footer ? ['', '--', footer] : [])].join('\n')
}

export interface WelcomeVars {
  name: string
  useCases: string[]
}
export interface QuotaVars {
  name: string
  planName: string
  used: number
  limit: number
}

export interface FormCodeVars {
  code: string
  formName: string
  minutes: number
}

export async function renderEmail(
  kind: 'form_code',
  locale: string | null | undefined,
  vars: FormCodeVars,
): Promise<RenderedEmail>
export async function renderEmail(
  kind: 'welcome',
  locale: string | null | undefined,
  vars: WelcomeVars,
): Promise<RenderedEmail>
export async function renderEmail(
  kind: 'quota_80' | 'quota_100',
  locale: string | null | undefined,
  vars: QuotaVars,
): Promise<RenderedEmail>
export async function renderEmail(
  kind: EmailKind,
  locale: string | null | undefined,
  vars: WelcomeVars | QuotaVars | FormCodeVars,
): Promise<RenderedEmail> {
  const t = await translator(locale)

  // A form visitor asked for this code, so the footer must not say "you have an account".
  if (kind === 'form_code') {
    const v = vars as FormCodeVars
    const heading = t('formCode.heading')
    const paragraphs = [t('formCode.body', { form: v.formName }), t('formCode.expires', { minutes: v.minutes })]
    const footer = t('formCode.footer')
    return {
      subject: t('formCode.subject', { code: v.code }),
      html: layout({ heading, paragraphs, footer, code: v.code }),
      text: plain(heading, paragraphs, undefined, footer, v.code),
    }
  }

  const footer = t('footer')
  const name = (vars as WelcomeVars | QuotaVars).name || t('fallbackName')

  if (kind === 'welcome') {
    const v = vars as WelcomeVars
    // The first picked use case decides the call to action; the rest are listed.
    const order = ['developer', 'support', 'sales', 'marketing'].filter((u) => v.useCases.includes(u))
    const primary = order[0] ?? 'support'
    const urls: Record<string, string> = {
      developer: `${SITE_URL}/docs`,
      support: `${SITE_URL}/settings?tab=whatsapp`,
      sales: `${SITE_URL}/pipelines`,
      marketing: `${SITE_URL}/broadcasts`,
    }
    const paragraphs = [t('welcome.intro'), ...(order.length ? order : [primary]).map((u) => `${t(`welcome.${u}.title`)}: ${t(`welcome.${u}.body`)}`), t('welcome.help')]
    const cta = { label: t(`welcome.${primary}.cta`), url: urls[primary] }
    const heading = t('welcome.heading', { name })
    return { subject: t('welcome.subject'), html: layout({ heading, paragraphs, cta, footer }), text: plain(heading, paragraphs, cta, footer) }
  }

  const v = vars as QuotaVars
  const level = kind === 'quota_100' ? '100' : '80'
  const values = { name, plan: v.planName, used: v.used.toLocaleString('en-US'), limit: v.limit.toLocaleString('en-US') }
  const paragraphs = [t(`quota${level}.body`, values), t(`quota${level}.advice`)]
  const cta = { label: t(`quota${level}.cta`), url: `${SITE_URL}/settings?tab=billing` }
  const heading = t(`quota${level}.heading`)
  return { subject: t(`quota${level}.subject`), html: layout({ heading, paragraphs, cta, footer }), text: plain(heading, paragraphs, cta, footer) }
}
