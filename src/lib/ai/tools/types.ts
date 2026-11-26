// Tool calling, provider-agnostic. A ToolSpec is what the model sees; ToolCall is what it asks for; ToolTurn is one round of
// the conversation (the assistant's tool requests, then their results) appended after the normal chat transcript.

export interface ToolSpec {
  /** Name the model calls, ^[A-Za-z0-9_-]{1,64}$ (namespaced: integration__tool). */
  name: string
  description: string
  /** JSON Schema for the arguments (object). */
  inputSchema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  name: string
  /** What the model sees; untrusted external content, already capped. */
  content: string
  isError?: boolean
}

export type ToolTurn = { role: 'assistant'; text: string | null; calls: ToolCall[] } | { role: 'tool'; results: ToolResult[] }

export interface ToolModelResult {
  text: string
  toolCalls: ToolCall[]
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

/** What the executor reports back for one call. `stop` ends the loop (e.g. an action waiting for a teammate's approval). */
export interface ToolOutcome {
  content: string
  isError?: boolean
  pendingApproval?: boolean
}

export interface ToolRuntime {
  specs: ToolSpec[]
  execute: (call: ToolCall) => Promise<ToolOutcome>
  /** Max model rounds that may request tools (default 4). */
  maxRounds?: number
}

export const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Cap on tool output given to the model. */
export const TOOL_OUTPUT_MAX = 4000

export function capOutput(s: string, max = TOOL_OUTPUT_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…(truncated)`
}
