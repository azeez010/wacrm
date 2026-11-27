import type { Metadata } from 'next'
import Link from 'next/link'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { WaLinkTool } from '@/components/marketing/wa-link-tool'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { breadcrumbJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

const TITLE = 'Free WhatsApp link generator (wa.me)'
const DESCRIPTION = 'Create a click-to-chat WhatsApp link with a pre-filled message. Paste it on your website, Instagram bio, ads or business card. Free, no sign-up.'
const URL = `${SITE_URL}/free-tools/whatsapp-link-generator`

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${BRAND_NAME}` },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: URL },
  openGraph: { type: 'website', siteName: BRAND_NAME, title: TITLE, description: DESCRIPTION, url: URL },
}

export default function Page() {
  const ld = graph(breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'WhatsApp link generator', path: '/free-tools/whatsapp-link-generator' }]))
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'WhatsApp link generator' }]} />
      <header className="mx-auto max-w-3xl py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{TITLE}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{DESCRIPTION}</p>
      </header>
      <div className="mx-auto max-w-xl"><WaLinkTool /></div>
      <section className="mx-auto mt-12 max-w-3xl text-sm text-muted-foreground">
        <h2 className="text-xl font-semibold text-foreground">How to use your link</h2>
        <p className="mt-3">Put the link behind a button on your website, in your Instagram or TikTok bio, in ad buttons, or in a QR code. When someone taps it, WhatsApp opens a chat with your number and your message is ready to send.</p>
        <p className="mt-3">Use the number in international format: country code first, no leading zero. For Nigeria, 0801 234 5678 becomes +234 801 234 5678.</p>
        <p className="mt-3">When many customers start chats this way, one phone cannot keep up. {BRAND_NAME} lets your whole team answer from the same number.</p>
        <div className="mt-6 text-center">
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>Try {BRAND_NAME} free</Link>
        </div>
      </section>
    </BlogShell>
  )
}
