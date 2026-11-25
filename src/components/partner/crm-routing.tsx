'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Info } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TagPickerList, useCreateTag } from '@/components/tags/tag-picker'
import { useCan } from '@/hooks/use-can'
import { createClient } from '@/lib/supabase/client'
import type { CrmConfig } from '@/lib/partner/input'
import type { Tag } from '@/types'

const SELECT_CLASS = 'rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none'

interface Pipeline { id: string; name: string; pipeline_stages: Array<{ id: string; name: string; position: number }> }

function TagField({ label, value, tags, onPick, onCreated }: { label: string; value: string | null; tags: Tag[]; onPick: (id: string | null) => void; onCreated: (t: Tag) => void }) {
  const t = useTranslations('Partner.crm')
  const canEdit = useCan('edit-settings')
  const [open, setOpen] = useState(false)
  const { create, creating } = useCreateTag(tags, onCreated)
  const chosen = tags.find((x) => x.id === value)
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={`${SELECT_CLASS} flex min-w-36 items-center justify-between gap-2 text-left`}>
          <span className="flex items-center gap-2 truncate">
            {chosen && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: chosen.color }} />}
            {chosen ? chosen.name : <span className="text-muted-foreground">{t('noTag')}</span>}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <TagPickerList
            mode="single"
            tags={tags}
            selectedIds={value ? [value] : []}
            canCreate={canEdit}
            creating={creating}
            onCreate={async (name) => {
              const tag = await create(name)
              if (tag) {
                onPick(tag.id)
                setOpen(false)
              }
            }}
            // Picking the selected tag again clears it.
            onToggle={(tag) => {
              onPick(tag.id === value ? null : tag.id)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * "Add referrals to my CRM": one switch. Only when it is on do the routing controls appear;
 * changes save as you make them. Moving the deal to Won on payment is part of the promise,
 * not a setting.
 */
export function CrmRouting({ config, onSave }: { config: CrmConfig; onSave: (c: CrmConfig) => Promise<boolean> }) {
  const t = useTranslations('Partner.crm')
  const enabled = config.enabled === true
  const [tags, setTags] = useState<Tag[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    void Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('pipelines').select('id, name, pipeline_stages(id, name, position)').order('name'),
    ]).then(([tg, pl]) => {
      setTags((tg.data ?? []) as Tag[])
      setPipelines((pl.data ?? []) as unknown as Pipeline[])
    })
  }, [enabled])

  const unpaid = config.unpaid ?? { tagId: null, pipelineId: null, stageId: null }
  const update = (patch: Partial<CrmConfig>) => void onSave({ ...config, ...patch })
  const addTag = (tag: Tag) => setTags((cur) => [...cur, tag].sort((a, b) => a.name.localeCompare(b.name)))

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-1">
      <div className="flex items-center gap-2 self-center text-sm font-medium">
        <Switch checked={enabled} onCheckedChange={(v) => update({ enabled: Boolean(v) })} aria-label={t('toggle')} />
        {t('toggle')}
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
      {enabled && (
        <>
          <TagField label={t('tagBefore')} value={unpaid.tagId} tags={tags} onCreated={addTag} onPick={(tagId) => update({ unpaid: { ...unpaid, tagId } })} />
          <TagField label={t('tagAfter')} value={config.paid?.tagId ?? null} tags={tags} onCreated={addTag} onPick={(tagId) => update({ paid: { tagId } })} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('pipelineStage')}
            <select
              className={`${SELECT_CLASS} min-w-48`}
              value={unpaid.pipelineId && unpaid.stageId ? `${unpaid.pipelineId}:${unpaid.stageId}` : ''}
              onChange={(e) => {
                const [pipelineId, stageId] = e.target.value.split(':')
                update({ unpaid: { ...unpaid, pipelineId: pipelineId || null, stageId: stageId || null } })
              }}
            >
              <option value="">{t('noDeal')}</option>
              {pipelines.flatMap((p) =>
                [...p.pipeline_stages].sort((a, b) => a.position - b.position).map((st) => (
                  <option key={st.id} value={`${p.id}:${st.id}`}>{p.name} / {st.name}</option>
                )),
              )}
            </select>
          </label>
        </>
      )}
    </div>
  )
}
