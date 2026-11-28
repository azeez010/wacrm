import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKETING_PAGES } from './pages'
import { CASE_STUDIES, caseStudyPath, caseStudyToMarkdown } from './case-studies'

describe('case studies', () => {
  it('have unique slugs, SEO-sized metadata, a FAQ, unique section ids and valid related links', () => {
    expect(new Set(CASE_STUDIES.map((c) => c.slug)).size).toBe(CASE_STUDIES.length)
    for (const c of CASE_STUDIES) {
      expect(c.metaDescription.length).toBeGreaterThan(80)
      expect(c.metaDescription.length).toBeLessThanOrEqual(165)
      expect(c.faq.length).toBeGreaterThanOrEqual(3)
      expect(new Set(c.sections.map((s) => s.id)).size).toBe(c.sections.length)
      for (const r of c.related) expect(MARKETING_PAGES.some((p) => p.slug === r)).toBe(true)
      expect(caseStudyPath(c)).toBe(`/case-studies/${c.slug}`)
    }
  })

  it('never contain a real-looking secret or key', () => {
    const text = JSON.stringify(CASE_STUDIES)
    expect(text).not.toMatch(/wacrm_live_[A-Za-z0-9_-]{10,}/)
    expect(text).not.toMatch(/sk_(live|test)_/)
  })

  it('code samples are balanced (every opening bracket closes)', () => {
    for (const c of CASE_STUDIES) {
      for (const s of c.sections) {
        for (const b of s.blocks) {
          if (b.type !== 'code') continue
          for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']] as const) {
            expect(b.code.split(open).length, `${c.slug}/${s.id}: ${open}${close}`).toBe(b.code.split(close).length)
          }
        }
      }
    }
  })

  it('the Markdown copy in docs/ is the same text as the page', () => {
    for (const c of CASE_STUDIES) {
      const file = join(__dirname, '../../../docs', `case-study-${c.slug}.md`)
      const md = caseStudyToMarkdown(c)
      if (process.env.UPDATE_DOCS === '1') writeFileSync(file, md)
      expect(existsSync(file), `missing ${file}; run: UPDATE_DOCS=1 npx vitest run src/lib/marketing/case-studies.test.ts`).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(md)
    }
  })
})
