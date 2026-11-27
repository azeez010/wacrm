import type { MarketRate } from './whatsapp-rates'

export type CostInput = { marketing: number; utility: number; authentication: number; service: number; numbers: number }

const FREE_SERVICE_PER_NUMBER = 1000
const clean = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** Meta's monthly charge for a message mix in one market (USD). Service messages get 1,000 free per number. */
export function monthlyCost(rate: MarketRate, input: CostInput) {
  const freeService = FREE_SERVICE_PER_NUMBER * Math.max(1, clean(input.numbers))
  const paidService = Math.max(0, clean(input.service) - freeService)
  const lines = {
    marketing: clean(input.marketing) * rate.marketing,
    utility: clean(input.utility) * rate.utility,
    authentication: clean(input.authentication) * rate.authentication,
    service: paidService * rate.service,
  }
  const total = lines.marketing + lines.utility + lines.authentication + lines.service
  return { lines, paidService, freeService, total }
}
