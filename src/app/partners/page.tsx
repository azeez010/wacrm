import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Gift, Link2, Users, Wallet } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Partner.public')
  return { title: t('metaTitle', { brand: BRAND_NAME }), description: t('metaDescription', { brand: BRAND_NAME }), robots: { index: true, follow: true } }
}

async function commissionPercent(): Promise<number> {
  try {
    const { data } = await supabaseAdmin().from('partner_settings').select('commission_percent').eq('id', 1).maybeSingle()
    return Number(data?.commission_percent ?? 20)
  } catch {
    return 20
  }
}

export default async function PartnersPage() {
  const t = await getTranslations('Partner.public')
  const percent = await commissionPercent()
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const signedIn = Boolean(data.user)
  const steps = [
    { icon: Link2, title: t('step1Title'), body: t('step1Body') },
    { icon: Users, title: t('step2Title'), body: t('step2Body') },
    { icon: Wallet, title: t('step3Title'), body: t('step3Body', { percent }) },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label={BRAND_NAME}>
          <BrandLogo className="text-lg" markClassName="h-9 w-9" />
        </Link>
        <Link href={signedIn ? '/affiliate' : '/login'} className={cn(buttonVariants({ variant: 'outline' }))}>
          {signedIn ? t('openDashboard') : t('login')}
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <section className="py-12 text-center sm:py-16">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Gift className="size-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{t('heading')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">{t('sub', { percent, brand: BRAND_NAME })}</p>
          <div className="mt-8">
            <Link href={signedIn ? '/affiliate' : '/signup'} className={cn(buttonVariants({ size: 'lg' }))}>
              {signedIn ? t('openDashboard') : t('cta')}
            </Link>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-center text-2xl font-semibold">{t('howTitle')}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={i} className="rounded-xl border bg-card p-5">
                <s.icon className="mb-3 size-5 text-primary" />
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-12 text-center text-sm text-muted-foreground">{t('note')}</p>
      </main>
    </div>
  )
}
