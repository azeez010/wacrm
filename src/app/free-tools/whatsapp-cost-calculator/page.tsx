import type { Metadata } from 'next'
import Link from 'next/link'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { WaCostTool } from '@/components/marketing/wa-cost-tool'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { RATES_CHECKED, RATES_EFFECTIVE, RATES_URL } from '@/lib/marketing/whatsapp-rates'
import { breadcrumbJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

const TITLE = 'WhatsApp Business API cost calculator'
const DESCRIPTION =
  'Estimate what Meta charges for your WhatsApp messages each month in Nigeria, South Africa, Egypt, the rest of Africa and more, using Meta’s current rates.'
const URL = `${SITE_URL}/free-tools/whatsapp-cost-calculator`

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${BRAND_NAME}` },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: URL },
  openGraph: { type: 'website', siteName: BRAND_NAME, title: TITLE, description: DESCRIPTION, url: URL },
}

export default function Page() {
  const ld = graph(
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'WhatsApp cost calculator', path: '/free-tools/whatsapp-cost-calculator' },
    ]),
  )
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'WhatsApp cost calculator' }]} />
      <header className="mx-auto max-w-3xl py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{TITLE}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{DESCRIPTION}</p>
      </header>
      <div className="mx-auto max-w-4xl">
        <WaCostTool />
      </div>
      <section className="mx-auto mt-10 max-w-3xl text-sm text-muted-foreground">
        <p>
          Rates come from Meta’s USD rate card effective {RATES_EFFECTIVE}, last checked on {RATES_CHECKED}. Confirm
          current prices on{' '}
          <a href={RATES_URL} className="text-primary underline" rel="noopener noreferrer" target="_blank">
            Meta’s pricing page
          </a>
          .{' '}
          <Link href="/solutions/whatsapp-business-api-pricing" className="text-primary underline">
            How WhatsApp pricing works
          </Link>
          .
        </p>
        <div className="mt-8 text-center">
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
            Try {BRAND_NAME} free
          </Link>
        </div>
      </section>
    </BlogShell>
  )
}
