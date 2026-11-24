// The pre-computed stats stored on forms.stats_cache (migration 087) and small
// helpers to show them. Pure, so the list, the API serializer and tests share it.

export interface FormStats {
  window_days: number
  views: number
  visitors: number
  starts: number
  leads: number
  /** Accepted leads where a follow-up step failed. */
  attention: number
  /** leads / visitors as a percentage, null when nobody opened the form. */
  conversion: number | null
  last_lead_at: string | null
  /** Daily lead counts for the last 14 days, oldest first. */
  spark: number[]
}

/** Read the cache defensively: it is JSON written by the database. */
export function parseFormStats(raw: unknown): FormStats | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    window_days: num(o.window_days) || 30,
    views: num(o.views),
    visitors: num(o.visitors),
    starts: num(o.starts),
    leads: num(o.leads),
    attention: num(o.attention),
    conversion: typeof o.conversion === 'number' && Number.isFinite(o.conversion) ? o.conversion : null,
    last_lead_at: typeof o.last_lead_at === 'string' ? o.last_lead_at : null,
    spark: Array.isArray(o.spark) ? o.spark.map(num) : [],
  }
}

/** Totals across forms for the one-line summary above the list. */
export function summarizeStats(all: (FormStats | null)[]): { leads: number; views: number; visitors: number; conversion: number | null } | null {
  const present = all.filter((s): s is FormStats => !!s)
  if (present.length === 0) return null
  const leads = present.reduce((n, s) => n + s.leads, 0)
  const views = present.reduce((n, s) => n + s.views, 0)
  const visitors = present.reduce((n, s) => n + s.visitors, 0)
  return { leads, views, visitors, conversion: visitors > 0 ? Math.min(100, Math.round((1000 * leads) / visitors) / 10) : null }
}

/** 1200 -> "1.2K". */
export function compactNumber(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** "2 hours ago" style text. `now` is injectable for tests. */
export function timeAgo(iso: string, locale?: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(Math.round(seconds / 1), 'second').replace(/^in 0 seconds$/, 'now')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}
