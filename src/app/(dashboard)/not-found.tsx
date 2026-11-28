import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Contact, LayoutDashboard, MessageSquare } from 'lucide-react'
import { GoBackButton } from '@/components/go-back-button'
import { NotFoundIllustration } from '@/components/not-found-illustration'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Shown inside the app when a record (broadcast, flow, contact...) no longer exists. */
export default async function DashboardNotFound() {
  const t = await getTranslations('NotFound')
  const s = await getTranslations('Sidebar')
  const links = [
    { label: s('dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { label: s('inbox'), href: '/inbox', icon: MessageSquare },
    { label: s('contacts'), href: '/contacts', icon: Contact },
  ]
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center">
      <NotFoundIllustration label={t('alt')} className="max-w-xs" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{t('appTitle')}</h1>
      <p className="mt-3 text-muted-foreground">{t('appBody')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {links.map(({ label, href, icon: Icon }, i) => (
          <Link key={href} href={href} className={cn(buttonVariants({ variant: i === 0 ? 'default' : 'outline' }))}>
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
        <GoBackButton label={t('back')} fallback="/dashboard" className="h-9" />
      </div>
    </div>
  )
}
