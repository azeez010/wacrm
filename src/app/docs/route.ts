import { docsFallbackHtml } from '@/lib/api/v1/docs-fallback'
import { BRAND_NAME } from '@/lib/brand'
import { SITE_URL } from '@/lib/seo'

// Interactive API reference, rendered in the browser by Scalar
// (https://github.com/scalar/scalar, MIT) from /api/v1/openapi.json.
// Pinned on purpose: bump the version deliberately and re-check the page.
const SCALAR_VERSION = '1.82.1'

const html = (fallback: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API reference · ${BRAND_NAME}</title>
    <meta name="description" content="Send WhatsApp messages and templates, read delivery status and receive events with the ${BRAND_NAME} API." />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180.png" />
    <meta name="theme-color" content="#104D3C" />
    <link rel="canonical" href="${SITE_URL}/docs" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${BRAND_NAME}" />
    <meta property="og:title" content="API reference · ${BRAND_NAME}" />
    <meta property="og:description" content="Send WhatsApp messages and templates, read delivery status and receive events with the ${BRAND_NAME} API." />
    <meta property="og:url" content="${SITE_URL}/docs" />
  </head>
  <body>
    <div id="app">${fallback}</div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/api/v1/openapi.json',
        theme: 'default',
        layout: 'modern',
        hideClientButton: false,
        defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
        metaData: { title: 'API reference · ${BRAND_NAME}' },
        customCss: \`
          /* Keep short first columns (status codes, scope names) on one line
             instead of letting a narrow column wrap them letter by letter. */
          .scalar-app .markdown table { width: 100%; table-layout: auto; }
          .scalar-app .markdown td:first-of-type,
          .scalar-app .markdown th:first-of-type { white-space: nowrap; }
          .scalar-app .markdown td code { overflow-wrap: anywhere; }
          :root, .light-mode {
            --scalar-color-accent: #11875D;
            --scalar-button-1: #11875D;
            --scalar-button-1-hover: #104D3C;
            --scalar-button-1-color: #ffffff;
          }
          .dark-mode {
            --scalar-color-accent: #2AC58B;
            --scalar-button-1: #2AC58B;
            --scalar-button-1-hover: #11875D;
            --scalar-button-1-color: #06241b;
          }
        \`,
      })
    </script>
  </body>
</html>`

export async function GET() {
  return new Response(html(docsFallbackHtml(SITE_URL)), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
