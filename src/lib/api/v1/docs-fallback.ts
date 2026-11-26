import { BRAND_NAME } from '@/lib/brand'
import { buildOpenApiSpec } from './openapi'

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Op = { summary?: string; tags?: string[] }

/**
 * Plain HTML for the API reference page, rendered on the server from the same OpenAPI document the
 * interactive viewer loads. Search engines (and anyone with scripts off) get real headings and the full
 * endpoint list; the viewer replaces it as soon as it loads.
 */
export function docsFallbackHtml(baseUrl: string): string {
  const spec = buildOpenApiSpec(baseUrl) as {
    tags?: { name: string; description?: string }[]
    paths: Record<string, Record<string, Op>>
    servers?: { url: string }[]
  }
  const server = spec.servers?.[0]?.url ?? `${baseUrl}/api/v1`
  const byTag = new Map<string, { method: string; path: string; summary: string }[]>()
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method]
      if (!op) continue
      const tag = op.tags?.[0] ?? 'Other'
      byTag.set(tag, [...(byTag.get(tag) ?? []), { method: method.toUpperCase(), path, summary: op.summary ?? '' }])
    }
  }
  const order = [...(spec.tags?.map((t) => t.name) ?? []), ...[...byTag.keys()].filter((k) => !spec.tags?.some((t) => t.name === k))]
  const sections = order
    .filter((tag) => byTag.has(tag))
    .map((tag) => {
      const desc = spec.tags?.find((t) => t.name === tag)?.description
      const rows = byTag
        .get(tag)!
        .map((o) => `<li><code>${esc(o.method)} ${esc(o.path)}</code> ${esc(o.summary)}</li>`)
        .join('')
      return `<section><h2>${esc(tag)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}<ul>${rows}</ul></section>`
    })
    .join('')
  return `<main style="max-width:760px;margin:0 auto;padding:32px 20px;font-family:system-ui,sans-serif;line-height:1.6">
<h1>${esc(BRAND_NAME)} API reference</h1>
<p>Send WhatsApp messages and templates, deliver one-time codes (OTP), read delivery status and receive events with the ${esc(BRAND_NAME)} REST API.</p>
<p>Base URL: <code>${esc(server)}</code>. Authenticate every request with an API key created in Settings, sent as <code>Authorization: Bearer &lt;key&gt;</code> or an <code>X-API-Key</code> header. The machine-readable OpenAPI document is at <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</p>
${sections}
</main>`
}
