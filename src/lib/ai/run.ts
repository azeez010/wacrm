import type { SupabaseClient } from '@supabase/supabase-js'

import { crmTrack } from '@/lib/crm'
import { decryptSecretsObject } from '@/lib/payments/secrets'
import { supabaseAdmin } from './admin-client'
import { aiBaseUrl, aiType, estimateCostUsd, type AiAdapter, type AiPurpose } from './catalogue'
import { generateReply, parseGeneration } from './generate'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenAi } from './providers/openai'
import { generateOpenAiCompatible } from './providers/openai-compatible'
import type { ProviderArgs } from './providers/shared'
import { AiError, type AiConfig, type AiUsage, type ChatMessage, type GenerateResult } from './types'
import { logAiUsage, type LogAiUsageArgs } from './usage'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

// ============================================================
// One entry point for every LLM call (auto-reply, draft, playground).
//   own key      -> the business's provider, as before (logged, never limited by credits)
//   platform AI  -> check the AI credits (plan limit ai_tokens_per_month), then walk the admin-configured provider
//                   instances in priority order (public.ai_route). A failure of any kind (timeout, rate limit, bad
//                   key, 5xx, network) is recorded, the instance's health is updated (it cools down after N
//                   failures in a row) and the next instance is tried. Usage is logged with the instance, an
//                   estimated cost and every attempt, so the admin can monitor spend and failovers.
// ============================================================

export type RunMode = 'auto_reply' | 'draft' | 'playground'
const PURPOSE: Record<RunMode, AiPurpose> = { auto_reply: 'chat', draft: 'draft', playground: 'playground' }

export interface RunArgs {
  config: AiConfig
  systemPrompt: string
  messages: ChatMessage[]
  accountId: string
  conversationId: string | null
  mode: RunMode
  agentId?: string | null
}

export interface Attempt {
  instanceId: string
  name: string
  kind: string
  model: string
  ok: boolean
  ms: number
  error?: string
  code?: string
}

export interface RunResult extends GenerateResult {
  source: 'own' | 'platform'
  instanceId: string | null
  attempts: Attempt[]
}

type RouteEntry = { id: string; kind: string; name: string; model: string; reason: string | null }
type CreditStatus = { allowed: boolean; reason: string | null; used: number; limit: number | null; remaining: number | null; percent: number }

export interface RunDeps {
  admin: () => SupabaseClient
  call: (adapter: AiAdapter, args: ProviderArgs) => Promise<{ text: string; usage: AiUsage | null }>
  now: () => number
  log: (db: SupabaseClient, args: LogAiUsageArgs) => Promise<void>
}
const defaultDeps: RunDeps = {
  admin: supabaseAdmin,
  call: (adapter, args) => (adapter === 'anthropic' ? generateAnthropic(args) : adapter === 'openai' ? generateOpenAi(args) : generateOpenAiCompatible(args)),
  now: Date.now,
  log: logAiUsage,
}

const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

/** What the plan allows. Fails CLOSED (an error means no platform call): this protects spend, not the customer's own key. */
export async function platformCredits(admin: SupabaseClient, accountId: string): Promise<CreditStatus> {
  try {
    return await rpc<CreditStatus>(admin, 'ai_credit_status', { p_account: accountId })
  } catch (e) {
    console.error('[ai] credit check failed:', e instanceof Error ? e.message : e)
    throw new AiError(t('ai.unavailable'), { code: 'ai_unavailable', status: 503 })
  }
}

export function creditError(c: CreditStatus): AiError {
  return c.reason === 'plan_feature'
    ? new AiError(t('ai.notInPlan'), { code: 'ai_plan_feature', status: 402 })
    : new AiError(t('ai.creditsExhausted'), { code: 'ai_credits_exhausted', status: 402 })
}

