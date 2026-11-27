import type { Metadata } from 'next'
import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { BRAND_NAME } from '@/lib/brand'
import { MARKETING_PAGES } from '@/lib/marketing/pages'
import { pagePath } from '@/lib/marketing/route'
import { breadcrumbJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'

const COPY = {
  en: {
    path: '/compare', home: 'Home', crumb: 'Compare',
    title: 'WhatsApp CRM alternatives and comparisons',
    description: 'Compare OgaDesk with WATI, Respond.io, Interakt, Trengo, Chatwoot, DoubleTick and the WhatsApp Business app. Honest side-by-side pages to help you choose.',
    intro: 'Choosing a WhatsApp tool? These pages compare OgaDesk side by side with the options most teams consider, including when a competitor is the better fit.',
    read: 'Read the comparison',
  },
  fr: {
    path: '/fr/compare', home: 'Accueil', crumb: 'Comparer',
    title: 'Alternatives et comparatifs CRM WhatsApp',
    description: 'Comparez OgaDesk à l’application WhatsApp Business et à d’autres outils. Des pages honnêtes, côte à côte, pour vous aider à choisir.',
    intro: 'Vous choisissez un outil WhatsApp ? Ces pages comparent OgaDesk aux options les plus courantes, y compris quand une autre solution vous convient mieux.',
    read: 'Lire le comparatif',
  },
} as const

async function lang(): Promise<'en' | 'fr' | null> {
  const l = await getLocale()
  return l === 'en' || l === 'fr' ? l : null
}

export async function generateMetadata(): Promise<Metadata> {
  const l = (await lang()) ?? 'en'
  const c = COPY[l]
  const url = `${SITE_URL}${c.path}`
  const title = `${c.title} | ${BRAND_NAME}`
  return {
    title: { absolute: title },
    description: c.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: BRAND_NAME, title, description: c.description, url },
  }
}

export default async function ComparePage() {
  const l = await lang()
  if (!l) permanentRedirect('/compare')
  const c = COPY[l]
  const pages = MARKETING_PAGES.filter((p) => p.kind === 'compare' && (p.lang ?? 'en') === l)
  const ld = graph(
    breadcrumbJsonLd([{ name: c.home, path: l === 'en' ? '/' : '/fr' }, { name: c.crumb, path: c.path }]),
    {
      '@type': 'ItemList',
      itemListElement: pages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: `${SITE_URL}${pagePath(p)}` })),
    },
  )
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: c.home, href: l === 'en' ? '/' : '/fr' }, { name: c.crumb }]} />
      <header className="mx-auto max-w-3xl py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{c.title}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{c.intro}</p>
      </header>
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={pagePath(p)} className="flex flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary">
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{p.metaDescription}</p>
            <span className="mt-3 text-sm font-medium text-primary">{c.read} →</span>
          </Link>
        ))}
      </div>
    </BlogShell>
  )
}
