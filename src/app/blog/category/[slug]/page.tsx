import type { Metadata } from 'next'
import { ListView, listMetadata } from '@/components/blog/list-view'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return listMetadata({ page: 1, categorySlug: (await params).slug })
}

export default async function BlogCategoryPage({ params }: Props) {
  return <ListView page={1} categorySlug={(await params).slug} />
}
