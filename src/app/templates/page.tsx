import type { Metadata } from 'next'
import Link from 'next/link'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { CopyButton } from '@/components/marketing/copy-button'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { TEMPLATE_EXAMPLES } from '@/lib/marketing/templates'
import { breadcrumbJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

const TITLE = 'Free WhatsApp message templates'
const DESCRIPTION = 'Copy-and-paste WhatsApp message templates for orders, deliveries, bookings, reminders and verification codes, grouped by industry.'

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${BRAND_NAME}` },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/templates` },
  openGraph: { type: 'website', siteName: BRAND_NAME, title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/templates` },
}

export default function TemplatesPage() {
  const industries = [...new Set(TEMPLATE_EXAMPLES.map((t) => t.industry))]
  const ld = graph(breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Message templates', path: '/templates' }]))
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Message templates' }]} />
      <header className="mx-auto max-w-3xl py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{TITLE}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{DESCRIPTION}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          WhatsApp needs every business-started message to use a template it has approved. Copy one, change the wording to match your business, and submit it in {BRAND_NAME}. Approval usually takes minutes to a day.
        </p>
        <div className="mt-6">
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>Create your templates free</Link>
        </div>
      </header>

      {industries.map((industry) => (
        <section key={industry} className="mx-auto mb-12 max-w-4xl" aria-labelledby={industry}>
          <h2 id={industry} className="mb-4 text-xl font-semibold tracking-tight">{industry}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {TEMPLATE_EXAMPLES.filter((t) => t.industry === industry).map((t) => (
              <article key={t.id} className="flex flex-col rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{t.title}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t.category}</span>
                </div>
                <p className="mt-3 flex-1 whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm">{t.body}</p>
                <p className="mt-3 text-xs text-muted-foreground">{t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
                <div className="mt-3"><CopyButton text={t.body} /></div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <aside className="mx-auto max-w-3xl rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
        These are examples to start from, not approved templates. Meta decides what is approved, and it may ask you to change wording, especially for marketing messages. Only message people who agreed to hear from you.
      </aside>
    </BlogShell>
  )
}
