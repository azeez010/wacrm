import { describe, expect, it } from 'vitest'
import { MARKETING_PAGES } from './pages'
import { TEMPLATE_EXAMPLES } from './templates'

describe('marketing content', () => {
  it('has unique slugs, SEO-sized metadata, FAQs and valid related links', () => {
    const keys = MARKETING_PAGES.map((p) => `${p.kind}/${p.slug}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of MARKETING_PAGES) {
      expect(p.metaDescription.length).toBeGreaterThan(80)
      expect(p.metaDescription.length).toBeLessThanOrEqual(175)
      expect(p.faq.length).toBeGreaterThanOrEqual(3)
      for (const r of p.related) expect(MARKETING_PAGES.some((x) => x.slug === r)).toBe(true)
    }
  })

  it('template variables are numbered from 1 and match the list', () => {
    for (const t of TEMPLATE_EXAMPLES) {
      const used = [...new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
      expect(used).toEqual(t.variables.map((_, i) => i + 1))
    }
  })
})
