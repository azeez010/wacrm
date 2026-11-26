import { describe, it, expect } from 'vitest'
import { decodeEntities, extractLinks, htmlToText } from './html'

describe('htmlToText', () => {
  const page = `<!doctype html><html><head><title>Returns &amp; refunds | Acme</title>
    <style>.x{color:red}</style><script>var secret = 1</script></head>
    <body><header><nav><a href="/">Home</a> Menu</nav></header>
    <h1>Returns</h1><p>You can return items within <b>30&nbsp;days</b>.</p>
    <ul><li>Unused</li><li>With receipt</li></ul>
    <!-- comment --><footer>© Acme</footer></body></html>`

  it('keeps the content and drops scripts, styles, nav and footer', () => {
    const { title, text } = htmlToText(page)
    expect(title).toBe('Returns & refunds | Acme')
    expect(text).toContain('Returns')
    expect(text).toContain('You can return items within 30 days .')
    expect(text).toContain('Unused')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('Menu')
    expect(text).not.toContain('© Acme')
  })

  it('turns blocks into paragraphs the chunker can split on', () => {
    const { text } = htmlToText('<p>One</p><p>Two</p>')
    expect(text).toBe('One\n\nTwo')
  })

  it('prefers <main> when it holds real content', () => {
    const main = 'x'.repeat(250)
    const { text } = htmlToText(`<div>Sidebar junk</div><main><p>${main}</p></main>`)
    expect(text).toBe(main)
  })
})

describe('extractLinks', () => {
  it('resolves relative links and drops fragments and non-http', () => {
    const html = `<a href="/help#top">a</a><a href='faq.html'>b</a><a href="mailto:x@y.z">c</a><a href="https://other.com/p">d</a>`
    expect(extractLinks(html, 'https://acme.com/docs/')).toEqual([
      'https://acme.com/help',
      'https://acme.com/docs/faq.html',
      'https://other.com/p',
    ])
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('&lt;b&gt; &#39;x&#39; &#x2014; &unknown;')).toBe("<b> 'x' — &unknown;")
  })
})
