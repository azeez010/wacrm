import { DEFAULT_LEAD_SOURCES, firstTouchPatch } from './lead-source'

/** Meta's `referral` object on the first message after a Click-to-WhatsApp ad / post tap. */
export interface InboundReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  media_type?: string
  ctwa_clid?: string
}

/**
 * First-touch source for a contact that just messaged us. Pure.
 *  - came from a Click-to-WhatsApp ad/post  -> "Click-to-WhatsApp ad" + campaign/ad ids
 *  - brand-new contact without a referral   -> "WhatsApp"
 *  - existing contact without a referral    -> nothing (we do not know where they came from)
 * Only empty columns are filled.
 */
export function inboundSourcePatch(
  contact: Record<string, unknown>,
  referral: InboundReferral | null | undefined,
  wasCreated: boolean,
  now: Date = new Date(),
): Record<string, string | null> {
  const hasReferral = !!referral && Object.values(referral).some((v) => typeof v === 'string' && v.trim() !== '')
  if (!hasReferral && !wasCreated) return {}
  return firstTouchPatch(
    contact,
    hasReferral
      ? {
          lead_source: DEFAULT_LEAD_SOURCES.ctwa,
          utm_source: referral?.source_type === 'post' ? 'whatsapp_post' : 'whatsapp_ad',
          utm_medium: 'click_to_whatsapp',
          // The ad / post id is the campaign identifier Meta gives us.
          utm_campaign: referral?.source_id,
          utm_content: referral?.headline,
          source_referrer: referral?.source_url,
        }
      : { lead_source: DEFAULT_LEAD_SOURCES.whatsapp },
    now,
  )
}
