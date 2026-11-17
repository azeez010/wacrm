import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getPublicPlans } from '@/lib/billing/public-plans'
import { FEATURE_DEFS, LIMIT_DEFS, type LimitKey, type PlanRow } from '@/lib/billing/plans'

export const metadata: Metadata = {
  title: 'WhatsApp CRM for growing teams',
  description:
    'Shared inbox, broadcasts, automations and chatbot flows on the official WhatsApp Business API. Connect a new number or keep your existing app.',
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

function money(amount: number, currency: string) {
  if (amount === 0) return 'Free'
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function limitText(v: number | null | undefined) {
  if (v === null) return 'Unlimited'
  if (v === undefined) return '-'
  return v.toLocaleString('en-US')
}

function PlanCard({ plan }: { plan: PlanRow }) {
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
            Most popular
          </span>
        )}
      </div>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
      <p className="mt-4">
        <span className="text-3xl font-bold">{money(plan.price_monthly, plan.currency)}</span>
        {plan.price_monthly > 0 && <span className="text-sm text-muted-foreground"> / month</span>}
      </p>
      {plan.price_annual > 0 && (
        <p className="text-xs text-muted-foreground">
          or {money(plan.price_annual, plan.currency)} billed yearly
        </p>
      )}
      <Link
        href={`/signup?plan=${encodeURIComponent(plan.id)}`}
        className={cn(
          buttonVariants({ variant: plan.is_featured ? 'default' : 'outline' }),
          'mt-5 w-full',
        )}
      >
        {plan.price_monthly === 0 ? 'Start free' : `Get ${plan.name}`}
      </Link>
      <ul className="mt-6 space-y-2 text-sm">
        {HEADLINE_LIMITS.map((k) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{LIMIT_DEFS[k]}</span>
            <span className="font-medium">{limitText(plan.limits[k])}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-5 space-y-2 border-t pt-5 text-sm">
        {(Object.keys(FEATURE_DEFS) as (keyof typeof FEATURE_DEFS)[]).map((f) => {
          const on = plan.features[f] === true
          return (
            <li key={f} className={cn('flex items-start gap-2', !on && 'text-muted-foreground/60')}>
              {on ? (
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0" />
              )}
              {FEATURE_DEFS[f]}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Safety net: if Supabase falls back to the Site URL (redirect not on
  // its allow-list) the email link lands here with ?code=… - hand it to
  // the auth callback instead of showing the landing page.
  const sp = await searchParams
  const code = typeof sp.code === 'string' ? sp.code : null
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`)

  const plans = await getPublicPlans()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-lg font-semibold">WACRM</span>
        <nav className="flex items-center gap-2">
          <a href="#pricing" className={buttonVariants({ variant: 'ghost' })}>
            Pricing
          </a>
          <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
            Log in
          </Link>
          <Link href="/signup" className={buttonVariants()}>
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Run your whole business on WhatsApp
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            A shared team inbox, broadcasts, automations and chatbot flows on the official WhatsApp
            Business API. Sign up with Meta in a few clicks, get a new number, or keep using the
            one on your WhatsApp Business app.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Start free
            </Link>
            <a href="#pricing" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>
              See pricing
            </a>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-3 sm:px-6">
          {[
            ['Connect in minutes', 'Embedded Signup with Meta, no developer account needed. Or bring your own Meta app.'],
            ['Keep your existing number', 'Link your WhatsApp Business app and import your chat history.'],
            ['Built for teams', 'Multiple numbers, roles, a shared inbox and a public API.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border bg-card p-6">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <h2 className="text-center text-3xl font-bold">Simple pricing</h2>
          <p className="mt-2 text-center text-muted-foreground">
            Start free. Upgrade when you outgrow it.
          </p>
          {plans.length === 0 ? (
            <p className="mt-10 text-center text-muted-foreground">
              Pricing is unavailable right now, please check back shortly.
            </p>
          ) : (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <PlanCard key={p.id} plan={p} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} WACRM ·{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </footer>
    </div>
  )
}
