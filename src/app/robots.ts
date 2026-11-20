import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Only the marketing and legal pages are meant to be found; everything behind
// a login (and the API) is off-limits to crawlers.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/join/',
        '/dashboard',
        '/inbox',
        '/contacts',
        '/pipelines',
        '/broadcasts',
        '/automations',
        '/flows',
        '/agents',
        '/notifications',
        '/settings',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
