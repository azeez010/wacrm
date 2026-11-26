import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs, pageLocale } from '@/components/blog/parts'
import { BRAND_NAME } from '@/lib/brand'
import { findCategory } from '@/lib/help'
import { localizedAlternates, localizedPath } from '@/lib/seo'

type Props = { params: Promise<{ category: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale()
  const cat = findCategory(locale, (await params).category)
  if (!cat) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: `${cat.title} | ${BRAND_NAME}`,
    description: cat.description,
    robots: { index: true, follow: true },
    alternates: localizedAlternates(locale, `/help/${cat.id}`),
  }
}

export default async function HelpCategoryPage({ params }: Props) {
  const locale = await pageLocale()
  const t = await getTranslations('Help')
  const to = (path: string) => localizedPath(locale, path)
  const cat = findCategory(locale, (await params).category)
  if (!cat) notFound()
  return (
    <BlogShell>
      <Breadcrumbs items={[{ name: t('back'), href: to('/help') }, { name: cat.title }]} />
      <header className="pb-6 pt-2">
        <span className="text-4xl" aria-hidden>{cat.emoji}</span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{cat.title}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{cat.description}</p>
      </header>
      <ul className="divide-y rounded-xl border">
        {cat.articles.map((a) => (
          <li key={a.slug}>
            <Link href={to(`/help/${cat.id}/${a.slug}`)} className="block px-5 py-4 hover:bg-accent">
              <span className="block font-medium">{a.title}</span>
              <span className="block text-sm text-muted-foreground">{a.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </BlogShell>
  )
}
