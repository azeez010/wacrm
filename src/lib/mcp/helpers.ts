import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ApiCallError, type ApiResult } from './dispatch'

export const text = (payload: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
})
export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

export function run<A>(fn: (args: A) => Promise<ApiResult | CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const r = await fn(args)
      if ('content' in r) return r
      return text(r.next_cursor !== undefined ? { data: r.data, next_cursor: r.next_cursor } : { data: r.data })
    } catch (err) {
      if (err instanceof ApiCallError) return errorResult(`wacrm API error [${err.code}]: ${err.message}`)
      return errorResult(`Unexpected error: ${(err as Error).message}`)
    }
  }
}

export const READ = { readOnlyHint: true, openWorldHint: false } as const
export const WRITE = { readOnlyHint: false, openWorldHint: true } as const
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const

export const limit = z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).')
export const cursor = z.string().optional().describe('Opaque pagination cursor from a previous response.')

export const has = (scopes: string[], s: string) => scopes.includes(s)
export const hasAny = (scopes: string[], list: string[]) => list.some((s) => scopes.includes(s))
