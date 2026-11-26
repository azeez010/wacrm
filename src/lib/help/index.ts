import type { Locale } from '@/i18n/locales'
import generated from './content.generated.json'

export interface HelpArticle {
  slug: string
  title: string
  summary: string
  order: number
  html: string
  toc: { id: string; text: string; level: number }[]
}
export interface HelpCategory {
  id: string
  emoji: string
  title: string
  description: string
  order: number
  articles: HelpArticle[]
}

const content = generated as Record<string, HelpCategory[]>

/**
 * The help centre in one language. English is the complete set; a translated category or article
 * (same folder / file name under content/help/<lang>/) replaces its English one, so a language
 * can be translated a page at a time without ever showing a hole.
 */
export function getHelp(locale: Locale): HelpCategory[] {
  const en = content.en ?? []
  if (locale === 'en') return en
  const local = content[locale] ?? []
  return en.map((cat) => {
    const lc = local.find((c) => c.id === cat.id)
    return {
      ...cat,
      ...(lc ? { emoji: lc.emoji, title: lc.title, description: lc.description } : {}),
      articles: cat.articles.map((a) => lc?.articles.find((x) => x.slug === a.slug) ?? a),
    }
  })
}

export function findCategory(locale: Locale, id: string): HelpCategory | undefined {
  return getHelp(locale).find((c) => c.id === id)
}

export function findArticle(locale: Locale, categoryId: string, slug: string) {
  const cat = findCategory(locale, categoryId)
  const index = cat?.articles.findIndex((a) => a.slug === slug) ?? -1
  if (!cat || index < 0) return undefined
  return { category: cat, article: cat.articles[index]!, previous: cat.articles[index - 1], next: cat.articles[index + 1] }
}

/** Flat list for the search box and the sitemap. */
export function helpIndex(locale: Locale) {
  return getHelp(locale).flatMap((c) =>
    c.articles.map((a) => ({ category: c.title, categoryId: c.id, slug: a.slug, title: a.title, summary: a.summary })),
  )
}
