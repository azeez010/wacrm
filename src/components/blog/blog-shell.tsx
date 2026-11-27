import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { SiteFooter } from '@/components/site-footer'
import { SiteBanner } from '@/components/announcements/site-banner'
import { AuthButtons } from '@/components/blog/blog-auth-buttons'
import { BrandLogo } from '@/components/brand-logo'
import { LanguageSwitcher } from '@/components/language-switcher'
import { isLocale } from '@/i18n/locales'
import { BRAND_NAME } from '@/lib/brand'
import { localizedPath } from '@/lib/seo'

// Public chrome for the blog, changelog and help centre (styled like ogadesk.com), in the URL's language.
// No auth lookup on the server, so these pages stay fast and cacheable; AuthButtons finds the session in the browser.
export async function BlogShell({ children }: { children: React.ReactNode }) {
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : 'en'
  const t = await getTranslations('Blog')
  const to = (path: string) => localizedPath(locale, path)
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteBanner locale={locale} />
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href={to('/')} aria-label={`${BRAND_NAME} ${t('home')}`}>
            <BrandLogo className="text-lg" markClassName="h-8 w-8" />
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2" aria-label="Main">
            <Link href={to('/blog')} className="hidden px-2 py-1 text-muted-foreground hover:text-foreground sm:inline">{t('blog')}</Link>
            <Link href={to('/help')} className="hidden px-2 py-1 text-muted-foreground hover:text-foreground sm:inline">{t('help')}</Link>
            <LanguageSwitcher mode="path" iconOnly />
            <AuthButtons labels={{ login: t('login'), dashboard: t('dashboard'), getStarted: t('getStarted') }} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  )
}
