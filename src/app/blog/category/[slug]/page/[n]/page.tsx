import type { Metadata } from 'next'
import { ListView, listMetadata, parsePage } from '@/components/blog/list-view'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string; n: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, n } = await params
  return listMetadata({ page: parsePage(n), categorySlug: slug })
}

export default async function BlogCategoryPageN({ params }: Props) {
  const { slug, n } = await params
  return <ListView page={parsePage(n)} categorySlug={slug} />
}
