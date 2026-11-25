import { fetchFeedPosts, imageUrl } from '@/lib/blog/api'
import { hardenLinks } from '@/lib/blog/toc'
import { BRAND_NAME } from '@/lib/brand'
import { SITE_URL } from '@/lib/seo'

// RSS 2.0 for the blog feed (tradersense had no feed). Kept out of the route file so it can be tested.
export const BLOG_DESCRIPTION_RSS = `Guides and updates on selling, support and marketing over WhatsApp, from the ${BRAND_NAME} team.`

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
// CDATA cannot contain "]]>"; split it so the section stays valid.
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
// Feed readers have no base URL, so make relative links and images absolute.
const absolutise = (html: string) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`)

export function buildRss(posts: Awaited<ReturnType<typeof fetchFeedPosts>>, now = new Date()): string {
  const host = new URL(SITE_URL).host
  const items = posts.map((p) => {
    const link = `${SITE_URL}/blog/${p.slug}`
    const img = imageUrl(p.cover_image_url)
    return [
      '<item>',
      `<title>${xmlEscape(p.title)}</title>`,
      `<link>${link}</link>`,
      `<guid isPermaLink="true">${link}</guid>`,
      `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>`,
      p.author ? `<dc:creator>${xmlEscape(p.author)}</dc:creator>` : '',
      p.category ? `<category>${xmlEscape(p.category)}</category>` : '',
      ...p.tags.map((t) => `<category>${xmlEscape(t)}</category>`),
      p.excerpt ? `<description>${xmlEscape(p.excerpt)}</description>` : '',
      `<content:encoded>${cdata(absolutise(hardenLinks(p.body_html, host)))}</content:encoded>`,
      img ? `<media:content url="${xmlEscape(img)}" medium="image"/>` : '',
      '</item>',
    ].filter(Boolean).join('')
  })
  const last = posts[0] ? new Date(posts[0].updated_at) : now
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>${xmlEscape(`${BRAND_NAME} Blog`)}</title>
<link>${SITE_URL}/blog</link>
<atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
<description>${xmlEscape(BLOG_DESCRIPTION_RSS)}</description>
<language>en</language>
<lastBuildDate>${last.toUTCString()}</lastBuildDate>
<image><url>${SITE_URL}/android-chrome-512x512.png</url><title>${xmlEscape(`${BRAND_NAME} Blog`)}</title><link>${SITE_URL}/blog</link></image>
${items.join('\n')}
</channel>
</rss>`
}

