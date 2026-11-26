import { describe, expect, it } from 'vitest'
import { LOCALES } from '@/i18n/locales'
import { findArticle, getHelp, helpIndex } from './index'

describe('help centre content', () => {
  it('has categories with articles, unique slugs and rendered html', () => {
    const cats = getHelp('en')
    expect(cats.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const c of cats) {
      expect(c.articles.length).toBeGreaterThan(0)
      for (const a of c.articles) {
        const key = `${c.id}/${a.slug}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
        expect(a.title).toBeTruthy()
        expect(a.html).toContain('<p>')
        expect(a.html).not.toMatch(/<script/i)
      }
    }
  })

  it('every language shows the full set (English fallback)', () => {
    const en = helpIndex('en').map((a) => `${a.categoryId}/${a.slug}`)
    for (const l of LOCALES) expect(helpIndex(l).map((a) => `${a.categoryId}/${a.slug}`)).toEqual(en)
  })

  it('finds an article with its neighbours', () => {
    const first = getHelp('en')[0]!
    const r = findArticle('fr', first.id, first.articles[0]!.slug)
    expect(r?.article.title).toBeTruthy()
    expect(r?.previous).toBeUndefined()
    expect(findArticle('en', first.id, 'nope')).toBeUndefined()
  })
})
