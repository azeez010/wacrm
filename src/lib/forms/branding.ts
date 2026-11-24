// Logo and background layout options for hosted / embedded forms. Pure, so the
// public page, the editor preview and tests share one definition.

export const LOGO_ALIGNS = ['left', 'center', 'right'] as const
export type LogoAlign = (typeof LOGO_ALIGNS)[number]

export const LOGO_SIZES = ['small', 'medium', 'large'] as const
export type LogoSize = (typeof LOGO_SIZES)[number]

export const BACKGROUND_FITS = ['cover', 'contain', 'tile'] as const
export type BackgroundFit = (typeof BACKGROUND_FITS)[number]

export const BACKGROUND_POSITIONS = ['top', 'center', 'bottom'] as const
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number]

export const BACKGROUND_OVERLAYS = ['none', 'soft', 'strong'] as const
export type BackgroundOverlay = (typeof BACKGROUND_OVERLAYS)[number]

/** Defaults reproduce how forms looked before these options existed. */
export const BRANDING_DEFAULTS = {
  logoAlign: 'left' as LogoAlign,
  logoSize: 'medium' as LogoSize,
  backgroundFit: 'cover' as BackgroundFit,
  backgroundPosition: 'center' as BackgroundPosition,
  backgroundOverlay: 'soft' as BackgroundOverlay,
}

const JUSTIFY: Record<LogoAlign, string> = { left: 'justify-start', center: 'justify-center', right: 'justify-end' }
const HEIGHT: Record<LogoSize, string> = { small: 'h-7', medium: 'h-10', large: 'h-16' }

export function logoWrapperClass(align: LogoAlign = BRANDING_DEFAULTS.logoAlign): string {
  return `flex ${JUSTIFY[align]}`
}

export function logoImageClass(size: LogoSize = BRANDING_DEFAULTS.logoSize): string {
  return `${HEIGHT[size]} w-auto max-w-full object-contain`
}

/** Inline CSS for the page-background layer. */
export function backgroundCss(
  fit: BackgroundFit = BRANDING_DEFAULTS.backgroundFit,
  position: BackgroundPosition = BRANDING_DEFAULTS.backgroundPosition,
): { backgroundSize: string; backgroundRepeat: string; backgroundPosition: string } {
  return {
    backgroundSize: fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'auto',
    backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: position === 'center' ? 'center' : `center ${position}`,
  }
}

/** Share of the page colour laid over the picture so the form stays readable. */
export function overlayPercent(overlay: BackgroundOverlay = BRANDING_DEFAULTS.backgroundOverlay): number {
  return overlay === 'none' ? 0 : overlay === 'strong' ? 88 : 72
}
