// ============================================================
// /api/onboarding - the first-login questions.
//
//   GET  → { needsOnboarding, answers }   (any member; only the owner is asked)
//   POST → save the owner's answers once, then queue the CRM sync + welcome
//
// Writes use the service-role client: these are system fields (onboarded_at,
// referral_code, consent time), not something members edit in Settings.
// ============================================================

import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { crmSyncUser, crmTrack } from '@/lib/crm'
import { isLocale, LOCALE_COOKIE } from '@/i18n/locales'
import { isValidReferralCode, REFERRAL_COOKIE } from '@/lib/referral'
import { parseOnboardingInput, parseUseCasesOnly } from '@/lib/onboarding/options'
import { queueWelcomeEmail } from '@/lib/email/queue'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data } = await ctx.supabase
      .from('accounts')
      .select('use_cases, heard_from, onboarded_at')
      .eq('id', ctx.accountId)
      .maybeSingle()
    return NextResponse.json({
      // Only the workspace owner is asked; invited teammates never see the dialog.
      needsOnboarding: ctx.role === 'owner' && !data?.onboarded_at,
      answers: { use_cases: data?.use_cases ?? [], heard_from: data?.heard_from ?? null },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    if (ctx.role !== 'owner') return NextResponse.json({ error: 'Only the workspace owner can do this' }, { status: 403 })

    const parsed = parseOnboardingInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    const jar = await cookies()
    const hdrs = await headers()
    const admin = supabaseAdmin()

    const { data: account } = await admin
      .from('accounts')
      .select('onboarded_at, referral_code')
      .eq('id', ctx.accountId)
      .maybeSingle()
    const firstTime = !account?.onboarded_at

    // Referral: remembered from a ?ref= link; the first code wins.
    const ref = jar.get(REFERRAL_COOKIE)?.value
    const referral = isValidReferralCode(ref) ? ref : null
    const heardFrom = input.heardFrom ?? (referral && !account?.referral_code ? 'partner' : null)

    const { error: accErr } = await admin
      .from('accounts')
      .update({
        use_cases: input.useCases,
        heard_from: heardFrom,
        heard_from_detail: input.heardFromDetail,
        referral_code: account?.referral_code ?? referral,
        onboarded_at: account?.onboarded_at ?? new Date().toISOString(),
      })
      .eq('id', ctx.accountId)
    if (accErr) {
      console.error('[onboarding] account update failed:', accErr.message)
      return NextResponse.json({ error: 'Could not save your answers' }, { status: 500 })
    }

    const cookieLocale = jar.get(LOCALE_COOKIE)?.value
    const country = hdrs.get('cf-ipcountry')
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        locale: isLocale(cookieLocale) ? cookieLocale : null,
        country: country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== 'XX' ? country.toUpperCase() : null,
        marketing_opt_in: input.marketingOptIn,
        marketing_opt_in_at: input.marketingOptIn ? new Date().toISOString() : null,
      })
      .eq('user_id', ctx.userId)
    if (profErr) console.error('[onboarding] profile update failed:', profErr.message)

    // Background: never blocks or fails the answer being saved.
    if (firstTime) {
      await crmTrack('onboarding_completed', {
        userId: ctx.userId,
        accountId: ctx.accountId,
        properties: { use_cases: input.useCases.join(','), heard_from: heardFrom ?? 'unknown', marketing_opt_in: input.marketingOptIn },
      })
      await queueWelcomeEmail(admin as never, ctx.userId, ctx.accountId).catch((e) =>
        console.error('[onboarding] welcome email failed:', e instanceof Error ? e.message : e),
      )
    } else {
      await crmSyncUser(ctx.userId)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH { use_cases } - change how the workspace says it uses OgaDesk (Your profile). Owner only. */
export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    if (ctx.role !== 'owner') return NextResponse.json({ error: 'Only the workspace owner can do this' }, { status: 403 })

    const parsed = parseUseCasesOnly(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { error } = await supabaseAdmin().from('accounts').update({ use_cases: parsed.useCases }).eq('id', ctx.accountId)
    if (error) {
      console.error('[onboarding] use_cases update failed:', error.message)
      return NextResponse.json({ error: 'Could not save your answers' }, { status: 500 })
    }
    await crmSyncUser(ctx.userId)
    return NextResponse.json({ ok: true, use_cases: parsed.useCases })
  } catch (err) {
    return toErrorResponse(err)
  }
}
