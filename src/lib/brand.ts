// The product name and legal identity shown to people. Rename the product here
// (plus the Sidebar, SignupPage and Metadata strings in messages/*.json) and the
// landing page, page titles and legal pages follow.
export const BRAND_NAME = 'OgaDesk'

// Who operates the service, for the Privacy Policy and Terms. Override per
// deployment with NEXT_PUBLIC_COMPANY_NAME / NEXT_PUBLIC_SUPPORT_EMAIL.
export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'OgaDesk Ltd'
// Registration details (CAC certificate, incorporated 25 November 2026).
export const COMPANY_RC_NUMBER = 'RC 10031354'
export const COMPANY_COUNTRY = 'Nigeria'
export const COMPANY_ADDRESS = 'No 2, Aanuoluwapo, Olosan, Ogooluwa, Osogbo, Osun State, Nigeria'
export const COMPANY_LEGAL_LINE = `${COMPANY_NAME}, a company registered in ${COMPANY_COUNTRY} (${COMPANY_RC_NUMBER})`

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'getogadesk@gmail.com'

// Bump when the Privacy Policy or Terms change materially.
export const LEGAL_LAST_UPDATED = '25 November 2026'
