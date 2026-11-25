// Server-side heading ids + table of contents, copied from tradersense-web src/app/blog/toc.ts.
// Change: any id already on a heading is replaced, so a heading never ends up with two id attributes.
export type TocItem = { level: 2 | 3; id: string; text: string }

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
}

function slugify(text: string, seen: Map<string, number>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

export function injectHeadingIdsAndBuildToc(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = []
  const seen = new Map<string, number>()
  const withIds = html.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag: string, attrs: string, inner: string) => {
    const level = (tag.toLowerCase() === 'h2' ? 2 : 3) as 2 | 3
    const text = stripTags(inner)
    if (!text) return match
    const id = slugify(text, seen)
    toc.push({ level, id, text })
    const cleanAttrs = attrs.replace(/\s+id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    return `<${tag}${cleanAttrs} id="${id}">${inner}</${tag}>`
  })
  return { html: withIds, toc }
}

/**
 * External links in post bodies open safely and don't pass ranking credit to unknown sites
 * unless they are ours. Internal links (relative or ogadesk.com) are left as plain links.
 */
export function hardenLinks(html: string, siteHost: string): string {
  return html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi, (match, before: string, href: string, after: string) => {
    let host = ''
    try {
      host = new URL(href).host
    } catch {
      return match
    }
    if (host === siteHost || host.endsWith(`.${siteHost}`)) return match
    const attrs = `${before}${after}`.replace(/\s*(rel|target)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    return `<a ${attrs.trim()} href="${href}" rel="noopener noreferrer nofollow" target="_blank">`.replace(/<a\s+href/, '<a href')
  })
}

/** Images in post bodies load lazily and decode off the main thread. */
export function lazyImages(html: string): string {
  return html.replace(/<img(?![^>]*\sloading=)/gi, '<img loading="lazy" decoding="async"')
}
