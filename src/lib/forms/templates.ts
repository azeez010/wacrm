import { getT } from '@/lib/i18n/translate'
import type { FormField, FormKind, FormSettings } from './types'
import { formSettingsSchema } from './types'

// Starter forms (static code, like flows). Copy comes from the StarterForms
// i18n namespace; field labels are left empty so the public form's own
// per-language defaults ("WhatsApp number", "Name"...) are used.

const t = getT('StarterForms')

export type FormTemplateSlug = 'blank' | 'support' | 'contact' | 'newsletter' | 'webinar' | 'quote' | 'event'

export interface FormTemplate {
  slug: FormTemplateSlug
  kind: FormKind
  name: string
  description: string
  fields: FormField[]
  settings: FormSettings
}

const phone: FormField = { id: 'phone', kind: 'phone', required: true }
const name = (required = true): FormField => ({ id: 'name', kind: 'name', required })
const email = (required = false): FormField => ({ id: 'email', kind: 'email', required })
const company: FormField = { id: 'company', kind: 'company' }
const message = (required = false): FormField => ({ id: 'message', kind: 'message', required })
const consent = (): FormField => ({
  id: 'consent',
  kind: 'consent',
  required: true,
  consentText: t('consent'),
})

function settings(over: Record<string, unknown>): FormSettings {
  return formSettingsSchema.parse({ success: { action: 'message', message: t('thanks') }, ...over })
}

export function getFormTemplate(slug: string): FormTemplate | null {
  switch (slug as FormTemplateSlug) {
    case 'support':
      return {
        slug: 'support',
        kind: 'support',
        name: t('support.name'),
        description: t('support.description'),
        fields: [phone, name(false), message(true)],
        settings: settings({
          title: t('support.title'),
          autoTag: 'support',
          buttonText: t('support.button'),
          success: {
            action: 'whatsapp',
            message: t('support.thanks'),
            whatsappText: t('support.whatsappText', { name: '{{name}}', message: '{{message}}' }),
            followUpLine: true,
          },
          widget: { corner: 'bottom-left', offsetX: 20, offsetY: 20, icon: 'whatsapp', label: t('support.label'), greeting: t('support.greeting'), showOn: 'all', devices: 'all' },
        }),
      }
    case 'contact':
      return {
        slug: 'contact',
        kind: 'lead',
        name: t('contact.name'),
        description: t('contact.description'),
        fields: [phone, name(), email(), message(), consent()],
        settings: settings({ title: t('contact.title'), description: t('contact.intro') }),
      }
    case 'newsletter':
      return {
        slug: 'newsletter',
        kind: 'lead',
        name: t('newsletter.name'),
        description: t('newsletter.description'),
        fields: [phone, name(false), email(true), consent()],
        settings: settings({ title: t('newsletter.title'), description: t('newsletter.intro') }),
      }
    case 'webinar':
      return {
        slug: 'webinar',
        kind: 'lead',
        name: t('webinar.name'),
        description: t('webinar.description'),
        fields: [phone, name(), email(true), company, consent()],
        settings: settings({ title: t('webinar.title'), description: t('webinar.intro') }),
      }
    case 'quote':
      return {
        slug: 'quote',
        kind: 'lead',
        name: t('quote.name'),
        description: t('quote.description'),
        fields: [phone, name(), company, message(true), consent()],
        settings: settings({ title: t('quote.title'), description: t('quote.intro') }),
      }
    case 'event':
      return {
        slug: 'event',
        kind: 'lead',
        name: t('event.name'),
        description: t('event.description'),
        fields: [phone, name(), consent()],
        settings: settings({ title: t('event.title'), description: t('event.intro') }),
      }
    case 'blank':
      return {
        slug: 'blank',
        kind: 'lead',
        name: t('blank.name'),
        description: t('blank.description'),
        fields: [phone, name()],
        settings: settings({ title: t('blank.title') }),
      }
    default:
      return null
  }
}