export async function runGeneration(db: SupabaseClient, args: RunArgs, deps: RunDeps = defaultDeps): Promise<RunResult> {
  const { config, accountId, mode } = args
  if (config.source !== 'platform') {
    const out = await generateReply({ config, systemPrompt: args.systemPrompt, messages: args.messages })
    if (mode !== 'playground') {
      void deps.log(db, { accountId, conversationId: args.conversationId, mode, provider: config.provider, model: config.model, usage: out.usage, agentId: args.agentId ?? null })
    }
    return { ...out, source: 'own', instanceId: null, attempts: [] }
  }

  const admin = deps.admin()
  const credits = await platformCredits(admin, accountId)
  if (!credits.allowed) throw creditError(credits)

  const route = (await rpc<RouteEntry[]>(admin, 'ai_route', { p_purpose: PURPOSE[mode] })) ?? []
  const eligible = route.filter((r) => !r.reason)
  if (eligible.length === 0) throw new AiError(t('ai.unavailable'), { code: 'ai_unavailable', status: 503 })

  const attempts: Attempt[] = []
  let lastError: AiError | null = null
  for (const inst of eligible) {
    const started = deps.now()
    const attempt: Attempt = { instanceId: inst.id, name: inst.name, kind: inst.kind, model: inst.model, ok: false, ms: 0 }
    try {
      const row = await rpc<{ kind: string; model: string; config: Record<string, unknown>; secrets: string | null; timeoutMs: number; priceIn: number; priceOut: number } | null>(admin, 'ai_instance_secrets', { p_id: inst.id })
      const type = row ? aiType(row.kind) : undefined
      if (!row || !type) throw new AiError('Provider instance is not set up.', { code: 'not_configured', status: 503 })
      const secrets = await decryptSecretsObject(row.secrets)
      if (!secrets.api_key) throw new AiError('The provider key is missing.', { code: 'invalid_key', status: 401 })
      const result = await deps.call(type.adapter, {
        apiKey: secrets.api_key, model: row.model, systemPrompt: args.systemPrompt, messages: args.messages, timeoutMs: row.timeoutMs,
        baseUrl: aiBaseUrl(row.kind, row.config),
      })
      attempt.ok = true
      attempt.ms = deps.now() - started
      attempts.push(attempt)
      void report(admin, inst.id, true)
      void creditAlert(admin, accountId, credits, result.usage?.totalTokens ?? 0)
      const usage = result.usage
      const cost = usage ? estimateCostUsd(usage.promptTokens, usage.completionTokens, Number(row.priceIn), Number(row.priceOut)) : null
      void deps.log(db, {
        accountId, conversationId: args.conversationId, mode, provider: row.kind, model: row.model, usage, agentId: args.agentId ?? null,
        source: 'platform', instanceId: inst.id, costUsd: cost, attempts,
      })
      return { ...parseGeneration(result.text, usage), source: 'platform', instanceId: inst.id, attempts }
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : 'Provider failed', { code: 'provider_error' })
      attempt.error = err.message.slice(0, 200)
      attempt.code = err.code
      attempt.ms = deps.now() - started
      attempts.push(attempt)
      lastError = err
      void report(admin, inst.id, false, err.message)
    }
  }
  // Every instance failed: record it (no tokens, so no credit used) and tell the caller.
  void deps.log(db, { accountId, conversationId: args.conversationId, mode, provider: 'none', model: 'none', usage: null, agentId: args.agentId ?? null, source: 'platform', instanceId: null, costUsd: null, attempts, failed: true })
  throw new AiError(t('ai.unavailable'), { code: lastError ? 'ai_unavailable' : 'ai_unavailable', status: 503 })
}

async function report(admin: SupabaseClient, id: string, ok: boolean, error?: string) {
  try {
    await admin.rpc('ai_instance_report', { p_id: id, p_ok: ok, p_error: error ?? null })
  } catch {
    /* health bookkeeping must never break a reply */
  }
}

/**
 * 80% / 100% AI-credit notices (CRM events `ai_credits_80` / `ai_credits_100`, once each per month, for targeting and
 * emails). `before` is the status read BEFORE this call, so the new total is `used + justUsed`.
 */
export async function creditAlert(_admin: SupabaseClient, accountId: string, before: CreditStatus, justUsed: number): Promise<'ai_credits_80' | 'ai_credits_100' | null> {
  try {
    const limit = before.limit
    if (!limit || limit <= 0) return null
    const percent = ((before.used + justUsed) / limit) * 100
    const level = percent >= 100 ? 100 : percent >= 80 ? 80 : 0
    if (!level) return null
    const month = new Date().toISOString().slice(0, 7)
    const event = level === 100 ? 'ai_credits_100' : 'ai_credits_80'
    const ok = await crmTrack(event, { accountId, properties: { used: before.used + justUsed, limit, percent: Math.round(percent) }, onceKey: `once:${event}:${accountId}:${month}` })
    return ok ? event : null
  } catch {
    return null
  }
}
