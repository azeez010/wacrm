import { brevoProvider } from './brevo'
import type { CrmProvider, EmailProvider } from './types'

// Picks the CRM / email provider from the environment. Everything defaults to
// "none": with no CRM_PROVIDER / EMAIL_PROVIDER (or no key) the layer is a
// no-op and nothing is queued, so the app behaves exactly as before.

function chosen(envName: string): string {
  return (process.env[envName] || 'none').trim().toLowerCase()
}

export function getCrmProvider(): CrmProvider | null {
  if (chosen('CRM_PROVIDER') === 'brevo' && process.env.BREVO_API_KEY) return brevoProvider
  return null
}

export function getEmailProvider(): EmailProvider | null {
  if (chosen('EMAIL_PROVIDER') === 'brevo' && process.env.BREVO_API_KEY) return brevoProvider
  return null
}

export const isCrmEnabled = () => getCrmProvider() !== null
export const isEmailEnabled = () => getEmailProvider() !== null
