// ============================================================
// Website sources: find the pages to index. Sitemaps first (robots.txt
// "Sitemap:" lines, then /sitemap.xml, following sitemap indexes), and a
// small same-site link crawl from the start URL when there is no sitemap.
// Everything is filtered by host, include/exclude prefixes and robots.txt.
// ============================================================

import { extractLinks } from './html'
import { inScope, parseRobots, parseSitemap, type CrawlScope, type RobotsRules } from './crawl-rules'
import { fetchPage, type PageFetcher } from './fetch'

export interface WebsiteConfig {
  startUrl: string
  maxPages: number
  include: string[]
  exclude: string[]
}

export interface DiscoveryResult {
  urls: string[]
  via: 'sitemap' | 'links'
}

const MAX_SITEMAP_FETCHES = 10
/** Pages fetched only to find links when there is no sitemap. */
const MAX_LINK_CRAWL_FETCHES = 25

export async function discoverWebsitePages(
  config: WebsiteConfig,
  fetcher: PageFetcher = fetchPage,
  deadline: number = Date.now() + 25_000,
): Promise<DiscoveryResult> {
  const start = new URL(config.startUrl)
  const origin = start.origin

  let robots: RobotsRules = { disallow: [], allow: [], sitemaps: [] }
  try {
    robots = parseRobots((await fetcher(`${origin}/robots.txt`)).body)
  } catch {
    // no robots.txt → no rules
  }
  const scope: CrawlScope = {
    host: start.hostname,
    include: config.include,
    exclude: config.exclude,
    robots,
  }

  const found = new Set<string>()
  const add = (u: string) => {
    const ok = inScope(u, scope)
    if (ok && found.size < config.maxPages) found.add(ok)
  }

  // 1. Sitemaps.
  const queue = robots.sitemaps.length > 0 ? [...robots.sitemaps] : [`${origin}/sitemap.xml`]
  const seenSitemaps = new Set<string>()
  while (queue.length > 0 && seenSitemaps.size < MAX_SITEMAP_FETCHES && found.size < config.maxPages && Date.now() < deadline) {
    const sm = queue.shift() as string
    if (seenSitemaps.has(sm)) continue
    seenSitemaps.add(sm)
    try {
      const parsed = parseSitemap((await fetcher(sm)).body)
      queue.push(...parsed.sitemaps)
      parsed.urls.forEach(add)
    } catch {
      // missing or broken sitemap → try the next / fall back to links
    }
  }
  if (found.size > 0) {
    // The start page itself first, when in scope, so it is indexed early.
    const first = inScope(config.startUrl, scope)
    const urls = [...found]
    if (first && !found.has(first)) urls.unshift(first)
    return { urls: urls.slice(0, config.maxPages), via: 'sitemap' }
  }

  // 2. Same-site link crawl from the start page.
  const firstPage = inScope(config.startUrl, { ...scope, include: [], exclude: [] })
  if (!firstPage) return { urls: [], via: 'links' }
  const frontier = [firstPage]
  const visited = new Set<string>()
  add(firstPage)
  while (frontier.length > 0 && visited.size < MAX_LINK_CRAWL_FETCHES && found.size < config.maxPages && Date.now() < deadline) {
    const next = frontier.shift() as string
    if (visited.has(next)) continue
    visited.add(next)
    try {
      const page = await fetcher(next)
      for (const link of extractLinks(page.body, page.url)) {
        const ok = inScope(link, scope)
        if (!ok || found.has(ok)) continue
        add(ok)
        frontier.push(ok)
      }
    } catch {
      // skip pages that fail
    }
  }
  return { urls: [...found], via: 'links' }
}
