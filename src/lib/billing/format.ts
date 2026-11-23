/** "NGN 15,000" / "NGN 0": always the amount, never the word "Free" (the plan name already says it). */
export function formatPlanPrice(amount: number | string, currency: string, locale: string): string {
  const n = Number(amount)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}
