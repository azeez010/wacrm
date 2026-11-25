'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Loader2, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import type { Tag } from '@/types'

const TAG_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#ef4444', '#f97316']

/** Create a tag in the current account (same palette + duplicate rule as the Contacts Tags popover). */
export function useCreateTag(tags: Tag[], onCreated: (tag: Tag) => void) {
  const t = useTranslations('Contacts.page')
  const { accountId, user } = useAuth()
  const [creating, setCreating] = useState(false)

  /** Resolves to the new tag, or null when it was a duplicate / failed (a toast says why). */
  async function create(rawName: string): Promise<Tag | null> {
    const name = rawName.trim()
    if (!name || !accountId || !user) return null
    if (tags.some((tg) => tg.name.toLowerCase() === name.toLowerCase())) {
      toast.error(t('tagManage.duplicate', { name }))
      return null
    }
    setCreating(true)
    const { data, error } = await createClient()
      .from('tags')
      .insert({ user_id: user.id, account_id: accountId, name, color: TAG_COLORS[tags.length % TAG_COLORS.length] })
      .select()
      .single()
    setCreating(false)
    if (error || !data) {
      toast.error(t('tagManage.createFailed'))
      return null
    }
    toast.success(t('tagManage.created', { name }))
    onCreated(data as Tag)
    return data as Tag
  }

  return { create, creating }
}

/**
 * The body of the Tags popover: "New tag, press Enter" box on top, then the tag list.
 * Shared by the Contacts filter (multi, with delete) and the partner CRM settings (single).
 */
export function TagPickerList({
  tags,
  selectedIds,
  onToggle,
  onCreate,
  creating,
  canCreate,
  onDelete,
  onWarmDelete,
  mode = 'multi',
}: {
  tags: Tag[]
  selectedIds: string[]
  onToggle: (tag: Tag) => void
  onCreate: (name: string) => Promise<unknown> | void
  creating: boolean
  canCreate: boolean
  /** When given, each row shows a delete x. */
  onDelete?: (tag: Tag) => void
  onWarmDelete?: (tag: Tag) => void
  mode?: 'multi' | 'single'
}) {
  const t = useTranslations('Contacts.page')
  const [name, setName] = useState('')

  async function submit() {
    if (!name.trim() || creating) return
    await onCreate(name)
    setName('')
  }

  return (
    <>
      {canCreate && (
        <div className="flex items-center gap-1.5 border-b border-border p-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={t('tagManage.newPlaceholder')}
            maxLength={50}
            className="h-8 bg-muted text-sm"
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void submit()}
            disabled={!name.trim() || creating}
            aria-label={t('tagManage.add')}
            title={t('tagManage.add')}
            className="shrink-0 text-muted-foreground hover:text-primary"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </div>
      )}
      <div className="max-h-64 overflow-y-auto py-1">
        {tags.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('noTagsYet')}</p>
        ) : (
          tags.map((tag) => {
            const on = selectedIds.includes(tag.id)
            return (
              <div key={tag.id} className="group/row flex items-center hover:bg-muted">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                  {mode === 'multi' ? (
                    <Checkbox checked={on} onCheckedChange={() => onToggle(tag)} />
                  ) : (
                    <>
                      <input type="radio" className="sr-only" checked={on} onChange={() => onToggle(tag)} />
                      <Check className={`size-4 shrink-0 ${on ? 'text-primary' : 'opacity-0'}`} aria-hidden />
                    </>
                  )}
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="truncate">{tag.name}</span>
                </label>
                {onDelete && (
                  <button
                    type="button"
                    aria-label={t('tagManage.deleteAria', { name: tag.name })}
                    title={t('tagManage.deleteAria', { name: tag.name })}
                    onMouseEnter={() => onWarmDelete?.(tag)}
                    onFocus={() => onWarmDelete?.(tag)}
                    onClick={() => onDelete(tag)}
                    className="mr-2 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:text-red-400 hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
