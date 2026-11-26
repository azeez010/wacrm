import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarketingPageView } from '@/components/marketing/marketing-page-view'
import { BRAND_NAME } from '@/lib/brand'
import { getMarketingPage, MARKETING_PAGES } from '@/lib/marketing/pages'
import { SITE_URL } from '@/lib/seo'

type Props = { params: Promise<{ slug: string }> }
const KIND = 'compare' as const

export function generateStaticParams() {
  return MARKETING_PAGES.filter((p) => p.kind === KIND).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getMarketingPage(KIND, (await params).slug)
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } }
  const url = `${SITE_URL}/${KIND}/${page.slug}`
  const title = `${page.metaTitle} | ${BRAND_NAME}`
  return {
    title: { absolute: title },
    description: page.metaDescription,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: BRAND_NAME, title, description: page.metaDescription, url },
    twitter: { card: 'summary', title, description: page.metaDescription },
  }
}

export default async function Page({ params }: Props) {
  const page = getMarketingPage(KIND, (await params).slug)
  if (!page) notFound()
  return <MarketingPageView page={page} />
}
