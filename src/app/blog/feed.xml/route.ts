import { fetchFeedPosts } from '@/lib/blog/api'
import { buildRss } from '@/lib/blog/rss'

// Latest 20 posts with full content, for feed readers.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return new Response(buildRss(await fetchFeedPosts()), {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=300' },
    })
  } catch {
    // A temporary API failure must not serve an empty feed (readers would drop items).
    return new Response('Feed temporarily unavailable', { status: 503, headers: { 'retry-after': '120', 'cache-control': 'no-store' } })
  }
}
