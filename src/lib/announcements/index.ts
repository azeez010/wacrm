// Announcements written in the platform admin console (migration 108). Two sources:
//   in-app   public.active_announcements(account)  (Supabase RPC, members only)
//   landing  GET {ADMIN_API}/announcements/landing (public, edge-cached)
// Text arrives as {locale: text} maps with English as the fallback, so no translation keys are needed here.

export type Severity = 'info' | 'success' | 'warning' | 'critical'
/** Colour of the public website bar (in-app banners use `severity`). */
export type BarStyle = 'brand' | 'dark' | 'gradient' | Severity
export type LocaleText = Partial<Record<string, string>>
export interface Announcement {
  id: string
  severity: Severity
  title: LocaleText
  body: LocaleText
  linkUrl: string | null
  linkLabel: LocaleText
  dismissible: boolean
  /** Public bar only (migration 120). */
  style: BarStyle
  badge: LocaleText
  countdownTo: string | null
  /** ISO-2 country codes; empty = everyone. */
  countries: string[]
}

const SEVERITIES: Severity[] = ['info', 'success', 'warning', 'critical']
export const BAR_STYLES: BarStyle[] = ['brand', 'dark', 'gradient', ...SEVERITIES]

/** Text for `locale`, else its base language (pt-BR -> pt), else English, else ''. */
export function pickText(map: LocaleText | null | undefined, locale: string): string {
  if (!map) return ''
  return map[locale] || map[locale.split('-')[0] ?? ''] || map.en || ''
}

/** Keeps only well-formed items; anything odd is dropped rather than breaking the page. */
export function parseAnnouncements(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return []
  const obj = (v: unknown): LocaleText => (v && typeof v === 'object' && !Array.isArray(v) ? (v as LocaleText) : {})
  return raw.flatMap((r): Announcement[] => {
    if (!r || typeof r !== 'object') return []
    const a = r as Record<string, unknown>
    if (typeof a.id !== 'string' || !obj(a.title).en) return []
    const link = typeof a.linkUrl === 'string' && /^(https:\/\/|\/)/.test(a.linkUrl) ? a.linkUrl : null
    const countdown = typeof a.countdownTo === 'string' && !Number.isNaN(Date.parse(a.countdownTo)) ? a.countdownTo : null
    const countries = Array.isArray(a.countries) ? a.countries.filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) : []
    return [{
      id: a.id,
      severity: SEVERITIES.includes(a.severity as Severity) ? (a.severity as Severity) : 'info',
      title: obj(a.title), body: obj(a.body), linkUrl: link, linkLabel: obj(a.linkLabel),
      dismissible: a.dismissible !== false,
      style: BAR_STYLES.includes(a.style as BarStyle) ? (a.style as BarStyle) : 'brand',
      badge: obj(a.badge), countdownTo: countdown, countries,
    }]
  })
}

const KEY = 'ogd-dismissed-announcements'

export function readDismissed(storage: Pick<Storage, 'getItem'> | undefined): string[] {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function writeDismissed(storage: Pick<Storage, 'setItem'> | undefined, ids: string[]): void {
  try {
    storage?.setItem(KEY, JSON.stringify(ids.slice(-50)))
  } catch {
    /* private mode / storage full: the banner just comes back next visit */
  }
}

/** What to render: not dismissed (unless it cannot be dismissed). */
export function visibleAnnouncements(all: Announcement[], dismissed: string[]): Announcement[] {
  return all.filter((a) => !a.dismissible || !dismissed.includes(a.id))
}

export const SEVERITY_CLASS: Record<Severity, string> = {
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-100',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100',
  critical: 'border-red-500/40 bg-red-500/15 text-red-950 dark:text-red-100',
}

/** Bars meant for this visitor: no country list, or the visitor's country is on it. Unknown country = only global bars. */
export function forCountry(all: Announcement[], country: string | null | undefined): Announcement[] {
  const cc = (country ?? '').toUpperCase()
  return all.filter((a) => a.countries.length === 0 || (/^[A-Z]{2}$/.test(cc) && a.countries.includes(cc)))
}

/** Remaining time split for the countdown; null once it has passed. */
export function countdownParts(ms: number): { days: number; hours: number; minutes: number; seconds: number } | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const s = Math.floor(ms / 1000)
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}

/** Solid, high-contrast colours for the public bar, readable in light and dark mode. */
export const STYLE_CLASS: Record<BarStyle, { bar: string; button: string; badge: string }> = {
  brand: { bar: 'bg-primary text-primary-foreground', button: 'bg-background text-foreground hover:bg-background/90', badge: 'bg-primary-foreground/15 ring-primary-foreground/30' },
  dark: { bar: 'bg-zinc-950 text-white dark:bg-zinc-900 dark:border-b dark:border-white/10', button: 'bg-primary text-primary-foreground hover:bg-primary/90', badge: 'bg-amber-400 text-amber-950 ring-amber-300' },
  gradient: { bar: 'bg-gradient-to-r from-emerald-700 via-teal-600 to-sky-700 text-white', button: 'bg-white text-zinc-900 hover:bg-white/90', badge: 'bg-white/20 ring-white/40' },
  info: { bar: 'bg-sky-600 text-white dark:bg-sky-700', button: 'bg-white text-sky-900 hover:bg-white/90', badge: 'bg-white/20 ring-white/40' },
  success: { bar: 'bg-emerald-600 text-white dark:bg-emerald-700', button: 'bg-white text-emerald-900 hover:bg-white/90', badge: 'bg-white/20 ring-white/40' },
  warning: { bar: 'bg-amber-400 text-amber-950', button: 'bg-amber-950 text-amber-50 hover:bg-amber-950/90', badge: 'bg-amber-950/10 ring-amber-950/20' },
  critical: { bar: 'bg-red-600 text-white dark:bg-red-700', button: 'bg-white text-red-900 hover:bg-white/90', badge: 'bg-white/20 ring-white/40' },
}
