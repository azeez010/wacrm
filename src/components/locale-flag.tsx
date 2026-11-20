import type { Locale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

/**
 * Small inline SVG flags for the language picker. Emoji flags don't
 * render on Windows, so these are drawn instead. English → UK, Portuguese →
 * Brazil, Spanish → Spain, Korean → South Korea, French → France.
 * Simplified artwork - recognisable at 20-28px, not a vexillology reference.
 */
const FLAGS: Record<Locale, React.ReactNode> = {
  en: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.6" />
    </>
  ),
  fr: (
    <>
      <rect width="10" height="20" fill="#002395" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ED2939" />
    </>
  ),
  es: (
    <>
      <rect width="30" height="20" fill="#AA151B" />
      <rect y="5" width="30" height="10" fill="#F1BF00" />
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#009B3A" />
      <path d="M15 2.5L27 10L15 17.5L3 10Z" fill="#FEDF00" />
      <circle cx="15" cy="10" r="4.6" fill="#002776" />
      <path d="M10.7 9.2Q15 8 19.3 10.8" stroke="#fff" strokeWidth="0.9" fill="none" />
    </>
  ),
  ko: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <path d="M10.5 10a4.5 4.5 0 0 1 9 0z" fill="#CD2E3A" />
      <path d="M10.5 10a4.5 4.5 0 0 0 9 0z" fill="#0047A0" />
      <g stroke="#000" strokeWidth="1.3">
        <path d="M4.2 4.6l3-2.1M5.2 6l3-2.1" />
        <path d="M22.8 2.5l3 2.1M21.8 3.9l3 2.1" />
        <path d="M4.2 15.4l3 2.1M5.2 14l3 2.1" />
        <path d="M22.8 17.5l3-2.1M21.8 16l3-2.1" />
      </g>
    </>
  ),
}

export function LocaleFlag({
  locale,
  className,
}: {
  locale: Locale
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 30 20"
      aria-hidden
      className={cn('h-4 w-6 shrink-0 rounded-[3px] ring-1 ring-black/10', className)}
    >
      {FLAGS[locale]}
    </svg>
  )
}
