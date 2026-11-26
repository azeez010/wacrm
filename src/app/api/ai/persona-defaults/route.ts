// GET /api/ai/persona-defaults (any member): the platform's default persona (name, gender, tone, behaviour, things to
// avoid / never do), used as the placeholders in an agent's optional persona fields. The hard guardrails are never
// returned. Empty object when none is set or on any error.
import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data } = await supabase.rpc('ai_platform_persona')
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    const pick = (k: string) => (typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string).trim() : null)
    const res = NextResponse.json({ name: pick('name'), gender: pick('gender'), tone: pick('tone'), behaviour: pick('behaviour'), avoid: pick('avoid'), never: pick('never') })
    res.headers.set('Cache-Control', 'private, max-age=60')
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
