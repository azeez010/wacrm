import { NextResponse } from 'next/server'
import { getPublicPlans } from '@/lib/billing/public-plans'

// Public, unauthenticated pricing data (not tenant-scoped).
export async function GET() {
  const plans = await getPublicPlans()
  return NextResponse.json(
    { data: plans },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  )
}
