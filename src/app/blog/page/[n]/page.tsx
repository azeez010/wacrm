import type { Metadata } from 'next'
import { ListView, listMetadata, parsePage } from '@/components/blog/list-view'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ n: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return listMetadata({ page: parsePage((await params).n) })
}

export default async function BlogPageN({ params }: Props) {
  return <ListView page={parsePage((await params).n)} />
}
