'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { COUNTRIES } from '@/lib/forms/countries';
import type { FormKind, FormSettings } from '@/lib/forms/types';
import { cn } from '@/lib/utils';
import type { FormEditorData } from './use-form-data';

const selectCls = 'h-9 w-full rounded-lg border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-60';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: FormKind;
  settings: FormSettings;
  data: FormEditorData;
  canEdit: boolean;
  /** Plan has forms_advanced: may hide the OgaDesk badge. */
  advanced: boolean;
  patch: (p: Record<string, unknown>) => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** One side sheet. Four things up front; everything else under "More options". */
export function SettingsSheet({ open, onOpenChange, kind, settings, data, canEdit, advanced, patch }: Props) {
  const t = useTranslations('Forms.settings');
  const [more, setMore] = useState(false);
  const s = settings;
  const a = s.assignment;
  const toggleAgent = (id: string) => {
    const cur = a.agentIds ?? [];
    patch({ assignment: { agentIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('subtitle')}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {/* 1. After submit */}
          <Row label={t('afterSubmit')}>
            <select
              className={selectCls}
              disabled={!canEdit}
              value={s.success.action}
              onChange={(e) => patch({ success: { action: e.target.value } })}
            >
              <option value="message">{t('actionMessage')}</option>
              <option value="whatsapp">{t('actionWhatsapp')}</option>
              {kind === 'lead' && <option value="redirect">{t('actionRedirect')}</option>}
            </select>
          </Row>
          <Row label={t('thankYou')}>
            <Textarea rows={2} disabled={!canEdit} value={s.success.message ?? ''} onChange={(e) => patch({ success: { message: e.target.value } })} />
          </Row>
          {s.success.action === 'redirect' && (
            <Row label={t('redirectUrl')} hint={t('redirectHint')}>
              <Input disabled={!canEdit} value={s.success.redirectUrl ?? ''} placeholder="https://" onChange={(e) => patch({ success: { redirectUrl: e.target.value || undefined } })} />
            </Row>
          )}
          {s.success.action === 'whatsapp' && (
            <>
              <Row label={t('whatsappText')} hint={t('whatsappHint', { name: '{{name}}', message: '{{message}}' })}>
                <Textarea rows={3} disabled={!canEdit} value={s.success.whatsappText ?? ''} onChange={(e) => patch({ success: { whatsappText: e.target.value } })} />
              </Row>
              <label className="flex items-center gap-2 text-sm">
                <Switch disabled={!canEdit} checked={s.success.followUpLine !== false} onCheckedChange={(on) => patch({ success: { followUpLine: on } })} />
                {t('followUp')}
              </label>
            </>
          )}

          {/* 2. Tag */}
          <Row label={t('tag')} hint={t('tagHint')}>
            <Input
              disabled={!canEdit}
              value={s.autoTag ?? ''}
              placeholder={t('tagPlaceholder')}
              onChange={(e) => patch({ autoTag: e.target.value === '' ? null : e.target.value })}
            />
          </Row>

          {/* 3. Assign */}
          <Row label={t('assign')}>
            <select className={selectCls} disabled={!canEdit} value={a.mode} onChange={(e) => patch({ assignment: { mode: e.target.value } })}>
              <option value="none">{t('assignNone')}</option>
              <option value="agent">{t('assignAgent')}</option>
              <option value="round_robin">{t('assignRoundRobin')}</option>
            </select>
            {a.mode !== 'none' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.agents.map((g) => {
                  const on = (a.agentIds ?? []).includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={!canEdit}
                      aria-pressed={on}
                      onClick={() => toggleAgent(g.id)}
                      className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Row>

          {/* 4. Qualify */}
          {kind === 'lead' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch disabled={!canEdit} checked={s.qualification.enabled} onCheckedChange={(on) => patch({ qualification: { enabled: on } })} />
                {t('qualify')}
              </label>
              {s.qualification.enabled && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t('qualifyHint')}</p>
                  <Row label={t('threshold')}>
                    <Input type="number" min={0} disabled={!canEdit} value={s.qualification.threshold} onChange={(e) => patch({ qualification: { threshold: Math.max(0, Number(e.target.value) || 0) } })} />
                  </Row>
                  <Row label={t('whenNot')}>
                    <select className={selectCls} disabled={!canEdit} value={s.qualification.onUnqualified} onChange={(e) => patch({ qualification: { onUnqualified: e.target.value } })}>
                      <option value="save">{t('whenNotSave')}</option>
                      <option value="block">{t('whenNotBlock')}</option>
                    </select>
                  </Row>
                  {s.qualification.onUnqualified === 'block' && (
                    <Row label={t('blockMessage')}>
                      <Textarea rows={2} disabled={!canEdit} value={s.qualification.blockMessage ?? ''} onChange={(e) => patch({ qualification: { blockMessage: e.target.value } })} />
                    </Row>
                  )}
                  <Row label={t('tagsQualified')}>
                    <Input disabled={!canEdit} value={(s.tagsQualified ?? []).join(', ')} onChange={(e) => patch({ tagsQualified: splitTags(e.target.value) })} />
                  </Row>
                  <Row label={t('tagsNotQualified')}>
                    <Input disabled={!canEdit} value={(s.tagsNotQualified ?? []).join(', ')} onChange={(e) => patch({ tagsNotQualified: splitTags(e.target.value) })} />
                  </Row>
                </div>
              )}
            </div>
          )}

          {/* More options */}
          <div className="rounded-lg border border-border">
            <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium" aria-expanded={more}>
              {t('more')}
              <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} />
            </button>
            {more && (
              <div className="space-y-4 border-t border-border p-3">
                <Row label={t('formTitle')}>
                  <Input disabled={!canEdit} value={s.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />
                </Row>
                <Row label={t('description')}>
                  <Textarea rows={2} disabled={!canEdit} value={s.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
                </Row>
                <Row label={t('buttonText')}>
                  <Input disabled={!canEdit} value={s.buttonText ?? ''} onChange={(e) => patch({ buttonText: e.target.value })} />
                </Row>
                <div className="grid grid-cols-2 gap-3">
                  <Row label={t('accent')}>
                    <input type="color" disabled={!canEdit} value={s.accent ?? '#10b981'} onChange={(e) => patch({ accent: e.target.value })} className="h-9 w-full rounded-lg border border-border bg-muted" />
                  </Row>
                  <Row label={t('language')}>
                    <select className={selectCls} disabled={!canEdit} value={s.language ?? 'en'} onChange={(e) => patch({ language: e.target.value })}>
                      {['en', 'es', 'fr', 'pt', 'ko'].map((l) => (
                        <option key={l} value={l}>
                          {l.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>
                <Row label={t('logoUrl')}>
                  <Input disabled={!canEdit} value={s.logoUrl ?? ''} placeholder="https://" onChange={(e) => patch({ logoUrl: e.target.value || undefined })} />
                </Row>
                <Row label={t('theme')} hint={t('themeHint')}>
                  <select className={selectCls} disabled={!canEdit} value={s.theme ?? 'auto'} onChange={(e) => patch({ theme: e.target.value })}>
                    <option value="auto">{t('themeAuto')}</option>
                    <option value="light">{t('themeLight')}</option>
                    <option value="dark">{t('themeDark')}</option>
                  </select>
                </Row>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit || !advanced} checked={advanced && s.hideBranding === true} onCheckedChange={(on) => patch({ hideBranding: on })} />
                    {t('hideBranding')}
                  </label>
                  <p className="text-xs text-muted-foreground">{advanced ? t('hideBrandingHint') : t('hideBrandingLocked')}</p>
                </div>
                <Row label={t('defaultCountry')} hint={t('defaultCountryHint')}>
                  <select className={selectCls} disabled={!canEdit} value={(s.defaultCountry ?? 'auto') === 'auto' ? 'auto' : (s.defaultCountry as string).toUpperCase()} onChange={(e) => patch({ defaultCountry: e.target.value })}>
                    <option value="auto">{t('countryAuto')}</option>
                    {COUNTRIES.filter((c, i, arr) => arr.findIndex((x) => x.iso === c.iso) === i).map((c) => (
                      <option key={c.iso} value={c.iso}>
                        {c.name} (+{c.cc})
                      </option>
                    ))}
                  </select>
                </Row>

                <div className="space-y-3 border-t border-border pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={!!s.rules.onePerPhone} onCheckedChange={(on) => patch({ rules: { onePerPhone: on } })} />
                    {t('onePerPhone')}
                  </label>
                  <Row label={t('repeatWindow')} hint={t('repeatHint')}>
                    <Input type="number" min={0} disabled={!canEdit} value={s.rules.repeatWindowHours ?? 24} onChange={(e) => patch({ rules: { repeatWindowHours: Math.max(0, Number(e.target.value) || 0) } })} />
                  </Row>
                  <Row label={t('maxSubmissions')}>
                    <Input type="number" min={1} disabled={!canEdit} value={s.rules.maxSubmissions ?? ''} onChange={(e) => patch({ rules: { maxSubmissions: e.target.value ? Math.max(1, Number(e.target.value)) : undefined } })} />
                  </Row>
                  <div className="grid grid-cols-2 gap-3">
                    <Row label={t('opensAt')}>
                      <Input type="datetime-local" disabled={!canEdit} value={toLocal(s.rules.opensAt)} onChange={(e) => patch({ rules: { opensAt: fromLocal(e.target.value) } })} />
                    </Row>
                    <Row label={t('closesAt')}>
                      <Input type="datetime-local" disabled={!canEdit} value={toLocal(s.rules.closesAt)} onChange={(e) => patch({ rules: { closesAt: fromLocal(e.target.value) } })} />
                    </Row>
                  </div>
                  <Row label={t('closedMessage')}>
                    <Input disabled={!canEdit} value={s.rules.closedMessage ?? ''} onChange={(e) => patch({ rules: { closedMessage: e.target.value } })} />
                  </Row>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={s.rules.saveMessageAsNote !== false} onCheckedChange={(on) => patch({ rules: { saveMessageAsNote: on } })} />
                    {t('messageAsNote')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={!!s.rules.turnstile} onCheckedChange={(on) => patch({ rules: { turnstile: on } })} />
                    {t('turnstile')}
                  </label>
                </div>

                {kind === 'lead' && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <Row label={t('pipeline')} hint={t('pipelineHint')}>
                      <select
                        className={selectCls}
                        disabled={!canEdit}
                        value={s.pipeline ? `${s.pipeline.pipelineId}:${s.pipeline.stageId}` : ''}
                        onChange={(e) => {
                          const [pipelineId, stageId] = e.target.value.split(':');
                          patch({ pipeline: e.target.value ? { pipelineId, stageId } : undefined });
                        }}
                      >
                        <option value="">{t('pipelineNone')}</option>
                        {data.pipelines.flatMap((p) =>
                          p.stages.map((st) => (
                            <option key={st.id} value={`${p.id}:${st.id}`}>
                              {p.name} / {st.name}
                            </option>
                          )),
                        )}
                      </select>
                    </Row>
                    <Row label={t('welcome')} hint={t('welcomeHint')}>
                      <select
                        className={selectCls}
                        disabled={!canEdit}
                        value={s.welcomeTemplate ? `${s.welcomeTemplate.name}|${s.welcomeTemplate.language}` : ''}
                        onChange={(e) => {
                          const [name, language] = e.target.value.split('|');
                          patch({ welcomeTemplate: e.target.value ? { name, language, params: s.welcomeTemplate?.params ?? [] } : undefined });
                        }}
                      >
                        <option value="">{t('welcomeNone')}</option>
                        {data.templates.map((tp) => (
                          <option key={`${tp.name}|${tp.language}`} value={`${tp.name}|${tp.language}`}>
                            {tp.name} ({tp.language})
                          </option>
                        ))}
                      </select>
                      {s.welcomeTemplate && (
                        <Input
                          className="mt-2"
                          disabled={!canEdit}
                          value={(s.welcomeTemplate.params ?? []).join(' | ')}
                          placeholder={t('welcomeParams', { name: '{{name}}' })}
                          onChange={(e) =>
                            patch({ welcomeTemplate: { ...s.welcomeTemplate, params: e.target.value ? e.target.value.split('|').map((x) => x.trim()).slice(0, 10) : [] } })
                          }
                        />
                      )}
                    </Row>
                    <Row label={t('ogTitle')}>
                      <Input disabled={!canEdit} value={s.ogTitle ?? ''} onChange={(e) => patch({ ogTitle: e.target.value })} />
                    </Row>
                    <Row label={t('ogDescription')}>
                      <Input disabled={!canEdit} value={s.ogDescription ?? ''} onChange={(e) => patch({ ogDescription: e.target.value })} />
                    </Row>
                    <Row label={t('ogImage')}>
                      <Input disabled={!canEdit} value={s.ogImage ?? ''} placeholder="https://" onChange={(e) => patch({ ogImage: e.target.value || undefined })} />
                    </Row>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch disabled={!canEdit} checked={s.noindex !== false} onCheckedChange={(on) => patch({ noindex: on })} />
                      {t('noindex')}
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function splitTags(v: string): string[] {
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
}
const toLocal = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : undefined);
