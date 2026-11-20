import { BRAND_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/ogadesk-symbol-gradient.svg"
        alt=""
        aria-hidden
        className={cn('shrink-0', markClassName)}
      />
      <span className={cn('font-bold tracking-tight', className)}>
        <span className="text-foreground">{first}</span>
        <span className="text-[#11875D] dark:text-[#2AC58B]">{second}</span>
      </span>
    </span>
  )
}
