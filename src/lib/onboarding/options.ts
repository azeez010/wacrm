// The onboarding questions, shared by the dialog (what to show) and the API
// (what to accept). Adding an option = add the id here and its label in the
// `Onboarding` catalog namespace.

export const USE_CASES = ['developer', 'support', 'sales', 'marketing'] as const
export type UseCase = (typeof USE_CASES)[number]

export const HEARD_FROM = [
  'google',
  'social',
  'youtube',
  'friend',
  'partner',
  'blog',
  'whatsapp',
  'event',
  'ai',
  'other',
] as const
export type HeardFrom = (typeof HEARD_FROM)[number]

export const DETAIL_MAX = 200

export interface OnboardingInput {
  useCases: UseCase[]
  heardFrom: HeardFrom | null
  heardFromDetail: string | null
  marketingOptIn: boolean
}

export type ParseResult = { ok: true; value: OnboardingInput } | { ok: false; error: string }

export function parseOnboardingInput(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' }
  const b = body as Record<string, unknown>

  if (!Array.isArray(b.use_cases) || b.use_cases.length === 0) {
    return { ok: false, error: "'use_cases' must be a non-empty array" }
  }
  const useCases: UseCase[] = []
  for (const v of b.use_cases) {
    if (!(USE_CASES as readonly unknown[]).includes(v)) return { ok: false, error: `Unknown use case '${String(v)}'` }
    if (!useCases.includes(v as UseCase)) useCases.push(v as UseCase)
  }

  let heardFrom: HeardFrom | null = null
  if (b.heard_from !== undefined && b.heard_from !== null) {
    if (!(HEARD_FROM as readonly unknown[]).includes(b.heard_from)) {
      return { ok: false, error: `Unknown 'heard_from' value` }
    }
    heardFrom = b.heard_from as HeardFrom
  }

  let heardFromDetail: string | null = null
  if (b.heard_from_detail !== undefined && b.heard_from_detail !== null) {
    if (typeof b.heard_from_detail !== 'string') return { ok: false, error: "'heard_from_detail' must be text" }
    const t = b.heard_from_detail.trim()
    if (t.length > DETAIL_MAX) return { ok: false, error: `'heard_from_detail' must be at most ${DETAIL_MAX} characters` }
    heardFromDetail = t || null
  }

  if (b.marketing_opt_in !== undefined && typeof b.marketing_opt_in !== 'boolean') {
    return { ok: false, error: "'marketing_opt_in' must be true or false" }
  }

  return {
    ok: true,
    value: { useCases, heardFrom, heardFromDetail, marketingOptIn: b.marketing_opt_in === true },
  }
}
