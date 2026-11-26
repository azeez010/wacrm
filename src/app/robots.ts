import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Only the marketing and legal pages are meant to be found; everything behind
// a login (and the API) is off-limits to crawlers.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // The API reference page (/docs) loads its OpenAPI document from /api/v1/openapi.json; crawlers
      // must be able to fetch it or they see an empty page. The longer rule wins over `/api/`.
      allow: ['/', '/api/v1/openapi.json'],
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
        '/tools/',
        '/billing/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
