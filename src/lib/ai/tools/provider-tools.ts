import { MAX_OUTPUT_TOKENS } from '../defaults'
import type { AiAdapter } from '../catalogue'
import { normalizeOpenAiCompatibleBaseUrl } from '../providers/openai-compatible'
import { mergeConsecutive, normalizeUsage, providerHttpError, toNetworkError } from '../providers/shared'
import { AiError, type ChatMessage } from '../types'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { ToolCall, ToolModelResult, ToolSpec, ToolTurn } from './types'

// One model call WITH tools, for the three adapters. The text-only adapters (providers/*.ts) stay untouched; this is used
// only when an account has tools, so a reply without tools is byte-for-byte the same request as before.

export interface ToolCallArgs {
  apiKey: string
  model: string
  baseUrl: string | null
  timeoutMs: number
  systemPrompt: string
  messages: ChatMessage[]
  turns: ToolTurn[]
  tools: ToolSpec[]
  /** Ask the model to answer without tools (last round). */
  noTools?: boolean
}

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

// ---------------------------------------------------------------- OpenAI + compatible
export function openAiBody(a: ToolCallArgs, maxField: 'max_completion_tokens' | 'max_tokens') {
  const msgs: Record<string, unknown>[] = [{ role: 'system', content: a.systemPrompt }, ...mergeConsecutive(a.messages)]
  for (const t of a.turns) {
    if (t.role === 'assistant') {
      msgs.push({ role: 'assistant', content: t.text ?? null, tool_calls: t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) })
    } else {
      for (const r of t.results) msgs.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content })
    }
  }
  return {
    model: a.model,
    messages: msgs,
    [maxField]: MAX_OUTPUT_TOKENS,
    ...(a.tools.length ? { tools: a.tools.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: s.inputSchema } })), tool_choice: a.noTools ? 'none' : 'auto' } : {}),
  }
}

type OpenAiToolResponse = {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export function parseOpenAi(data: OpenAiToolResponse | null): ToolModelResult {
  const m = data?.choices?.[0]?.message
  const toolCalls: ToolCall[] = (m?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({ id: c.id || `call_${i}`, name: c.function!.name!, arguments: parseArgs(c.function!.arguments) }))
  return {
    text: typeof m?.content === 'string' ? m.content : '',
    toolCalls,
    usage: normalizeUsage({ prompt: data?.usage?.prompt_tokens, completion: data?.usage?.completion_tokens, total: data?.usage?.total_tokens }),
  }
}

// ---------------------------------------------------------------- Anthropic
export function anthropicBody(a: ToolCallArgs) {
  const base = mergeConsecutive(a.messages)
  while (base.length > 0 && base[0]!.role === 'assistant') base.shift()
  if (base.length === 0) base.push({ role: 'user', content: '(The customer has not sent a message yet.)' })
  const msgs: Record<string, unknown>[] = base.map((m) => ({ role: m.role, content: m.content }))
  for (const t of a.turns) {
    if (t.role === 'assistant') {
      const content: Record<string, unknown>[] = []
      if (t.text) content.push({ type: 'text', text: t.text })
      for (const c of t.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })
      msgs.push({ role: 'assistant', content })
    } else {
      msgs.push({ role: 'user', content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.toolCallId, content: r.content, ...(r.isError ? { is_error: true } : {}) })) })
    }
  }
  return {
    model: a.model,
    system: a.systemPrompt,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: msgs,
    ...(a.tools.length ? { tools: a.tools.map((s) => ({ name: s.name, description: s.description, input_schema: s.inputSchema })), tool_choice: { type: a.noTools ? 'none' : 'auto' } } : {}),
  }
}

type AnthropicToolResponse = {
  content?: ({ type: 'text'; text?: string } | { type: 'tool_use'; id?: string; name?: string; input?: unknown } | { type: string })[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function parseAnthropic(data: AnthropicToolResponse | null): ToolModelResult {
  const blocks = data?.content ?? []
  const text = blocks.filter((b): b is { type: 'text'; text?: string } => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  const toolCalls: ToolCall[] = blocks
    .filter((b): b is { type: 'tool_use'; id?: string; name?: string; input?: unknown } => b.type === 'tool_use')
    .filter((b) => b.name)
    .map((b, i) => ({ id: b.id || `toolu_${i}`, name: b.name!, arguments: parseArgs(b.input) }))
  return { text, toolCalls, usage: normalizeUsage({ prompt: data?.usage?.input_tokens, completion: data?.usage?.output_tokens }) }
}

// ---------------------------------------------------------------- dispatch
export async function callModelWithTools(adapter: AiAdapter, a: ToolCallArgs, fetchImpl: typeof fetch = fetch): Promise<ToolModelResult> {
  let url: string
  let headers: Record<string, string>
  let body: unknown
  let label: string
  if (adapter === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = { 'x-api-key': a.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    body = anthropicBody(a)
    label = 'Anthropic'
  } else if (adapter === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'
    headers = { Authorization: `Bearer ${a.apiKey}`, 'Content-Type': 'application/json' }
    body = openAiBody(a, 'max_completion_tokens')
    label = 'OpenAI'
  } else {
    url = normalizeOpenAiCompatibleBaseUrl(a.baseUrl ?? '')
    let ok = false
    try {
      ok = await isDeliverableUrl(url)
    } catch {
      ok = false
    }
    if (!ok) throw new AiError('The AI provider URL is not reachable from here.', { code: 'blocked_url', status: 400 })
    headers = { Authorization: `Bearer ${a.apiKey}`, 'Content-Type': 'application/json' }
    body = openAiBody(a, 'max_tokens')
    label = 'OpenAI-compatible provider'
  }
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(a.timeoutMs) })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError(label, res)
  const data = await res.json().catch(() => null)
  const out = adapter === 'anthropic' ? parseAnthropic(data as AnthropicToolResponse | null) : parseOpenAi(data as OpenAiToolResponse | null)
  if (!out.text.trim() && out.toolCalls.length === 0) throw new AiError(`${label} returned an empty reply.`, { code: 'empty_response' })
  return out
}
