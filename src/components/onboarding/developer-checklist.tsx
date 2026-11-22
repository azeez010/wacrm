'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Check, Circle, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ONBOARDED_EVENT } from './onboarding-dialog'

interface DevState {
  show: boolean
  whatsappConnected: boolean
  template: { exists: boolean; status: string | null; rejectionReason: string | null }
  hasApiKey: boolean
  hasSentOtp: boolean
}

const KEY_SCOPES = ['otp:send', 'otp:verify', 'messages:send', 'templates:read']

/**
 * A short path for developers: connect a number, get the OTP template, create an
 * API key and send yourself a code. Shown on the dashboard when "Developer API"
 * was picked during onboarding, until the steps are done.
 */
export function DeveloperChecklist() {
  const t = useTranslations('Onboarding.developer')
  const [state, setState] = useState<DevState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [verificationId, setVerificationId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [origin, setOrigin] = useState('https://ogadesk.com')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/developer')
      if (res.ok) setState((await res.json()) as DevState)
    } catch {
      /* leave as is */
    }
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
    // Answering the onboarding dialog may have just switched this on.
    window.addEventListener(ONBOARDED_EVENT, load)
    return () => window.removeEventListener(ONBOARDED_EVENT, load)
  }, [load])

  async function call(label: string, fn: () => Promise<Response>, onOk: (body: Record<string, unknown>) => void) {
    setBusy(label)
    try {
      const res = await fn()
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('genericError'))
        return
      }
      onOk(body)
    } catch {
      toast.error(t('genericError'))
    } finally {
      setBusy(null)
    }
  }

  if (!state?.show) return null
  const templateApproved = state.template.status === 'APPROVED'
  const steps = [
    state.whatsappConnected,
    templateApproved,
    state.hasApiKey,
    state.hasSentOtp,
  ]
  const allDone = steps.every(Boolean)
  if (allDone && !newKey) return null

  const curl = `curl -X POST ${origin}/api/v1/verifications \\\n  -H "Authorization: Bearer ${newKey ?? 'YOUR_API_KEY'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "to": "+2348012345678" }'`

  const row = (done: boolean, title: string, description: string, extra?: React.ReactNode) => (
    <li className="flex gap-3">
      <span className={cn('mt-0.5 shrink-0', done ? 'text-primary' : 'text-muted-foreground')} aria-hidden>
        {done ? <Check className="size-5" /> : <Circle className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-medium">
            {title} <span className="sr-only">({done ? t('done') : t('todo')})</span>
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {extra}
      </div>
    </li>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-5">
          {row(
            state.whatsappConnected,
            t('connect.title'),
            t('connect.description'),
            !state.whatsappConnected && (
              <Link href="/settings?tab=whatsapp" className={buttonVariants({ size: 'sm' })}>
                {t('connect.action')}
              </Link>
            ),
          )}

          {row(
            templateApproved,
            t('template.title'),
            t('template.description'),
            <div className="flex flex-wrap items-center gap-2">
              {state.template.exists ? (
                <Badge variant={templateApproved ? 'default' : 'secondary'}>
                  {state.template.status === 'APPROVED'
                    ? t('template.approved')
                    : state.template.status === 'REJECTED'
                      ? t('template.rejected')
                      : t('template.pending')}
                </Badge>
              ) : (
                <Badge variant="secondary">{t('template.missing')}</Badge>
              )}
              {state.whatsappConnected && (!state.template.exists || state.template.status === 'REJECTED') && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => call('template', () => fetch('/api/onboarding/otp-template', { method: 'POST' }), () => void load())}
                >
                  {busy === 'template' && <Loader2 className="size-4 animate-spin" />}
                  {t('template.create')}
                </Button>
              )}
            </div>,
          )}

          {row(
            state.hasApiKey,
            t('key.title'),
            t('key.description'),
            <div className="space-y-2">
              {!state.hasApiKey && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    call(
                      'key',
                      () =>
                        fetch('/api/account/api-keys', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ name: 'Quickstart', scopes: KEY_SCOPES }),
                        }),
                      (b) => {
                        setNewKey(typeof b.plaintext === 'string' ? b.plaintext : null)
                        void load()
                      },
                    )
                  }
                >
                  {busy === 'key' && <Loader2 className="size-4 animate-spin" />}
                  {t('key.action')}
                </Button>
              )}
              {newKey && (
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <p className="text-xs font-medium">{t('key.created')}</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{newKey}</code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(newKey).then(() => toast.success(t('key.copied')))
                      }}
                    >
                      <Copy className="size-4" />
                      {t('key.copy')}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded bg-background p-2 text-[11px] leading-relaxed">{curl}</pre>
                </div>
              )}
            </div>,
          )}

          {row(
            state.hasSentOtp,
            t('test.title'),
            t('test.description'),
            templateApproved ? (
              <div className="space-y-2">
                {verified ? (
                  <p className="text-sm text-primary">{t('test.verified')}</p>
                ) : verificationId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={t('test.codePlaceholder')}
                      inputMode="numeric"
                      className="w-44"
                      aria-label={t('test.codePlaceholder')}
                    />
                    <Button
                      size="sm"
                      disabled={busy !== null || !code.trim()}
                      onClick={() =>
                        call(
                          'check',
                          () =>
                            fetch('/api/onboarding/test-otp', {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({ id: verificationId, code }),
                            }),
                          (b) => {
                            if (b.status === 'approved') {
                              setVerified(true)
                              void load()
                            } else if (b.status === 'pending') {
                              toast.error(t('test.wrong', { n: Number(b.attempts_remaining ?? 0) }))
                            } else {
                              toast.error(t('test.expired'))
                              setVerificationId(null)
                            }
                          },
                        )
                      }
                    >
                      {busy === 'check' && <Loader2 className="size-4 animate-spin" />}
                      {t('test.verify')}
                    </Button>
                    <span className="text-xs text-muted-foreground">{t('test.sent')}</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder={t('test.phonePlaceholder')}
                      inputMode="tel"
                      className="w-52"
                      aria-label={t('test.phonePlaceholder')}
                    />
                    <Button
                      size="sm"
                      disabled={busy !== null || !to.trim()}
                      onClick={() =>
                        call(
                          'send',
                          () =>
                            fetch('/api/onboarding/test-otp', {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({ to: to.trim() }),
                            }),
                          (b) => {
                            setVerificationId(typeof b.id === 'string' ? b.id : null)
                            void load()
                          },
                        )
                      }
                    >
                      {busy === 'send' && <Loader2 className="size-4 animate-spin" />}
                      {t('test.send')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('test.waiting')}</p>
            ),
          )}

          {row(
            false,
            t('docs.title'),
            t('docs.description'),
            <Link href="/docs" target="_blank" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              {t('docs.action')}
            </Link>,
          )}
        </ol>
      </CardContent>
    </Card>
  )
}
