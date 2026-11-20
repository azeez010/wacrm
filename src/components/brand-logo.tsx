import { BRAND_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

// The one place the mark file is referenced (brand kit symbol, public/brand/).
const BRAND_MARK_SRC = '/brand/ogadesk-symbol-gradient.svg'

/**
 * The standalone OgaDesk mark (the chat-bubble symbol), no wordmark.
 * Defaults to the size used on auth cards; pass a size class to override.
 */
export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string
  /** Hide from assistive tech when the name is already next to it. */
  decorative?: boolean
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_MARK_SRC}
      alt={decorative ? '' : BRAND_NAME}
      aria-hidden={decorative || undefined}
      className={cn('h-14 w-14 shrink-0', className)}
    />
  )
}

/**
 * The OgaDesk mark plus wordmark. The wordmark is live text rather than
 * the SVG lockup so it uses the app font and flips for dark mode.
 * Mark file: public/brand/ogadesk-symbol-gradient.svg (brand kit).
 */
export function BrandLogo({
  className,
  markClassName,
}: {
  className?: string
  markClassName?: string
}) {
  // BRAND_NAME is "OgaDesk": two-tone as in the kit (Oga in ink, Desk in emerald).
  const split = BRAND_NAME.indexOf('D', 1)
  const first = split > 0 ? BRAND_NAME.slice(0, split) : BRAND_NAME
  const second = split > 0 ? BRAND_NAME.slice(split) : ''
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark decorative className={markClassName} />
      <span className={cn('font-bold tracking-tight', className)}>
        <span className="text-foreground">{first}</span>
        <span className="text-[#11875D] dark:text-[#2AC58B]">{second}</span>
      </span>
    </span>
  )
}
