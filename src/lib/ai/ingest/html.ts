// ============================================================
// HTML → readable text for web-page sources. Dependency-free on purpose
// (it runs inside the Cloudflare Worker): it removes non-content blocks,
// prefers <main>/<article>, turns block elements into paragraph breaks and
// decodes entities. Good enough for help centres, FAQs and policy pages;
// not a full Readability port.
// ============================================================

const DROP_BLOCKS = ['title', 'script', 'style', 'noscript', 'svg', 'template', 'iframe', 'head', 'nav', 'footer', 'header', 'aside', 'form', 'button', 'select']

const BLOCK_TAGS =
  /<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|tr|table|blockquote|pre|dd|dt|dl|figure|figcaption|details|summary)\b[^>]*>/gi

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

export interface ExtractedPage {
  title: string | null
  text: string
}

export function extractPageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const title = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const clean = title ? decodeEntities(title).replace(/\s+/g, ' ').trim() : ''
  return clean || null
}

export function htmlToText(html: string): ExtractedPage {
  const title = extractPageTitle(html)
  let body = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of DROP_BLOCKS) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ')
  }
  // Prefer the page's main content when it marks one.
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) body = main

  const text = decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_TAGS, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text }
}

/** Absolute http(s) links on a page, without fragments. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"'#]+)(?:#[^"']*)?["']/gi)) {
    try {
      const url = new URL(decodeEntities(m[1]), baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.hash = ''
      out.add(url.toString())
    } catch {
      // not a URL
    }
  }
  return [...out]
}
