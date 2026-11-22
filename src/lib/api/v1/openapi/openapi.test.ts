import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate } from '@scalar/openapi-parser'
import { API_SCOPES } from '@/lib/api-keys/scopes'
import { buildOpenApiSpec } from '.'

const BASE = 'https://example.test'
const V1_DIR = join(process.cwd(), 'src/app/api/v1')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** `src/app/api/v1/**\/route.ts` -> [{ path: '/webhooks/{id}', method: 'GET' }, ...] */
function routeOperations(): Array<{ path: string; method: string }> {
  const out: Array<{ path: string; method: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name === 'route.ts') {
        const src = readFileSync(full, 'utf8')
        const path =
          '/' +
          relative(V1_DIR, dir)
            .split(sep)
            .map((seg) => seg.replace(/^\[(.+)\]$/, '{$1}'))
            .join('/')
        for (const m of METHODS) {
          if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src)) {
            out.push({ path: path === '/' ? '/' : path.replace(/\/$/, ''), method: m })
          }
        }
      }
    }
    return out
  }
  walk(V1_DIR)
  return out
}

// Endpoints that exist but are not documented yet. Documenting one means
// deleting it from this list; adding a route without documenting it OR listing
// it here fails the test, so the docs can never silently fall behind.
const NOT_DOCUMENTED_YET = [
  /^\/openapi\.json$/, // the spec itself
  /^\/contacts/,
  /^\/conversations(\/\{id\})?$/,
  /^\/broadcasts/,
  /^\/pipelines/,
  /^\/deals/,
  /^\/automations/,
  /^\/flows/,
  /^\/tags/,
  /^\/team/,
  /^\/custom-fields/,
  /^\/tables/,
  /^\/segments/,
]

describe('OpenAPI spec', () => {
  const spec = buildOpenApiSpec(BASE)

  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await validate(spec as never)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('lists exactly the scopes the API enforces', () => {
    const description = (spec.info as { description: string }).description
    for (const scope of API_SCOPES) expect(description).toContain(`\`${scope}\``)
  })

  it('substitutes the base URL into the guides', () => {
    const description = (spec.info as { description: string }).description
    expect(description).toContain(`${BASE}/api/v1`)
    expect(description).not.toContain('{{BASE_URL}}')
  })

  it('only documents operations that really exist as routes', () => {
    const real = new Set(routeOperations().map((o) => `${o.method} ${o.path}`))
    const documented = Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(
      ([path, item]) =>
        Object.keys(item)
          .filter((k) => (METHODS as readonly string[]).includes(k.toUpperCase()))
          .map((k) => `${k.toUpperCase()} ${path}`),
    )
    expect(documented.length).toBeGreaterThan(0)
    expect(documented.filter((d) => !real.has(d))).toEqual([])
  })

  it('has no real route that is neither documented nor on the not-yet list', () => {
    const documented = new Set(
      Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([path, item]) =>
        Object.keys(item).map((k) => `${k.toUpperCase()} ${path}`),
      ),
    )
    const missing = routeOperations()
      .filter((o) => !documented.has(`${o.method} ${o.path}`))
      .filter((o) => !NOT_DOCUMENTED_YET.some((re) => re.test(o.path)))
      .map((o) => `${o.method} ${o.path}`)
    expect(missing).toEqual([])
  })
})
