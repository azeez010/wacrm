import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CaseStudyView } from '@/components/marketing/case-study-view'
import { BRAND_NAME } from '@/lib/brand'
import { CASE_STUDIES, caseStudyPath, getCaseStudy } from '@/lib/marketing/case-studies'
import { SITE_URL } from '@/lib/seo'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return CASE_STUDIES.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = getCaseStudy((await params).slug)
  if (!c) return { title: 'Not found', robots: { index: false, follow: false } }
  const url = `${SITE_URL}${caseStudyPath(c)}`
  const title = `${c.metaTitle} | ${BRAND_NAME}`
  return {
    title: { absolute: title },
    description: c.metaDescription,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { type: 'article', siteName: BRAND_NAME, title, description: c.metaDescription, url },
    twitter: { card: 'summary', title, description: c.metaDescription },
  }
}

export default async function Page({ params }: Props) {
  const c = getCaseStudy((await params).slug)
  if (!c) notFound()
  return <CaseStudyView study={c} />
}
