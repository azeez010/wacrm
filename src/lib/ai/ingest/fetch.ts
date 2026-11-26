// ============================================================
// Fetch a public web page / sitemap / robots.txt safely:
//   - http(s) only, and every hop (including redirects, followed by hand)
//     must resolve to a public address (SSRF guard shared with webhooks);
//   - a timeout and a byte cap on the body;
//   - text-like content types only.
// ============================================================

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { KNOWLEDGE_LIMITS } from './limits'

export class FetchPageError extends Error {
  constructor(
    public code: 'invalid_url' | 'blocked' | 'http' | 'timeout' | 'too_large' | 'unsupported' | 'network',
    message: string,
  ) {
    super(message)
    this.name = 'FetchPageError'
  }
}

export interface FetchedPage {
  url: string
  contentType: string
  body: string
}

export type PageFetcher = (url: string) => Promise<FetchedPage>

const ACCEPTED = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/xml|application\/xml|application\/rss\+xml|text\/markdown)/i

export function normalizeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export const fetchPage: PageFetcher = async (rawUrl) => {
  let url = normalizeHttpUrl(rawUrl)
  if (!url) throw new FetchPageError('invalid_url', `Not a valid web address: ${rawUrl}`)

  for (let hop = 0; hop <= KNOWLEDGE_LIMITS.maxRedirects; hop++) {
    if (!(await isDeliverableUrl(url))) {
      throw new FetchPageError('blocked', `This address can't be fetched: ${url}`)
    }
    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(KNOWLEDGE_LIMITS.fetchTimeoutMs),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8',
        },
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new FetchPageError('timeout', `Timed out fetching ${url}`)
      }
      throw new FetchPageError('network', `Could not reach ${url}`)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new FetchPageError('http', `Redirect without a location from ${url}`)
      const next = normalizeHttpUrl(new URL(location, url).toString())
      if (!next) throw new FetchPageError('invalid_url', `Bad redirect from ${url}`)
      url = next
      continue
    }
    if (!res.ok) throw new FetchPageError('http', `${url} returned HTTP ${res.status}`)

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !ACCEPTED.test(contentType)) {
      throw new FetchPageError('unsupported', `${url} is not a web page (${contentType.split(';')[0]})`)
    }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > KNOWLEDGE_LIMITS.maxFetchBytes) {
      throw new FetchPageError('too_large', `${url} is too large`)
    }
    return { url, contentType, body: await readCapped(res, url) }
  }
  throw new FetchPageError('http', `Too many redirects from ${rawUrl}`)
}

async function readCapped(res: Response, url: string): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > KNOWLEDGE_LIMITS.maxFetchBytes) {
      await reader.cancel()
      throw new FetchPageError('too_large', `${url} is too large`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}
