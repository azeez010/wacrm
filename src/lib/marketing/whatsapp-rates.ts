// Meta's WhatsApp Business Platform per-message rates, copied from Meta's own USD rate card
// ("Cost per message in USD on the WhatsApp Business Platform, effective October 1, 2026"),
// downloaded from the rate card table on RATES_URL. Update this one file when Meta publishes a new card.
// Never estimate: only add a market after reading it from Meta's file.
export const RATES_URL = 'https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing'
/** Rate card effective date (ISO), as stated by Meta. */
export const RATES_EFFECTIVE = '2026-10-01'
/** Day the figures below were copied from Meta's file (ISO). */
export const RATES_CHECKED = '2026-11-27'
export const RATES_CURRENCY = 'USD'

export interface MarketRate {
  market: string
  /** French name of the market, for the /fr page. */
  marketFr: string
  /** USD per delivered message, exactly as printed by Meta. */
  marketing: number
  utility: number
  authentication: number
  /** Service messages beyond the monthly free allowance. */
  service: number
}

export const MARKET_RATES: MarketRate[] = [
  { market: 'Nigeria', marketFr: 'Nigeria', marketing: 0.0516, utility: 0.0067, authentication: 0.0067, service: 0.0067 },
  { market: 'South Africa', marketFr: 'Afrique du Sud', marketing: 0.0379, utility: 0.0095, authentication: 0.0095, service: 0.0095 },
  { market: 'Egypt', marketFr: 'Égypte', marketing: 0.0644, utility: 0.0036, authentication: 0.0036, service: 0.0036 },
  { market: 'Morocco', marketFr: 'Maroc', marketing: 0.0414, utility: 0.023, authentication: 0.023, service: 0.023 },
  { market: 'Rest of Africa (incl. Ghana, Kenya, Cameroon, Côte d’Ivoire)', marketFr: 'Reste de l’Afrique (dont Ghana, Kenya, Cameroun, Côte d’Ivoire)', marketing: 0.0225, utility: 0.004, authentication: 0.004, service: 0.004 },
  { market: 'India', marketFr: 'Inde', marketing: 0.0118, utility: 0.0014, authentication: 0.0014, service: 0.0014 },
  { market: 'Indonesia', marketFr: 'Indonésie', marketing: 0.0411, utility: 0.025, authentication: 0.025, service: 0.025 },
  { market: 'United Kingdom', marketFr: 'Royaume-Uni', marketing: 0.0635, utility: 0.022, authentication: 0.022, service: 0.022 },
  { market: 'North America', marketFr: 'Amérique du Nord', marketing: 0.025, utility: 0.0034, authentication: 0.0034, service: 0.0034 },
]
