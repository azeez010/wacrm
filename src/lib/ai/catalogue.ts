// ============================================================
// AI provider TYPES (templates). Pure data, no imports, so the admin API keeps a byte-identical copy
// (ogadesk-api/src/lib/ai-catalogue.ts, drift-tested). The admin creates INSTANCES of a type (key, model, prices) and
// chains them for failover; adding a provider = one entry here (and an adapter only if it is not OpenAI-compatible).
// ============================================================

export type AiAdapter = 'openai' | 'anthropic' | 'openai_compatible'
export type AiPurpose = 'chat' | 'draft' | 'playground'
export const AI_PURPOSES: AiPurpose[] = ['chat', 'draft', 'playground']

export type FieldType = 'text' | 'secret' | 'select' | 'boolean' | 'textarea'
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  help?: string
  options?: { value: string; label: string }[]
  default?: string | boolean
  pattern?: string
}

/** How the admin can see remaining credit: a provider API, or only our tracked spend (+ an optional manual budget). */
export type BalanceSource = 'openrouter' | 'deepseek' | null

export interface AiTypeDef {
  kind: string
  label: string
  description: string
  adapter: AiAdapter
  /** Fixed base URL for compatible providers (the admin cannot change it); null for OpenAI/Anthropic (native URLs). */
  baseUrl: string | null
  defaultModel: string
  /** A few well-known model ids offered as suggestions (free text is always allowed). */
  models: string[]
  fields: FieldDef[]
  balance: BalanceSource
  balanceHelp?: string
}

const KEY = (prefix: string, help: string): FieldDef => ({ key: 'api_key', label: 'API key', type: 'secret', required: true, help, ...(prefix ? { pattern: `^${prefix}` } : {}) })

export const AI_TYPES: AiTypeDef[] = [
  {
    kind: 'openai', label: 'OpenAI', description: 'GPT models through the OpenAI API.', adapter: 'openai', baseUrl: null,
    defaultModel: 'gpt-5.4-mini', models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4.1-mini'], balance: null,
    fields: [KEY('sk-', 'platform.openai.com → API keys.')],
  },
  {
    kind: 'anthropic', label: 'Anthropic', description: 'Claude models through the Anthropic API.', adapter: 'anthropic', baseUrl: null,
    defaultModel: 'claude-haiku-4-5-20251001', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5'], balance: null,
    fields: [KEY('sk-ant-', 'console.anthropic.com → API keys.')],
  },
  {
    kind: 'openrouter', label: 'OpenRouter', description: 'One key for many models (OpenAI, Anthropic, Google, open models) with its own credit balance.', adapter: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4.1-mini', models: ['openai/gpt-4.1-mini', 'anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
    balance: 'openrouter', balanceHelp: 'The remaining balance is read from OpenRouter. This needs a management key; a normal key shows only the key limit.',
    fields: [KEY('sk-or-', 'openrouter.ai → Keys. Use a management key to see the balance here.')],
  },
  {
    kind: 'deepseek', label: 'DeepSeek', description: 'DeepSeek chat models, inexpensive, with a balance API.', adapter: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', models: ['deepseek-chat'], balance: 'deepseek',
    balanceHelp: 'The remaining balance is read from DeepSeek.',
    fields: [KEY('sk-', 'platform.deepseek.com → API keys.')],
  },
  {
    kind: 'gemini', label: 'Google Gemini', description: 'Gemini models through Google\'s OpenAI-compatible endpoint.', adapter: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], balance: null,
    fields: [KEY('', 'aistudio.google.com → API keys.')],
  },
  {
    kind: 'openai_compatible', label: 'OpenAI-compatible (custom)', description: 'Any provider with an OpenAI-style /chat/completions API (Groq, Together, Mistral, a self-hosted model...).', adapter: 'openai_compatible',
    baseUrl: null, defaultModel: 'model-id', models: [], balance: null,
    fields: [
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, pattern: '^https://', help: 'For example https://api.groq.com/openai/v1' },
      KEY('', 'The provider\'s API key.'),
    ],
  },
]

export function aiType(kind: string): AiTypeDef | undefined {
  return AI_TYPES.find((t) => t.kind === kind)
}

/** The base URL an instance of this type calls (fixed by the type, or the instance's own for custom). */
export function aiBaseUrl(kind: string, config: Record<string, unknown>): string | null {
  const t = aiType(kind)
  if (!t) return null
  if (t.baseUrl) return t.baseUrl
  return t.adapter === 'openai_compatible' && typeof config.base_url === 'string' ? config.base_url.trim() : null
}

/** USD for one call from per-million prices. */
export function estimateCostUsd(promptTokens: number, completionTokens: number, priceInPerM: number, priceOutPerM: number): number {
  return Math.round(((promptTokens * priceInPerM + completionTokens * priceOutPerM) / 1_000_000) * 1e6) / 1e6
}
