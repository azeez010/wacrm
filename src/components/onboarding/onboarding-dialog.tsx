'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Code2, Headset, Megaphone, TrendingUp, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PhoneField } from '@/components/phone-field'
import { DETAIL_MAX, HEARD_FROM, USE_CASES, type HeardFrom, type UseCase } from '@/lib/onboarding/options'
import { cn } from '@/lib/utils'

const PHONE_RE = /^\+\d{8,15}$/

export const ONBOARDED_EVENT = 'wacrm:onboarded'

const USE_CASE_ICONS: Record<UseCase, LucideIcon> = {
  developer: Code2,
  support: Headset,
  sales: TrendingUp,
  marketing: Megaphone,
}

/**
 * One-time questions for the workspace owner right after first login: what they
 * will use OgaDesk for (pick any), and where they heard about us. Mounted once in
 * the dashboard shell; renders nothing unless the server says it is needed.
 */
export function OnboardingDialog() {
  const t = useTranslations('Onboarding')
  const { accountId, accountStatus, isOwner } = useAuth()
  const [needed, setNeeded] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [useCases, setUseCases] = useState<UseCase[]>([])
  const [heardFrom, setHeardFrom] = useState<HeardFrom | null>(null)
  const [detail, setDetail] = useState('')
  const [optIn, setOptIn] = useState(true)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  // Arrived through a partner link: skip the "where did you hear" step.
  const [referred, setReferred] = useState(false)

  useEffect(() => {
    if (!accountId || accountStatus !== 'ready' || !isOwner) return
    let cancelled = false
    void fetch('/api/onboarding')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { needsOnboarding?: boolean; referred?: boolean } | null) => {
        if (cancelled) return
        if (d?.referred) setReferred(true)
        if (d?.needsOnboarding) setNeeded(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [accountId, accountStatus, isOwner])

  async function submit(skipSource: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          use_cases: useCases,
          heard_from: referred ? 'partner' : skipSource ? null : heardFrom,
          heard_from_detail: skipSource ? null : detail || null,
          marketing_opt_in: optIn,
          phone: phone.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      setNeeded(false)
      window.dispatchEvent(new Event(ONBOARDED_EVENT))
    } catch {
      toast.error(t('error'))
    } finally {
      setSaving(false)
    }
  }

  function toggleUseCase(uc: UseCase) {
    setUseCases((cur) => (cur.includes(uc) ? cur.filter((x) => x !== uc) : [...cur, uc]))
  }

  if (!needed) return null

  return (
    // Not dismissible: answering (or skipping the second step) is the way out.
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('subtitle')}</DialogDescription>
            </DialogHeader>
            <div role="group" aria-label={t('title')} className="grid gap-2 sm:grid-cols-2">
              {USE_CASES.map((uc) => {
                const Icon = USE_CASE_ICONS[uc]
                const on = useCases.includes(uc)
                return (
                  <button
                    key={uc}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleUseCase(uc)}
                    className={cn(
                      'relative flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors',
                      on ? 'border-primary/60 ring-2 ring-primary/40' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="size-4 text-primary" aria-hidden />
                      {t(`useCases.${uc}.title`)}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(`useCases.${uc}.description`)}</span>
                    {on && <Check className="absolute right-2 top-2 size-4 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="onboarding-phone" className="text-sm font-medium">{t('phoneLabel')}</label>
              <PhoneField id="onboarding-phone" value={phone} onChange={setPhone} placeholder="8012345678" />
              <p className="text-xs text-muted-foreground">{t('phoneHint')}</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm">
                <p id="onboarding-marketing-label">{t('marketingLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('marketingHint')}</p>
              </div>
              <Switch checked={optIn} onCheckedChange={(v) => setOptIn(Boolean(v))} aria-labelledby="onboarding-marketing-label" />
            </div>
            <div className="flex justify-end">
              <Button disabled={useCases.length === 0 || !PHONE_RE.test(phone.replace(/[\s().-]/g, '')) || saving} onClick={() => (referred ? void submit(true) : setStep(2))}>
                {referred ? (saving ? t('saving') : t('finish')) : t('next')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('sourceTitle')}</DialogTitle>
              <DialogDescription>{t('sourceSubtitle')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('sourceTitle')}>
              {HEARD_FROM.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="radio"
                  aria-checked={heardFrom === h}
                  onClick={() => setHeardFrom(h)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    heardFrom === h ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border hover:bg-muted/40',
                  )}
                >
                  {t(`sources.${h}`)}
                </button>
              ))}
            </div>
            {heardFrom && (
              <div className="space-y-1.5">
                <label htmlFor="onboarding-detail" className="text-sm text-muted-foreground">
                  {t('detailLabel')}
                </label>
                <Input
                  id="onboarding-detail"
                  value={detail}
                  maxLength={DETAIL_MAX}
                  placeholder={t('detailPlaceholder')}
                  onChange={(e) => setDetail(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
                {t('back')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void submit(true)} disabled={saving}>
                  {t('skip')}
                </Button>
                <Button onClick={() => void submit(false)} disabled={saving}>
                  {saving ? t('saving') : t('finish')}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
