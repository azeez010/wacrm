import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { BrandLogo } from '@/components/brand-logo'
import { LanguageSwitcher } from '@/components/language-switcher'
import { HREFLANG, isLocale } from '@/i18n/locales'
import { localizedAlternates, localizedUrl, organizationJsonLd } from '@/lib/seo'
import { cn } from '@/lib/utils'
import { BRAND_NAME } from '@/lib/brand'
import { getPublicPlans } from '@/lib/billing/public-plans'
import { createClient } from '@/lib/supabase/server'
import { CurrencySwitcher } from '@/components/currency-switcher'
import { getDisplayCurrency, toDisplay, type DisplayCurrency } from '@/lib/currency/server'
import { FEATURE_DEFS, type FeatureKey, type LimitKey, type PlanRow } from '@/lib/billing/plans'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const t = await getTranslations({ locale, namespace: 'Landing' })
  return {
    title: { absolute: `${BRAND_NAME} — ${t('metaTitle')}` },
    description: t('metaDescription'),
    robots: { index: true, follow: true },
    alternates: localizedAlternates(locale),
    openGraph: {
      type: 'website',
      siteName: BRAND_NAME,
      title: `${BRAND_NAME} — ${t('metaTitle')}`,
      description: t('metaDescription'),
      url: localizedUrl(locale),
      locale: HREFLANG[locale].replace('-', '_'),
      images: [{ url: '/android-chrome-512x512.png', width: 512, height: 512, alt: BRAND_NAME }],
    },
    twitter: { card: 'summary', title: `${BRAND_NAME} — ${t('metaTitle')}`, description: t('metaDescription') },
  }
}

// Pricing comes from the DB; never cache an empty fallback.
export const dynamic = 'force-dynamic'

// Limits worth showing on a card, in order.
const HEADLINE_LIMITS: LimitKey[] = [
  'whatsapp_connections',
  'seats',
  'contacts',
  'messages_per_month',
  'broadcast_recipients_per_month',
  'ai_replies_per_month',
]

type Translate = (key: string, values?: Record<string, string | number>) => string

function money(amount: number, currency: string, locale: string, free: string, fx: DisplayCurrency) {
  if (amount === 0) return free
  const shown = toDisplay(fx, amount, currency)
  const text = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: shown.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(shown.amount)
  return shown.converted ? `≈ ${text}` : text
}

function limitText(v: number | null | undefined, locale: string, unlimited: string) {
  if (v === null) return unlimited
  if (v === undefined) return '-'
  return v.toLocaleString(locale)
}

