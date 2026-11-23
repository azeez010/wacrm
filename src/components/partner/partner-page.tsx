'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Copy, ExternalLink, Gift, Loader2, Trophy, Users, Wallet } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/dashboard/empty-state'
import { formatPlanPrice } from '@/lib/billing/format'
import type { PartnerOverview } from '@/lib/partner/overview'

export function PartnerPage() {
  const t = useTranslations('Partner')
  const locale = useLocale()
  const [data, setData] = useState<PartnerOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [payoutOpen, setPayoutOpen] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/partner/me', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch('/api/partner/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(typeof body.error === 'string' ? body.error : t('saveFailed'))
      return false
    }
    setData(await res.json())
    toast.success(t('saved'))
    return true
  }

  async function copy() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('saveFailed'))
    }
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
        <Button variant="outline" onClick={() => void load()}>{t('retry')}</Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const hasPayout = Boolean((data.payoutDetails as { account_number?: string }).account_number)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Hero: the link */}
      <Card className="gap-4 bg-primary/5 p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Gift className="size-4" /> {t('title')}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('heroTitle')}</h2>
        <p className="max-w-2xl text-muted-foreground">{t('heroBody', { percent: data.settings.commissionPercent })}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={data.link} aria-label={t('linkLabel')} className="bg-background font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
          <Button onClick={copy} className="shrink-0">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      </Card>

      {/* Payout card */}
      <Card className="flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-muted p-3"><Wallet className="size-5 text-muted-foreground" /></div>
          <div>
            <p className="text-sm text-muted-foreground">{t('pendingWithdrawal')}</p>
            <p className="text-2xl font-semibold">{formatPlanPrice(0, data.settings.currency, locale)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:max-w-sm sm:items-end sm:text-right">
          <p className="text-sm text-muted-foreground">{hasPayout ? t('payoutSaved') : t('payoutNote')}</p>
          <Button variant={hasPayout ? 'outline' : 'default'} onClick={() => setPayoutOpen(true)}>
            {hasPayout ? t('editPayout') : t('setupPayout')}
          </Button>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('stats.earnings')} value={`${formatPlanPrice(0, data.settings.currency, locale)}`} note={t('stats.earningsNote')} />
        <Stat label={t('stats.referrals')} value={String(data.stats.referrals)} />
        <Stat label={t('stats.commission')} value={`${data.settings.commissionPercent}%`} note={t('stats.commissionNote', { months: data.settings.recurringMonths })} />
      </div>

      <Tabs defaultValue="history">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
          <TabsTrigger value="report">{t('tabs.report')}</TabsTrigger>
          <TabsTrigger value="materials">{t('tabs.materials')}</TabsTrigger>
          <TabsTrigger value="leaderboard">{t('tabs.leaderboard')}</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="pt-4">
          {data.referrals.length === 0 ? (
            <EmptyState icon={Users} title={t('history.empty')} hint={t('history.emptyHint')} />
          ) : (
            <Card className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('history.colWho')}</TableHead>
                    <TableHead>{t('history.colPlan')}</TableHead>
                    <TableHead>{t('history.colDate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.referrals.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.who}</TableCell>
                      <TableCell><Badge variant="secondary" className="capitalize">{r.plan}</Badge></TableCell>
                      <TableCell>{date(r.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="report" className="grid gap-4 pt-4 sm:grid-cols-2">
          {data.report.length === 0 ? (
            <div className="sm:col-span-2"><EmptyState title={t('report.empty')} hint={t('report.emptyHint')} /></div>
          ) : (
            <>
              <Card className="gap-2 p-5">
                <h3 className="font-medium">{t('report.byMonth')}</h3>
                {data.report.map((m) => (
                  <div key={m.month} className="flex justify-between text-sm"><span className="text-muted-foreground">{m.month}</span><span className="tabular-nums">{m.count}</span></div>
                ))}
              </Card>
              <Card className="gap-2 p-5">
                <h3 className="font-medium">{t('report.byPlan')}</h3>
                {Object.entries(data.stats.byPlan).map(([plan, n]) => (
                  <div key={plan} className="flex justify-between text-sm"><span className="capitalize text-muted-foreground">{plan}</span><span className="tabular-nums">{n}</span></div>
                ))}
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="materials" className="pt-4">
          {data.materials.length === 0 ? (
            <EmptyState icon={Gift} title={t('materials.empty')} hint={t('materials.emptyHint')} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.materials.map((m) => (
                <Card key={m.id} className="gap-3 overflow-hidden p-0">
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.imageUrl} alt="" className="aspect-video w-full object-cover" />
                  )}
                  <div className="space-y-1 p-4">
                    <h3 className="font-medium">{m.title}</h3>
                    {m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}
                    {m.sizeLabel && <p className="text-xs text-muted-foreground">{m.sizeLabel}</p>}
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => window.open(m.url, '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="size-3.5" /> {t('materials.open')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="leaderboard" className="space-y-4 pt-4">
          <Card className="flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{t('leaderboard.optIn')}</p>
              <p className="text-sm text-muted-foreground">{t('leaderboard.optInHint')}</p>
            </div>
            <Switch checked={data.showOnLeaderboard} onCheckedChange={(v) => void save({ show_on_leaderboard: Boolean(v) })} aria-label={t('leaderboard.optIn')} />
          </Card>
          <DisplayNameField initial={data.displayName ?? ''} onSave={(v) => save({ display_name: v })} />
          {data.leaderboard.length === 0 ? (
            <EmptyState icon={Trophy} title={t('leaderboard.empty')} hint={t('leaderboard.emptyHint')} />
          ) : (
            <Card className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">{t('leaderboard.rank')}</TableHead>
                    <TableHead>{t('leaderboard.name')}</TableHead>
                    <TableHead className="text-right">{t('leaderboard.referrals')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.leaderboard.map((row) => (
                    <TableRow key={row.rank}>
                      <TableCell>{row.rank}</TableCell>
                      <TableCell>
                        {row.name} {row.isYou && <Badge className="ml-1">{t('leaderboard.you')}</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.referrals}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <PayoutDialog open={payoutOpen} onOpenChange={setPayoutOpen} initial={data.payoutDetails as Record<string, string>} onSave={(d) => save({ payout_details: d })} />
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="gap-1 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  )
}

function DisplayNameField({ initial, onSave }: { initial: string; onSave: (v: string) => Promise<boolean> }) {
  const t = useTranslations('Partner.leaderboard')
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="partner-display-name">{t('displayName')}</Label>
        <Input id="partner-display-name" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button
        variant="outline"
        disabled={busy || value.trim() === initial}
        onClick={async () => {
          setBusy(true)
          await onSave(value)
          setBusy(false)
        }}
      >
        {t('saveName')}
      </Button>
    </div>
  )
}

function PayoutDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: Record<string, string>
  onSave: (d: { bank_name: string; account_name: string; account_number: string }) => Promise<boolean>
}) {
  const t = useTranslations('Partner')
  const [bank, setBank] = useState(initial.bank_name ?? '')
  const [name, setName] = useState(initial.account_name ?? '')
  const [num, setNum] = useState(initial.account_number ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setBank(initial.bank_name ?? '')
      setName(initial.account_name ?? '')
      setNum(initial.account_number ?? '')
    }
  }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payoutTitle')}</DialogTitle>
          <DialogDescription>{t('payoutDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="po-bank">{t('bankName')}</Label><Input id="po-bank" value={bank} onChange={(e) => setBank(e.target.value)} maxLength={80} /></div>
          <div className="space-y-1.5"><Label htmlFor="po-name">{t('accountName')}</Label><Input id="po-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div className="space-y-1.5"><Label htmlFor="po-num">{t('accountNumber')}</Label><Input id="po-num" value={num} onChange={(e) => setNum(e.target.value)} maxLength={34} inputMode="numeric" /></div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await onSave({ bank_name: bank, account_name: name, account_number: num })
              setBusy(false)
              if (ok) onOpenChange(false)
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />} {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
