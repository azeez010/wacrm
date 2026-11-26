import { guardedFetch } from '../guarded-fetch'

// Minimal MCP client over Streamable HTTP: JSON-RPC 2.0 POSTs, answers as JSON or as an SSE stream. Enough for
// initialize -> tools/list -> tools/call. No SDK (its schema validator generates code at runtime, which Workers forbid).

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}

export class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'McpError'
  }
}

export interface McpConn {
  url: string
  token?: string
  /** Extra headers (e.g. x-api-key) the business configured. */
  headers?: Record<string, string>
  fetch?: typeof fetch
  check?: (u: string) => Promise<URL>
  timeoutMs?: number
}

type Rpc = { jsonrpc: '2.0'; id?: number | string; result?: unknown; error?: { code: number; message: string } }

/** Pick the JSON-RPC response with `id` out of a JSON body or an SSE stream. */
export function parseRpcResponse(contentType: string, text: string, id: number): Rpc | null {
  const candidates: unknown[] = []
  if (contentType.includes('text/event-stream')) {
    let data: string[] = []
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      else if (line.trim() === '' && data.length) {
        try { candidates.push(JSON.parse(data.join('\n'))) } catch { /* skip */ }
        data = []
      }
    }
    if (data.length) { try { candidates.push(JSON.parse(data.join('\n'))) } catch { /* skip */ } }
  } else if (text.trim()) {
    try {
      const v = JSON.parse(text) as unknown
      if (Array.isArray(v)) candidates.push(...v)
      else candidates.push(v)
    } catch {
      throw new McpError('The MCP server answered with something that is not JSON.')
    }
  }
  for (const c of candidates) {
    const r = c as Rpc
    if (r && typeof r === 'object' && r.jsonrpc === '2.0' && r.id === id) return r
  }
  return null
}

export class McpClient {
  private session: string | null = null
  private nextId = 1
  constructor(private readonly conn: McpConn) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      ...(this.conn.headers ?? {}),
      ...(this.conn.token ? { Authorization: `Bearer ${this.conn.token}` } : {}),
      ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
    }
  }

  private async post(body: unknown): Promise<{ status: number; headers: Headers; text: string }> {
    const res = await guardedFetch(this.conn.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), timeoutMs: this.conn.timeoutMs ?? 10_000 }, { fetch: this.conn.fetch, check: this.conn.check })
    if (res.status === 401 || res.status === 403) throw new McpError(`The MCP server refused the token (HTTP ${res.status}).`)
    if (res.status === 404 && this.session) throw new McpError('The MCP session expired.')
    if (res.status >= 400) throw new McpError(`The MCP server answered HTTP ${res.status}.`)
    return res
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const res = await this.post({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    const rpc = parseRpcResponse(res.headers.get('content-type') ?? '', res.text, id)
    if (!rpc) throw new McpError(`No answer to ${method} from the MCP server.`)
    if (rpc.error) throw new McpError(rpc.error.message || 'MCP error', rpc.error.code)
    return rpc.result as T
  }

  async initialize(): Promise<{ serverName: string | null }> {
    const id = this.nextId++
    const res = await this.post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'OgaDesk', version: '1.0.0' } } })
    this.session = res.headers.get('mcp-session-id')
    const rpc = parseRpcResponse(res.headers.get('content-type') ?? '', res.text, id)
    if (!rpc) throw new McpError('The server did not answer the MCP handshake. Is this an MCP (Streamable HTTP) URL?')
    if (rpc.error) throw new McpError(rpc.error.message, rpc.error.code)
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined)
    const info = (rpc.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo
    return { serverName: info?.name ?? null }
  }

  async listTools(max = 100): Promise<McpTool[]> {
    const out: McpTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10 && out.length < max; page++) {
      const r = await this.request<{ tools?: McpTool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {})
      out.push(...(r.tools ?? []))
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    return out.slice(0, max)
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const r = await this.request<{ content?: { type: string; text?: string; [k: string]: unknown }[]; structuredContent?: unknown; isError?: boolean }>('tools/call', { name, arguments: args })
    const parts = (r.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'resource_link' ? `[link] ${String(c.uri ?? '')}` : `[${c.type} content]`))
    const text = parts.join('\n').trim() || (r.structuredContent !== undefined ? JSON.stringify(r.structuredContent) : '')
    return { text, isError: r.isError === true }
  }
}

/** Connect, handshake and list tools; used by "Discover tools" in the app. */
export async function discoverMcpTools(conn: McpConn): Promise<{ serverName: string | null; tools: McpTool[] }> {
  const c = new McpClient(conn)
  const { serverName } = await c.initialize()
  return { serverName, tools: await c.listTools() }
}

export async function callMcpTool(conn: McpConn, name: string, args: Record<string, unknown>) {
  const c = new McpClient(conn)
  await c.initialize()
  return c.callTool(name, args)
}
