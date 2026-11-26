'use client';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { ImagePicker } from '@/components/media/image-picker';
import { AlignCenter, AlignLeft, AlignRight, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { COUNTRIES } from '@/lib/forms/countries';
import type { FormKind, FormSettings } from '@/lib/forms/types';
import type { VerifyAvailability } from '@/lib/forms/verify';
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
  /** Which verification codes can work for this account (null while loading). */
  verifyAvailability?: VerifyAvailability | null;
  /** The form has a required email field (needed for email codes). */
  hasRequiredEmail?: boolean;
  /** Called after the code template was submitted, so the status refreshes. */
  onVerifyTemplateCreated?: () => void;
  /** Support button in Live chat mode: only the settings the chat uses. */
  liveChat?: boolean;
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
export function SettingsSheet({ open, onOpenChange, kind, settings, data, canEdit, advanced, verifyAvailability = null, hasRequiredEmail = false, onVerifyTemplateCreated, liveChat = false, patch }: Props) {
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
          <SheetDescription>{liveChat ? t('subtitleLiveChat') : t('subtitle')}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {!liveChat && (
            <>
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
          {s.success.action === 'message' && (
            <Row label={t('thankYou')}>
              <Textarea rows={2} disabled={!canEdit} value={s.success.message ?? ''} onChange={(e) => patch({ success: { message: e.target.value } })} />
            </Row>
          )}
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

          {!liveChat && (
            <>
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

          {/* Notify */}
          <Row label={t('notify')} hint={t('notifyHint')}>
            <select className={selectCls} disabled={!canEdit} value={s.notify.mode} onChange={(e) => patch({ notify: { mode: e.target.value } })}>
              <option value="all">{t('notifyAll')}</option>
              <option value="selected">{t('notifySelected')}</option>
            </select>
            {s.notify.mode === 'selected' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.agents.map((g) => {
                  const cur = s.notify.agentIds ?? [];
                  const on = cur.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={!canEdit}
                      aria-pressed={on}
                      onClick={() => patch({ notify: { agentIds: on ? cur.filter((x) => x !== g.id) : [...cur, g.id] } })}
                      className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Row>

            </>
          )}

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
                {!liveChat && (
                  <>
                <Row label={t('formTitle')}>
                  <Input disabled={!canEdit} value={s.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />
                </Row>
                <Row label={t('description')}>
                  <Textarea rows={2} disabled={!canEdit} value={s.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
                </Row>
                <Row label={t('buttonText')}>
                  <Input disabled={!canEdit} value={s.buttonText ?? ''} onChange={(e) => patch({ buttonText: e.target.value })} />
                </Row>
                  </>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {!liveChat && (
                  <Row label={t('accent')}>
                    <input type="color" disabled={!canEdit} value={s.accent ?? '#10b981'} onChange={(e) => patch({ accent: e.target.value })} className="h-9 w-full rounded-lg border border-border bg-muted" />
                  </Row>
                  )}
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
                {!liveChat && (
                  <>
                <Row label={t('logoUrl')}>
                  <ImagePicker disabled={!canEdit} value={s.logoUrl} shape="wide" onChange={(url) => patch({ logoUrl: url ?? undefined })} />
                </Row>
                {s.logoUrl && (
                  <div className="grid grid-cols-2 gap-3">
                    <Row label={t('logoAlign')}>
                      <SegmentedControl
                        aria-label={t('logoAlign')}
                        disabled={!canEdit}
                        value={s.logoAlign ?? 'left'}
                        onChange={(logoAlign) => patch({ logoAlign })}
                        options={[
                          { value: 'left', label: t('alignLeft'), icon: <AlignLeft className="size-4" />, iconOnly: true },
                          { value: 'center', label: t('alignCenter'), icon: <AlignCenter className="size-4" />, iconOnly: true },
                          { value: 'right', label: t('alignRight'), icon: <AlignRight className="size-4" />, iconOnly: true },
                        ]}
                      />
                    </Row>
                    <Row label={t('logoSize')}>
                      <SegmentedControl
                        aria-label={t('logoSize')}
                        disabled={!canEdit}
                        value={s.logoSize ?? 'medium'}
                        onChange={(logoSize) => patch({ logoSize })}
                        options={[
                          { value: 'small', label: t('sizeSmall') },
                          { value: 'medium', label: t('sizeMedium') },
                          { value: 'large', label: t('sizeLarge') },
                        ]}
                      />
                    </Row>
                  </div>
                )}
                  </>
                )}
                {kind === 'lead' && (
                  <Row label={t('backgroundImage')} hint={t('backgroundImageHint')}>
                    <ImagePicker disabled={!canEdit} value={s.backgroundImage} shape="wide" onChange={(url) => patch({ backgroundImage: url ?? undefined })} />
                  </Row>
                )}
                {kind === 'lead' && s.backgroundImage && (
                  <div className="space-y-4">
                    <Row label={t('backgroundFit')}>
                      <SegmentedControl
                        aria-label={t('backgroundFit')}
                        disabled={!canEdit}
                        value={s.backgroundFit ?? 'cover'}
                        onChange={(backgroundFit) => patch({ backgroundFit })}
                        options={[
                          { value: 'cover', label: t('fitCover') },
                          { value: 'contain', label: t('fitContain') },
                          { value: 'tile', label: t('fitTile') },
                        ]}
                      />
                    </Row>
                    <div className="grid grid-cols-2 gap-3">
                      <Row label={t('backgroundPosition')}>
                        <SegmentedControl
                          aria-label={t('backgroundPosition')}
                          disabled={!canEdit}
                          value={s.backgroundPosition ?? 'center'}
                          onChange={(backgroundPosition) => patch({ backgroundPosition })}
                          options={[
                            { value: 'top', label: t('posTop') },
                            { value: 'center', label: t('posCenter') },
                            { value: 'bottom', label: t('posBottom') },
                          ]}
                        />
                      </Row>
                      <Row label={t('backgroundOverlay')}>
                        <SegmentedControl
                          aria-label={t('backgroundOverlay')}
                          disabled={!canEdit}
                          value={s.backgroundOverlay ?? 'soft'}
                          onChange={(backgroundOverlay) => patch({ backgroundOverlay })}
                          options={[
                            { value: 'none', label: t('overlayNone') },
                            { value: 'soft', label: t('overlaySoft') },
                            { value: 'strong', label: t('overlayStrong') },
                          ]}
                        />
                      </Row>
                    </div>
                  </div>
                )}
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
                  {!liveChat && (
                    <>
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
                    </>
                  )}
                  {kind === 'lead' && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{t('schedule')}</p>
                      <p className="text-xs text-muted-foreground">{t('scheduleHint')}</p>
                    </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Row label={t('opensAt')}>
                      <Input type="datetime-local" disabled={!canEdit} value={toLocal(s.rules.opensAt)} onChange={(e) => patch({ rules: { opensAt: fromLocal(e.target.value) } })} />
                    </Row>
                    <Row label={t('closesAt')}>
                      <Input type="datetime-local" disabled={!canEdit} value={toLocal(s.rules.closesAt)} onChange={(e) => patch({ rules: { closesAt: fromLocal(e.target.value) } })} />
                    </Row>
                  </div>
                  {(s.rules.opensAt || s.rules.closesAt) && (
                    <Row label={t('closedMessage')}>
                      <Input disabled={!canEdit} value={s.rules.closedMessage ?? ''} onChange={(e) => patch({ rules: { closedMessage: e.target.value } })} />
                    </Row>
                  )}
                  </div>
                  )}
                  {!liveChat && (
                    <>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={s.rules.saveMessageAsNote !== false} onCheckedChange={(on) => patch({ rules: { saveMessageAsNote: on } })} />
                    {t('messageAsNote')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={!!s.rules.turnstile} onCheckedChange={(on) => patch({ rules: { turnstile: on } })} />
                    {t('turnstile')}
                  </label>
                  {kind === 'lead' && (
                    <VerifyRow
                      t={t}
                      canEdit={canEdit}
                      advanced={advanced}
                      mode={(s.rules.verify ?? 'off') as 'off' | 'whatsapp' | 'email' | 'both'}
                      avail={verifyAvailability}
                      hasRequiredEmail={hasRequiredEmail}
                      onChange={(verify) => patch({ rules: { verify } })}
                      onTemplateCreated={onVerifyTemplateCreated}
                    />
                  )}
                  <Row label={t('retention')} hint={t('retentionHint')}>
                    <Input type="number" min={1} max={3650} disabled={!canEdit} value={s.rules.retentionDays ?? ''} placeholder={t('retentionForever')} onChange={(e) => patch({ rules: { retentionDays: e.target.value ? Math.min(3650, Math.max(1, Number(e.target.value))) : undefined } })} />
                  </Row>
                  {data.connections.length > 1 && (
                    <Row label={t('connection')} hint={t('connectionHint')}>
                      <select className={selectCls} disabled={!canEdit} value={s.whatsappConfigId ?? ''} onChange={(e) => patch({ whatsappConfigId: e.target.value || undefined })}>
                        <option value="">{t('connectionDefault')}</option>
                        {data.connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Row>
                  )}
                    </>
                  )}
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
                    <Row label={t('scoreField')} hint={t('scoreFieldHint')}>
                      <select className={selectCls} disabled={!canEdit} value={s.scoreFieldId ?? ''} onChange={(e) => patch({ scoreFieldId: e.target.value || undefined })}>
                        <option value="">{t('scoreFieldNone')}</option>
                        {data.customFields
                          .filter((f) => f.field_type === 'number')
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.field_name}
                            </option>
                          ))}
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
                      <ImagePicker disabled={!canEdit} value={s.ogImage} shape="wide" onChange={(url) => patch({ ogImage: url ?? undefined })} />
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

type VerifyMode = 'off' | 'whatsapp' | 'email' | 'both';

/** "Verify the visitor": a code on WhatsApp and/or email before the lead is saved, only when it can work. */
function VerifyRow({
  t,
  canEdit,
  advanced,
  mode,
  avail,
  hasRequiredEmail,
  onChange,
  onTemplateCreated,
}: {
  t: ReturnType<typeof useTranslations>;
  canEdit: boolean;
  advanced: boolean;
  mode: VerifyMode;
  avail: VerifyAvailability | null;
  hasRequiredEmail: boolean;
  onChange: (m: VerifyMode) => void;
  onTemplateCreated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const waOk = avail?.whatsapp.ok === true;
  const emailOk = avail?.email.ok === true && hasRequiredEmail;
  const opts: { value: VerifyMode; ok: boolean }[] = [
    { value: 'off', ok: true },
    { value: 'whatsapp', ok: waOk },
    { value: 'email', ok: emailOk },
    { value: 'both', ok: waOk && emailOk },
  ];
  const reasons: string[] = [];
  if (avail && !waOk) reasons.push(t(`verifyReason.wa_${avail.whatsapp.reason ?? 'no_connection'}`));
  if (avail && avail.email.ok && !hasRequiredEmail) reasons.push(t('verifyReason.email_field'));
  if (avail && !avail.email.ok) reasons.push(t('verifyReason.email_off'));
  const canCreateTemplate = avail?.whatsapp.reason === 'no_template' || avail?.whatsapp.reason === 'template_rejected';

  async function createTemplate() {
    setBusy(true);
    const res = await fetch('/api/forms/verify-template', { method: 'POST' });
    setBusy(false);
    if (!res.ok) return toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? t('verifyTemplateFailed'));
    toast.success(t('verifyTemplateSent'));
    onTemplateCreated?.();
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{t('verify')}</Label>
      <select
        className={selectCls}
        disabled={!canEdit || !advanced}
        value={mode}
        onChange={(e) => onChange(e.target.value as VerifyMode)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value} disabled={!o.ok && o.value !== mode}>
            {t(`verifyOption.${o.value}`)}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{advanced ? t('verifyHint') : t('hideBrandingLocked')}</p>
      {advanced && reasons.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {advanced && canCreateTemplate && canEdit ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void createTemplate()}>
          {t('verifyCreateTemplate')}
        </Button>
      ) : null}
    </div>
  );
}
