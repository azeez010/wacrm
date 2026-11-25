'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Info, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createClient } from '@/lib/supabase/client'
import type { CrmConfig } from '@/lib/partner/input'

const SELECT_CLASS = 'w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none'

interface Tag { id: string; name: string }
interface Pipeline { id: string; name: string; pipeline_stages: Array<{ id: string; name: string; position: number }> }

/** Where referrals land in the referrer's own CRM, depending on payment status. */
export function CrmRoutingCard({ initial, onSave }: { initial: CrmConfig; onSave: (c: CrmConfig) => Promise<boolean> }) {
  const t = useTranslations('Partner.crm')
  const [tags, setTags] = useState<Tag[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [unpaidTag, setUnpaidTag] = useState(initial.unpaid?.tagId ?? '')
  const [pipelineId, setPipelineId] = useState(initial.unpaid?.pipelineId ?? '')
  const [stageId, setStageId] = useState(initial.unpaid?.stageId ?? '')
  const [paidTag, setPaidTag] = useState(initial.paid?.tagId ?? '')
  const [autoWon, setAutoWon] = useState(initial.autoWon !== false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    void Promise.all([
      supabase.from('tags').select('id, name').order('name'),
      supabase.from('pipelines').select('id, name, pipeline_stages(id, name, position)').order('name'),
    ]).then(([tg, pl]) => {
      setTags((tg.data ?? []) as Tag[])
      setPipelines((pl.data ?? []) as unknown as Pipeline[])
    })
  }, [])

  const stages = [...(pipelines.find((p) => p.id === pipelineId)?.pipeline_stages ?? [])].sort((a, b) => a.position - b.position)

  async function save() {
    setBusy(true)
    await onSave({
      unpaid: { tagId: unpaidTag || null, pipelineId: pipelineId || null, stageId: pipelineId ? stageId || null : null },
      paid: { tagId: paidTag || null },
      autoWon,
    })
    setBusy(false)
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {t('title')}
        <Tooltip>
          <TooltipTrigger
            className="inline-flex shrink-0 rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={t('info')}
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{t('info')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="crm-unpaid-tag">{t('unpaidTag')}</Label>
          <select id="crm-unpaid-tag" className={SELECT_CLASS} value={unpaidTag} onChange={(e) => setUnpaidTag(e.target.value)}>
            <option value="">{t('none')}</option>
            {tags.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crm-pipeline">{t('pipeline')}</Label>
          <select
            id="crm-pipeline"
            className={SELECT_CLASS}
            value={pipelineId}
            onChange={(e) => {
              setPipelineId(e.target.value)
              setStageId('')
            }}
          >
            <option value="">{t('noDeal')}</option>
            {pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crm-stage">{t('stage')}</Label>
          <select id="crm-stage" className={SELECT_CLASS} value={stageId} disabled={!pipelineId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">{t('pickStage')}</option>
            {stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crm-paid-tag">{t('paidTag')}</Label>
          <select id="crm-paid-tag" className={SELECT_CLASS} value={paidTag} onChange={(e) => setPaidTag(e.target.value)}>
            <option value="">{t('none')}</option>
            {tags.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={autoWon} onCheckedChange={(v) => setAutoWon(Boolean(v))} aria-label={t('autoWon')} />
          {t('autoWon')}
        </label>
        <Button size="sm" disabled={busy || Boolean(pipelineId && !stageId)} onClick={() => void save()}>
          {busy && <Loader2 className="size-4 animate-spin" />} {t('save')}
        </Button>
      </div>
    </Card>
  )
}
