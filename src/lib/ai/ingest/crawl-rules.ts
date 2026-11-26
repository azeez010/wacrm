// ============================================================
// Pure helpers for website sources: sitemap and robots.txt parsing, and
// which URLs a crawl may take.
// ============================================================

import { decodeEntities } from './html'

export interface SitemapResult {
  /** Page URLs (<urlset>). */
  urls: string[]
  /** Child sitemaps (<sitemapindex>). */
  sitemaps: string[]
}

export function parseSitemap(xml: string): SitemapResult {
  const locs = (block: string) =>
    [...block.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim()))
  if (/<sitemapindex\b/i.test(xml)) return { urls: [], sitemaps: locs(xml) }
  return { urls: locs(xml), sitemaps: [] }
}

export interface RobotsRules {
  disallow: string[]
  allow: string[]
  sitemaps: string[]
}

/** The rules for user-agent `*` (we don't identify as a named bot). */
export function parseRobots(txt: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] }
  let applies = false
  let inAgentBlock = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'sitemap') {
      if (value) rules.sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      // Consecutive user-agent lines form one group.
      if (!inAgentBlock) applies = false
      inAgentBlock = true
      if (value === '*') applies = true
      continue
    }
    inAgentBlock = false
    if (!applies) continue
    if (key === 'disallow' && value) rules.disallow.push(value)
    if (key === 'allow' && value) rules.allow.push(value)
  }
  return rules
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$')
  const body = anchored ? rule.slice(0, -1) : rule
  const pattern = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path)
}

/** Longest matching rule wins; allow wins a tie. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let best = { len: -1, allow: true }
  for (const r of rules.allow) if (ruleMatches(r, path) && r.length >= best.len) best = { len: r.length, allow: true }
  for (const r of rules.disallow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: false }
  return best.allow
}

export interface CrawlScope {
  host: string
  include: string[]
  exclude: string[]
  robots: RobotsRules
}

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|css|js|json|xml|zip|gz|mp4|mp3|webm|woff2?|ttf|pdf|docx?|xlsx?|pptx?)$/i

/** Normalised URL when it is in scope for the crawl, else null. */
export function inScope(rawUrl: string, scope: CrawlScope): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname.replace(/^www\./, '') !== scope.host.replace(/^www\./, '')) return null
  if (SKIP_EXTENSIONS.test(url.pathname)) return null
  const path = url.pathname || '/'
  if (scope.include.length > 0 && !scope.include.some((p) => path.startsWith(p))) return null
  if (scope.exclude.some((p) => path.startsWith(p))) return null
  if (!robotsAllows(scope.robots, path)) return null
  url.hash = ''
  return url.toString()
}

/** Path prefixes from a request body (each starting with "/"). */
export function parsePathPrefixes(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : []
  return list
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .slice(0, 20)
}
