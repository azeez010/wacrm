import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { BookOpen, Calculator, FileText, Home, LifeBuoy, Link2, MessagesSquare, Scale, Tag } from 'lucide-react'
import { BlogShell } from '@/components/blog/blog-shell'
import { GoBackButton } from '@/components/go-back-button'
import { NotFoundIllustration } from '@/components/not-found-illustration'
import { buttonVariants } from '@/components/ui/button'
import { isLocale } from '@/i18n/locales'
import { localizedPath } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

/** Shown for any URL that does not exist, and when a public page calls notFound(). */
export default async function NotFound() {
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : 'en'
  const fr = locale === 'fr'
  const t = await getTranslations('NotFound')
  const f = await getTranslations('Footer')
  const to = (path: string) => localizedPath(locale, path)
  const home = to('/')
  const places = [
    { label: f('pricing'), href: `${home}#pricing`, icon: Tag },
    { label: f('solutions'), href: fr ? '/fr/solutions/crm-whatsapp' : '/solutions/whatsapp-crm', icon: MessagesSquare },
    { label: f('compare'), href: fr ? '/fr/compare' : '/compare', icon: Scale },
    { label: f('whatsappPricing'), href: fr ? '/fr/solutions/tarifs-api-whatsapp-business' : '/solutions/whatsapp-business-api-pricing', icon: Calculator },
    { label: f('templates'), href: '/templates', icon: FileText },
    { label: f('linkGenerator'), href: '/free-tools/whatsapp-link-generator', icon: Link2 },
    { label: f('help'), href: to('/help'), icon: LifeBuoy },
    { label: f('blog'), href: to('/blog'), icon: BookOpen },
  ]
  return (
    <BlogShell>
      <section className="mx-auto flex max-w-3xl flex-col items-center py-12 text-center sm:py-16">
        <NotFoundIllustration label={t('alt')} />
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-primary">{t('eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-4 max-w-xl text-muted-foreground">{t('body')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={home} className={cn(buttonVariants({ size: 'lg' }))}>
            <Home className="size-4" aria-hidden />
            {t('home')}
          </Link>
          <GoBackButton label={t('back')} fallback={home} />
        </div>
      </section>

      <nav aria-labelledby="nf-popular" className="mx-auto max-w-3xl">
        <h2 id="nf-popular" className="text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('popular')}
        </h2>
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {places.map(({ label, href, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center text-sm font-medium transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-5 text-primary" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </BlogShell>
  )
}
