'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formSettingsSchema, type FormField, type FormSettings } from '@/lib/forms/types';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EditorAction } from './editor-state';
import type { FormEditorData } from './use-form-data';
import Link from 'next/link';
import { ThemeSelect } from './theme-select';

const selectCls = 'h-9 w-full rounded-lg border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-60';
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/** The Support button editor: five controls, plus one "More options" disclosure. */
export function SupportEditor({
  fields,
  settings,
  canEdit,
  dispatch,
  onPlaySound,
  pipelines = [],
}: {
  /** The account's pipelines (support ones are offered for live-chat tickets). */
  pipelines?: FormEditorData['pipelines'];
  fields: FormField[];
  settings: FormSettings;
  canEdit: boolean;
  dispatch: (a: EditorAction) => void;
  /** Plays the chosen sound in the live preview. */
  onPlaySound?: () => void;
}) {
  const t = useTranslations('Forms.support');
  const td = useTranslations('Forms.edit');
  const [more, setMore] = useState(false);
  // Defaults come from the schema so the editor and the saved form agree.
  const w = settings.widget ?? formSettingsSchema.shape.widget.unwrap().parse({});
  const patchW = (p: Record<string, unknown>) => dispatch({ type: 'settings', patch: { widget: p } });
  const has = (kind: FormField['kind']) => fields.some((f) => f.kind === kind);
  const toggle = (kind: 'name' | 'email' | 'message', on: boolean) => {
    if (on && !has(kind)) dispatch({ type: 'add', field: { id: kind, kind, required: true } });
    if (!on) {
      const f = fields.find((x) => x.kind === kind);
      if (f) dispatch({ type: 'remove', id: f.id });
    }
  };
  const hours = w.hours ?? { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
  const liveChat = w.mode === 'live_chat';
  const chat = settings.chat ?? { showOnlineBadge: true, onlineMode: 'auto' as const, showTyping: true, allowSkip: false };
  const patchChat = (p: Record<string, unknown>) => dispatch({ type: 'settings', patch: { chat: p } });
  // Switching mode keeps the fields consistent: a chat always asks for the first message and may skip the phone;
  // WhatsApp mode needs the phone (the handoff goes to WhatsApp) and the message stays optional.
  const setMode = (mode: 'whatsapp' | 'live_chat') => {
    patchW({ mode, ...(mode === 'live_chat' && w.icon === 'whatsapp' ? { icon: 'chat' } : {}), ...(mode === 'whatsapp' && w.icon === 'chat' ? { icon: 'whatsapp' } : {}) });
    const phone = fields.find((f) => f.kind === 'phone');
    if (mode === 'live_chat') {
      if (phone) dispatch({ type: 'update', id: phone.id, patch: { required: true } });
      if (!has('message')) dispatch({ type: 'add', field: { id: 'message', kind: 'message', required: true } });
      else dispatch({ type: 'update', id: fields.find((f) => f.kind === 'message')!.id, patch: { required: true } });
    } else if (phone) dispatch({ type: 'update', id: phone.id, patch: { required: true } });
    else dispatch({ type: 'add', field: { id: 'phone', kind: 'phone', required: true }, at: 0 });
  };
  const togglePhone = (on: boolean) => {
    const phone = fields.find((f) => f.kind === 'phone');
    if (on && !phone) dispatch({ type: 'add', field: { id: 'phone', kind: 'phone', required: true } });
    if (!on && phone) dispatch({ type: 'remove', id: phone.id });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t('mode')}</Label>
        <select className={selectCls} disabled={!canEdit} value={w.mode} onChange={(e) => setMode(e.target.value as 'whatsapp' | 'live_chat')}>
          <option value="whatsapp">{t('modeWhatsapp')}</option>
          <option value="live_chat">{t('modeLiveChat')}</option>
        </select>
        <p className="text-xs text-muted-foreground">{liveChat ? t('modeLiveChatHint') : t('modeWhatsappHint')}</p>
      </div>
      {liveChat ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('chatGreeting')}</Label>
            <Input disabled={!canEdit} value={chat.greeting ?? ''} placeholder={t('chatGreetingPlaceholder')} onChange={(e) => patchChat({ greeting: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('chatOffline')}</Label>
            <Input disabled={!canEdit} value={chat.offlineText ?? ''} onChange={(e) => patchChat({ offlineText: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('onlineMode')}</Label>
            <select className={selectCls} disabled={!canEdit} value={chat.onlineMode ?? 'auto'} onChange={(e) => patchChat({ onlineMode: e.target.value })}>
              <option value="auto">{t('onlineAuto')}</option>
              <option value="always">{t('onlineAlways')}</option>
            </select>
            <p className="text-xs text-muted-foreground">{(chat.onlineMode ?? 'auto') === 'auto' ? t('onlineRule') : t('onlineAlwaysHint')}</p>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            {t('showTyping')}
            <Switch disabled={!canEdit} checked={chat.showTyping !== false} onCheckedChange={(on) => patchChat({ showTyping: on })} />
          </label>
          <ChatTicketSettings
            canEdit={canEdit}
            ticket={chat.ticket}
            pipelines={pipelines.filter((p) => p.kind === 'support')}
            onChange={(ticket) => patchChat({ ticket })}
          />
        </div>
      ) : null}
      {liveChat ? (
        <label className="flex items-center justify-between gap-2 text-sm">
          {t('askPhone')}
          <Switch disabled={!canEdit} checked={has('phone')} onCheckedChange={togglePhone} />
        </label>
      ) : null}
      <label className="flex items-center justify-between gap-2 text-sm">
        {t('askName')}
        <Switch disabled={!canEdit} checked={has('name')} onCheckedChange={(on) => toggle('name', on)} />
      </label>
      <label className="flex items-center justify-between gap-2 text-sm">
        {t('askEmail')}
        <Switch disabled={!canEdit} checked={has('email')} onCheckedChange={(on) => toggle('email', on)} />
      </label>
      {liveChat ? (
        <label className="flex items-center justify-between gap-2 text-sm">
          {t('allowSkip')}
          <Switch disabled={!canEdit} checked={chat.allowSkip === true} onCheckedChange={(on) => patchChat({ allowSkip: on })} />
        </label>
      ) : null}
      {liveChat ? null : (
        <label className="flex items-center justify-between gap-2 text-sm">
          {t('askMessage')}
          <Switch disabled={!canEdit} checked={has('message')} onCheckedChange={(on) => toggle('message', on)} />
        </label>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t('label')}</Label>
        <Input disabled={!canEdit} value={w.label ?? ''} onChange={(e) => patchW({ label: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('color')}</Label>
          <input type="color" disabled={!canEdit} value={w.color ?? settings.accent ?? '#16a34a'} onChange={(e) => { patchW({ color: e.target.value }); dispatch({ type: 'settings', patch: { accent: e.target.value } }); }} className="h-9 w-full rounded-lg border border-border bg-muted" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('corner')}</Label>
          <select className={selectCls} disabled={!canEdit} value={w.corner} onChange={(e) => patchW({ corner: e.target.value })}>
            <option value="bottom-left">{t('bottomLeft')}</option>
            <option value="bottom-right">{t('bottomRight')}</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('icon')}</Label>
          <select className={selectCls} disabled={!canEdit} value={w.icon} onChange={(e) => patchW({ icon: e.target.value })}>
            <option value="whatsapp">WhatsApp</option>
            <option value="chat">{t('iconChat')}</option>
            <option value="headset">{t('iconHeadset')}</option>
          </select>
        </div>
        <ThemeSelect value={settings.theme} canEdit={canEdit} onChange={(theme) => dispatch({ type: 'settings', patch: { theme } })} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t('greeting')}</Label>
        <Input disabled={!canEdit} value={w.greeting ?? ''} onChange={(e) => patchW({ greeting: e.target.value })} />
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="text-sm font-medium">{t('attention')}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('animation')}</Label>
            <select className={selectCls} disabled={!canEdit} value={w.animation} onChange={(e) => patchW({ animation: e.target.value })}>
              {['none', 'pulse', 'bounce', 'wiggle', 'ring'].map((a) => (
                <option key={a} value={a}>
                  {t(`anim.${a}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('sound')}</Label>
            <div className="flex gap-1.5">
              <select className={selectCls} disabled={!canEdit} value={w.sound} onChange={(e) => patchW({ sound: e.target.value })}>
                <option value="none">{t('sounds.none')}</option>
                <option value="chime">{t('sounds.chime')}</option>
                <option value="pop">{t('sounds.pop')}</option>
              </select>
              <Button type="button" variant="outline" size="icon" aria-label={t('playSound')} title={t('playSound')} onClick={() => onPlaySound?.()}>
                <Volume2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('preMessage')}</Label>
          <Input disabled={!canEdit} value={w.preMessage ?? ''} placeholder={t('preMessagePlaceholder')} onChange={(e) => patchW({ preMessage: e.target.value })} />
        </div>
        {w.preMessage ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('preMessageDelay')}</Label>
            <Input type="number" min={0} max={120} disabled={!canEdit} value={w.preMessageDelay} onChange={(e) => patchW({ preMessageDelay: Math.min(120, Math.max(0, Number(e.target.value) || 0)) })} />
          </div>
        ) : null}
        {w.preMessage ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('preMessageRepeat')}</Label>
            <select className={selectCls} disabled={!canEdit} value={w.preMessageRepeat ?? 'session'} onChange={(e) => patchW({ preMessageRepeat: e.target.value })}>
              <option value="session">{t('repeatSession')}</option>
              <option value="always">{t('repeatAlways')}</option>
            </select>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('soundNote')}</p>
      </div>

      <div className="rounded-lg border border-border">
        <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium" aria-expanded={more}>
          {td('moreOptions')}
          <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} />
        </button>
        {more && (
          <div className="space-y-4 border-t border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('offsetX')}</Label>
                <Input type="number" min={0} max={400} disabled={!canEdit} value={w.offsetX} onChange={(e) => patchW({ offsetX: clamp(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('offsetY')}</Label>
                <Input type="number" min={0} max={400} disabled={!canEdit} value={w.offsetY} onChange={(e) => patchW({ offsetY: clamp(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('devices')}</Label>
              <select className={selectCls} disabled={!canEdit} value={w.devices} onChange={(e) => patchW({ devices: e.target.value })}>
                <option value="all">{t('devicesAll')}</option>
                <option value="mobile">{t('devicesMobile')}</option>
                <option value="desktop">{t('devicesDesktop')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('showOn')}</Label>
              <select className={selectCls} disabled={!canEdit} value={w.showOn} onChange={(e) => patchW({ showOn: e.target.value })}>
                <option value="all">{t('showAll')}</option>
                <option value="contains">{t('showContains')}</option>
              </select>
              {w.showOn === 'contains' && <Input disabled={!canEdit} value={w.urlContains ?? ''} placeholder="/pricing" onChange={(e) => patchW({ urlContains: e.target.value })} />}
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch disabled={!canEdit} checked={hours.enabled} onCheckedChange={(on) => patchW({ hours: { ...hours, enabled: on } })} />
                {t('hours')}
              </label>
              {hours.enabled && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((d) => {
                      const on = hours.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!canEdit}
                          aria-pressed={on}
                          onClick={() => patchW({ hours: { ...hours, days: on ? hours.days.filter((x) => x !== d) : [...hours.days, d] } })}
                          className={cn('rounded-md border px-2 py-1 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                        >
                          {t(`day${d}`)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="time" disabled={!canEdit} value={hours.from} onChange={(e) => patchW({ hours: { ...hours, from: e.target.value } })} />
                    <Input type="time" disabled={!canEdit} value={hours.to} onChange={(e) => patchW({ hours: { ...hours, to: e.target.value } })} />
                  </div>
                  <Input disabled={!canEdit} value={hours.offlineText ?? ''} placeholder={t('offlineText')} onChange={(e) => patchW({ hours: { ...hours, offlineText: e.target.value } })} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const clamp = (v: string) => Math.min(400, Math.max(0, Number(v) || 0));

type ChatTicket = NonNullable<NonNullable<FormSettings['chat']>['ticket']>;

/** "Create a ticket for each new chat" + support pipeline/stage pickers. */
function ChatTicketSettings({
  canEdit,
  ticket,
  pipelines,
  onChange,
}: {
  canEdit: boolean;
  ticket: ChatTicket | undefined;
  pipelines: FormEditorData['pipelines'];
  onChange: (t: ChatTicket) => void;
}) {
  const t = useTranslations('Forms.support');
  const enabled = ticket?.enabled === true;
  const pipeline = pipelines.find((p) => p.id === ticket?.pipelineId) ?? pipelines[0];
  const stageId =
    pipeline?.stages.some((s) => s.id === ticket?.stageId) ? ticket?.stageId : pipeline?.stages[0]?.id;
  const set = (patch: Partial<ChatTicket>) =>
    onChange({ enabled, pipelineId: pipeline?.id, stageId, ...patch });

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <label className="flex items-center justify-between gap-2 text-sm">
        {t('chatTicket')}
        <Switch
          disabled={!canEdit || pipelines.length === 0}
          checked={enabled && pipelines.length > 0}
          onCheckedChange={(on) => set({ enabled: on })}
        />
      </label>
      {pipelines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('chatTicketNoPipeline')}{' '}
          <Link href="/pipelines?kind=support" className="text-primary underline-offset-2 hover:underline">
            {t('chatTicketCreatePipeline')}
          </Link>
        </p>
      ) : enabled ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select
              className={selectCls}
              disabled={!canEdit}
              aria-label={t('chatTicketPipeline')}
              value={pipeline?.id ?? ''}
              onChange={(e) => {
                const p = pipelines.find((x) => x.id === e.target.value);
                set({ pipelineId: p?.id, stageId: p?.stages[0]?.id });
              }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              className={selectCls}
              disabled={!canEdit}
              aria-label={t('chatTicketStage')}
              value={stageId ?? ''}
              onChange={(e) => set({ stageId: e.target.value })}
            >
              {(pipeline?.stages ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">{t('chatTicketHint')}</p>
        </>
      ) : null}
    </div>
  );
}
