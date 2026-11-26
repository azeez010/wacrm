import type { SupabaseClient } from '@supabase/supabase-js'

import type { AgentPersona } from './types'

// The platform's default persona and hard guardrails (admin console → Platform settings → AI), via
// public.ai_platform_prompt(). 60 s cache per instance; any error -> no platform layer (the business's own
// prompt still works), so a problem here never stops replies.

export interface PlatformPrompt {
  guardrails: string | null
  name: string | null
  gender: string | null
  tone: string | null
  behaviour: string | null
  avoid: string | null
  never: string | null
  greetingStyle: string | null
  languageRule: string | null
  maxReplyChars: number | null
  handoffRules: string | null
}

export const PLATFORM_PROMPT_TTL_MS = 60_000
const EMPTY: PlatformPrompt = { guardrails: null, name: null, gender: null, tone: null, behaviour: null, avoid: null, never: null, greetingStyle: null, languageRule: null, maxReplyChars: null, handoffRules: null }
let cache: { value: PlatformPrompt; expiresAt: number } | null = null

export function invalidatePlatformPrompt(): void {
  cache = null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function loadPlatformPrompt(db: SupabaseClient, now: () => number = Date.now): Promise<PlatformPrompt> {
  if (cache && cache.expiresAt > now()) return cache.value
  try {
    const { data, error } = await db.rpc('ai_platform_prompt')
    if (error || !data || typeof data !== 'object') return EMPTY
    const d = data as Record<string, unknown>
    const value: PlatformPrompt = {
      guardrails: str(d.guardrails), name: str(d.name), gender: str(d.gender), tone: str(d.tone), behaviour: str(d.behaviour),
      avoid: str(d.avoid), never: str(d.never), greetingStyle: str(d.greetingStyle), languageRule: str(d.languageRule),
      maxReplyChars: typeof d.maxReplyChars === 'number' ? d.maxReplyChars : null, handoffRules: str(d.handoffRules),
    }
    cache = { value, expiresAt: now() + PLATFORM_PROMPT_TTL_MS }
    return value
  } catch {
    return EMPTY
  }
}

/** The text of the platform layer + the agent's persona, ready to put in the system prompt. Empty string when there is none. */
export function personaPrompt(platform: PlatformPrompt, agent: AgentPersona | null | undefined, agentName: string | null | undefined): { guardrails: string; persona: string } {
  const pick = (own: string | null | undefined, dflt: string | null) => str(own) ?? dflt
  const name = str(agentName) && agentName !== 'Default agent' ? str(agentName) : platform.name
  const lines: string[] = []
  if (name) lines.push(`Your name is ${name}. Introduce yourself by that name if it is natural to.`)
  const gender = pick(agent?.gender, platform.gender)
  if (gender) lines.push(`Persona: ${gender}.`)
  const tone = pick(agent?.tone, platform.tone)
  if (tone) lines.push(`Tone: ${tone}`)
  const behaviour = pick(agent?.behaviour, platform.behaviour)
  if (behaviour) lines.push(`Behaviour: ${behaviour}`)
  const avoid = pick(agent?.avoid, platform.avoid)
  if (avoid) lines.push(`Avoid: ${avoid}`)
  const never = pick(agent?.never, platform.never)
  if (never) lines.push(`Never do: ${never}`)
  if (platform.greetingStyle) lines.push(`Greetings and sign-offs: ${platform.greetingStyle}`)
  if (platform.languageRule) lines.push(`Language: ${platform.languageRule}`)
  if (platform.maxReplyChars) lines.push(`Keep each reply under ${platform.maxReplyChars} characters.`)
  if (platform.handoffRules) lines.push(`When to hand over to a human: ${platform.handoffRules}`)
  return { guardrails: platform.guardrails ?? '', persona: lines.join('\n') }
}
