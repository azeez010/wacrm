// Announcements written in the platform admin console (migration 108). Two sources:
//   in-app   public.active_announcements(account)  (Supabase RPC, members only)
//   landing  GET {ADMIN_API}/announcements/landing (public, edge-cached)
// Text arrives as {locale: text} maps with English as the fallback, so no translation keys are needed here.

export type Severity = 'info' | 'success' | 'warning' | 'critical'
export type LocaleText = Partial<Record<string, string>>
export interface Announcement {
  id: string
  severity: Severity
  title: LocaleText
  body: LocaleText
  linkUrl: string | null
  linkLabel: LocaleText
  dismissible: boolean
}

const SEVERITIES: Severity[] = ['info', 'success', 'warning', 'critical']

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
    return [{
      id: a.id,
      severity: SEVERITIES.includes(a.severity as Severity) ? (a.severity as Severity) : 'info',
      title: obj(a.title), body: obj(a.body), linkUrl: link, linkLabel: obj(a.linkLabel),
      dismissible: a.dismissible !== false,
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
