import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { LOCALES } from '@/i18n/locales'
import { routing } from '@/i18n/routing'
import { canonicalRedirect } from '@/lib/canonical-host'
import { applyReferralCookie } from '@/lib/referral'

// Path-based language for the public landing page only (`/`, `/fr`, ...).
// The signed-in app, auth and legal pages are cookie-driven and untouched.
const intlMiddleware = createIntlMiddleware(routing)
const LOCALE_PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`)

function isLocalizedLandingPath(pathname: string): boolean {
  return (pathname.replace(LOCALE_PREFIX, '') || '/') === '/'
}

/** Public blog: anonymous, so skip the auth round trip (and keep it fast for crawlers). */
const BLOG_PATH = /^\/blog(\/|$)/

/**
 * A deleted post answers 410 Gone (search engines drop it faster than a 404). Pages can't set a 410
 * themselves, so this asks the blog API, whose answer is cached at the edge. Fails open.
 */
async function blogGone(pathname: string): Promise<NextResponse | null> {
  const m = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(pathname)
  if (!m || m[1] === 'page' || m[1] === 'category') return null
  try {
    const api = (process.env.BLOG_API_URL || 'https://api.ogadesk.com').replace(/\/+$/, '')
    const init = { redirect: 'manual', cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit
    const res = await fetch(`${api}/blog/${m[1]}`, init)
    if (res.status !== 410) return null
    return new NextResponse('<!doctype html><title>Post removed</title><p>This post has been removed. <a href="/blog">See the blog</a>.</p>', {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'public, max-age=300' },
    })
  } catch {
    return null
  }
}

/** Public lead-form surface: anonymous by design, so skip the auth round trip. */
const PUBLIC_FORM_PATH = /^\/(f|embed)\/|^\/embed\.js$|^\/api\/public\//

/** Entry point: runs the real handler, then remembers a `?ref=` referral code. */
export async function middleware(request: NextRequest) {
  return applyReferralCookie(request, await handle(request))
}

async function handle(request: NextRequest) {
  const canonical = canonicalRedirect(
    request.headers.get('host'),
    request.method,
    request.nextUrl.pathname,
    request.nextUrl.search,
  )
  if (canonical) return NextResponse.redirect(canonical, 308)

  if (PUBLIC_FORM_PATH.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request })
  }
  if (BLOG_PATH.test(request.nextUrl.pathname)) {
    return (await blogGone(request.nextUrl.pathname)) ?? NextResponse.next({ request })
  }
  if (isLocalizedLandingPath(request.nextUrl.pathname)) {
    return intlMiddleware(request)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges - the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  // Every top-level route under src/app/(dashboard)/ belongs here -
  // middleware.test.ts reads that directory and fails on a missing one.
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/agents', '/notifications', '/forms', '/affiliate', '/settings']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
}
