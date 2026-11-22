// ============================================================
// Moments in time <-> the "YYYY-MM-DDTHH:mm" text a datetime-local input
// uses, in a chosen IANA time zone (the account time zone). Without this the
// input would show UTC clock time as if it were local.
// ============================================================

const pad = (n: number) => String(n).padStart(2, '0')

/** Clock fields of an instant as seen in `tz`. */
function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') }
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in `tz` ('' when unusable). */
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const p = parts(date, tz)
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
  } catch {
    return ''
  }
}

/** "YYYY-MM-DDTHH:mm" typed in `tz` -> ISO instant ('' when unusable). */
export function fromLocalInput(local: string | null | undefined, tz: string): string {
  if (!local) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return ''
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi)
  try {
    // Offset of the zone at (about) that moment; re-check once so a clock
    // change between the guess and the real instant is handled.
    const offsetAt = (ms: number) => {
      const p = parts(new Date(ms), tz)
      return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms
    }
    let ms = asUtc - offsetAt(asUtc)
    ms = asUtc - offsetAt(ms)
    return new Date(ms).toISOString()
  } catch {
    return ''
  }
}
