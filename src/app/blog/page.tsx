import type { Metadata } from 'next'
import { ListView, listMetadata } from '@/components/blog/list-view'

// Rendered per request; the API responses are cached at Cloudflare's edge (see lib/blog/api.ts).
export const dynamic = 'force-dynamic'

export function generateMetadata(): Promise<Metadata> {
  return listMetadata({ page: 1 })
}

export default function BlogIndexPage() {
  return <ListView page={1} />
}
