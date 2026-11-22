import { timingSafeEqual } from 'node:crypto'

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Guard for the scheduler endpoints: `x-cron-secret` must equal AUTOMATION_CRON_SECRET (the one shared cron secret). */
export function cronAuthorized(request: Request): 'ok' | 'forbidden' | 'unconfigured' {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return 'unconfigured'
  const given = request.headers.get('x-cron-secret') ?? ''
  return safeEqual(given, expected) ? 'ok' : 'forbidden'
}
