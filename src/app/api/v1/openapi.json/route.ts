import { NextResponse } from 'next/server'
import { buildOpenApiSpec } from '@/lib/api/v1/openapi'
import { SITE_URL } from '@/lib/seo'

// The public OpenAPI document. No authentication: it describes the API, not
// anyone's data. Rendered by /docs and usable by SDK generators and Postman.
export async function GET() {
  return NextResponse.json(buildOpenApiSpec(SITE_URL), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  })
}
