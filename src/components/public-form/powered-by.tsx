import { stringsFor } from '@/lib/forms/public-strings';

// The OgaDesk mark + wordmark for the public form footer. Built from the brand kit
// (public/brand/ogadesk-symbol-gradient.svg, "Oga" in ink and "Desk" in green) but
// coloured from the FORM's own theme variables (see src/lib/forms/theme.ts): the app's
// BrandLogo uses Tailwind dark: tokens that do not exist inside an embedded form.

export function PoweredBy({ lang, origin }: { lang?: string; origin?: string }) {
  const t = stringsFor(lang);
  const base = origin ?? '';
  return (
    <a
      href={`${base}/?utm_source=form&utm_medium=powered_by`}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-auto flex w-fit items-center gap-1.5 pt-1 text-[11px] no-underline"
      style={{ color: 'var(--og-muted)' }}
      aria-label={`${t.poweredBy} OgaDesk`}
    >
      <span>{t.poweredBy}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${base}/brand/ogadesk-symbol-gradient.svg`} alt="" aria-hidden className="size-4 shrink-0" />
      <span className="font-bold tracking-tight">
        <span style={{ color: 'var(--og-fg)' }}>Oga</span>
        <span style={{ color: 'var(--og-brand)' }}>Desk</span>
      </span>
    </a>
  );
}
