import { describe, expect, it } from 'vitest'
import { docsFallbackHtml } from './docs-fallback'

describe('docsFallbackHtml', () => {
  const html = docsFallbackHtml('https://example.test')

  it('has a heading, the base URL and a link to the spec', () => {
    expect(html).toContain('<h1>')
    expect(html).toContain('https://example.test/api/v1')
    expect(html).toContain('/api/v1/openapi.json')
  })

  it('lists endpoints grouped by tag', () => {
    expect(html).toMatch(/<h2>Messages<\/h2>/)
    expect(html).toMatch(/<code>(GET|POST) \/[^<]+<\/code>/)
  })

  it('never injects raw markup', () => {
    expect(html).not.toMatch(/<script/i)
  })
})
