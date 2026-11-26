import type { ToolModelResult, ToolOutcome, ToolResult, ToolRuntime, ToolTurn } from './types'
import { capOutput } from './types'

// The tool-calling loop. `call` performs one model request with the current turns; the loop runs the tools the model asks
// for and feeds the results back, up to `maxRounds` rounds, then asks for a final answer without tools.
//
// `turns` and `cache` belong to the WHOLE generation, not to one provider: when a provider fails mid-loop and the next one
// takes over, it continues from the same turns, and a tool call it repeats (same name + same arguments) is answered from
// the cache. So an action is never executed twice because of a failover.

export interface LoopState {
  turns: ToolTurn[]
  cache: Map<string, ToolOutcome>
  pendingApproval: boolean
  executed: number
}

export const newLoopState = (): LoopState => ({ turns: [], cache: new Map(), pendingApproval: false, executed: 0 })

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v)

export async function runToolLoop(
  call: (turns: ToolTurn[], noTools: boolean) => Promise<ToolModelResult>,
  tools: ToolRuntime,
  state: LoopState,
): Promise<{ text: string; usage: ToolModelResult['usage'] }> {
  const max = Math.max(1, Math.min(tools.maxRounds ?? 4, 8))
  let prompt = 0, completion = 0, total = 0, sawUsage = false
  const add = (u: ToolModelResult['usage']) => {
    if (!u) return
    sawUsage = true
    prompt += u.promptTokens; completion += u.completionTokens; total += u.totalTokens
  }
  // Rounds already done (by a provider that then failed) count towards the limit.
  let round = state.turns.filter((t) => t.role === 'assistant').length
  for (;;) {
    const last = round >= max || state.pendingApproval
    const r = await call(state.turns, last)
    add(r.usage)
    if (r.toolCalls.length === 0 || last) {
      return { text: r.text, usage: sawUsage ? { promptTokens: prompt, completionTokens: completion, totalTokens: total } : null }
    }
    state.turns.push({ role: 'assistant', text: r.text || null, calls: r.toolCalls })
    const results: ToolResult[] = []
    for (const c of r.toolCalls) {
      const key = `${c.name}:${stable(c.arguments)}`
      let outcome = state.cache.get(key)
      if (!outcome) {
        if (!tools.specs.some((s) => s.name === c.name)) {
          outcome = { content: `There is no tool called ${c.name}.`, isError: true }
        } else {
          try {
            outcome = await tools.execute(c)
            state.executed++
          } catch (e) {
            outcome = { content: `The tool failed: ${e instanceof Error ? e.message : 'error'}`, isError: true }
          }
        }
        state.cache.set(key, outcome)
      }
      if (outcome.pendingApproval) state.pendingApproval = true
      results.push({ toolCallId: c.id, name: c.name, content: capOutput(outcome.content), ...(outcome.isError ? { isError: true } : {}) })
    }
    state.turns.push({ role: 'tool', results })
    round++
  }
}