function PlanCard({
  plan,
  locale,
  t,
  tb,
  signedIn,
  fx,
}: {
  plan: PlanRow
  fx: DisplayCurrency
  locale: string
  t: Translate
  tb: Translate
  signedIn: boolean
}) {
  const price = (amount: number) => money(amount, plan.currency, locale, t('pricing.free'), fx)
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-card p-6',
        plan.is_featured && 'border-primary shadow-lg ring-1 ring-primary',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {plan.is_featured && (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
            {t('pricing.mostPopular')}
          </span>
        )}
      </div>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
      <p className="mt-4">
        <span className="text-3xl font-bold">{price(plan.price_monthly)}</span>
        {plan.price_monthly > 0 && (
          <span className="text-sm text-muted-foreground"> {t('pricing.perMonth')}</span>
        )}
      </p>
      {plan.price_annual > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('pricing.yearly', { price: price(plan.price_annual) })}
        </p>
      )}
      <Link
        href={signedIn ? '/settings?tab=billing' : `/signup?plan=${encodeURIComponent(plan.id)}`}
        className={cn(
          buttonVariants({ variant: plan.is_featured ? 'default' : 'outline' }),
          'mt-5 w-full',
        )}
      >
        {plan.price_monthly === 0 ? t('pricing.startFree') : t('pricing.getPlan', { plan: plan.name })}
      </Link>
      <ul className="mt-6 space-y-2 text-sm">
        {HEADLINE_LIMITS.map((k) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{tb(`limits.${k}`)}</span>
            <span className="font-medium">
              {limitText(plan.limits[k], locale, t('pricing.unlimited'))}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-5 space-y-2 border-t pt-5 text-sm">
        {(Object.keys(FEATURE_DEFS) as FeatureKey[]).map((f) => {
          const on = plan.features[f] === true
          return (
            <li key={f} className={cn('flex items-start gap-2', !on && 'text-muted-foreground/60')}>
              {on ? (
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0" />
              )}
              {tb(`features.${f}`)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default async function LandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `[locale]` also matches any unknown single-segment URL (/foo): only the
  // languages we ship are valid.
  if (!isLocale((await params).locale)) notFound()

  // Safety net: if Supabase falls back to the Site URL (redirect not on
  // its allow-list) the email link lands here with ?code=… - hand it to
  // the auth callback instead of showing the landing page.
  const sp = await searchParams
  const code = typeof sp.code === 'string' ? sp.code : null
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`)

  // Already signed in: send people to their dashboard instead of offering login / sign-up.
  const signedIn = await createClient()
    .then((c) => c.auth.getUser())
    .then(({ data }) => !!data.user)
    .catch(() => false)

  const [plans, locale, t, tb, fx] = await Promise.all([
    getPublicPlans(),
    getLocale(),
    getTranslations('Landing'),
    getTranslations('Settings.billing'),
    getDisplayCurrency(),
  ])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationJsonLd(BRAND_NAME) }} />
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-5 sm:px-6">
        <BrandLogo className="text-lg" markClassName="h-9 w-9" />
        <nav className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <a href="#pricing" className={cn(buttonVariants({ variant: 'ghost' }), 'hidden sm:inline-flex')}>
            {t('nav.pricing')}
          </a>
          {/* The blog is English-only, so the label isn't translated. */}
          <Link href="/blog" className={cn(buttonVariants({ variant: 'ghost' }), 'hidden sm:inline-flex')}>
            Blog
          </Link>
          <LanguageSwitcher mode="path" iconOnly />
          <CurrencySwitcher current={fx.current} options={fx.options} />
          {signedIn ? (
            <Link href="/dashboard" className={buttonVariants()}>
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
                {t('nav.login')}
              </Link>
              <Link href="/signup" className={buttonVariants()}>
                {t('nav.getStarted')}
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            {t('hero.title')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            {t('hero.subtitle')}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={signedIn ? '/dashboard' : '/signup'} className={cn(buttonVariants({ size: 'lg' }))}>
              {signedIn ? t('hero.openDashboard') : t('hero.startFree')}
            </Link>
            <a href="#pricing" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>
              {t('hero.seePricing')}
            </a>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-3 sm:px-6">
          {(['f1', 'f2', 'f3'] as const).map((f) => (
            <div key={f} className="rounded-2xl border bg-card p-6">
              <h3 className="font-semibold">{t(`features.${f}Title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`features.${f}Body`)}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <h2 className="text-center text-3xl font-bold">{t('pricing.title')}</h2>
          <p className="mt-2 text-center text-muted-foreground">{t('pricing.subtitle')}</p>
          {plans.length === 0 ? (
            <p className="mt-10 text-center text-muted-foreground">
              {t('pricing.unavailable')}
            </p>
          ) : (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <PlanCard key={p.id} plan={p} locale={locale} t={t} tb={tb} signedIn={signedIn} fx={fx} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} {BRAND_NAME} ·{' '}
        <Link href={signedIn ? '/dashboard' : '/login'} className="underline">
          {signedIn ? t('nav.dashboard') : t('footer.login')}
        </Link>
        {' · '}
        <Link href="/blog" className="underline">
          Blog
        </Link>
        {' · '}
        <Link href="/changelog" className="underline">
          Changelog
        </Link>
        {' · '}
        <Link href="/docs" className="underline">
          {t('footer.apiDocs')}
        </Link>
        {' · '}
        <Link href="/partners" className="underline">
          {t('footer.partner')}
        </Link>
        {' · '}
        <Link href="/privacy" className="underline">
          {t('footer.privacy')}
        </Link>
        {' · '}
        <Link href="/terms" className="underline">
          {t('footer.terms')}
        </Link>
        {' · '}
        <Link href="/data-deletion" className="underline">
          {t('footer.dataDeletion')}
        </Link>
      </footer>
    </div>
  )
}
