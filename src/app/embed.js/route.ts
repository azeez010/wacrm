import { EMBED_SCRIPT } from '@/lib/forms/embed-script'

// The script customers paste on their site (see src/lib/forms/embed-script.ts).
export function GET() {
  return new Response(EMBED_SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
