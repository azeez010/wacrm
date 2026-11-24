'use client';

import { backgroundCss, logoImageClass, logoWrapperClass, overlayPercent } from '@/lib/forms/branding';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderSVG } from 'uqr';

import { COUNTRIES, composeFormPhone, resolveDefaultCountry } from '@/lib/forms/countries';
import { themeVars } from '@/lib/forms/theme';
import { PoweredBy } from './powered-by';
import { Editable, EditContext } from './editable';
import type { PreviewEdit } from '@/lib/forms/preview-edit';
import type { PublicField, PublicFormConfig } from '@/lib/forms/public-config';
import { stringsFor } from '@/lib/forms/public-strings';

// ============================================================
// The public lead form. Anonymous, light, mobile-first. Used by the hosted page
// (/f/<id>), the iframe embed (/embed/f/<id>) and the support-button panel.
// Everything the owner typed is rendered as TEXT (never HTML).
// ============================================================

interface SuccessInfo {
  action: 'message' | 'redirect' | 'whatsapp';
  message?: string;
  redirectUrl?: string;
  whatsappUrl?: string | null;
  followUpLine?: boolean;
}

const VISITOR_KEY = 'ogadesk:vid';
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;
const CLICK_KEYS = ['gclid', 'fbclid', 'ttclid', 'fbp', 'fbc', 'msclkid'] as const;

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadVisitorId(fromQuery: string | null): string {
  if (fromQuery && fromQuery.length >= 8) return fromQuery.slice(0, 64);
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = randomId();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function post(parent: boolean, message: Record<string, unknown>) {
  if (!parent || typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ source: 'ogadesk', ...message }, '*');
}

export function PublicForm({
  config,
  embedded = false,
  preview = false,
  onEdit,
  detectedCountry,
  fullPage = false,
}: {
  config: PublicFormConfig;
  embedded?: boolean;
  /** The visitor's country (Cloudflare), used when the form's default country is automatic. */
  detectedCountry?: string | null;
  /** The hosted page: paints the themed page background around the card. */
  fullPage?: boolean;
  /** Editor preview: no beacons, no submit. */
  preview?: boolean;
  /** Editor preview only: makes the form's text click-to-edit. */
  onEdit?: (edit: PreviewEdit) => void;
}) {
  const t = stringsFor(config.language);
  const accent = config.accent;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [country, setCountry] = useState(() => resolveDefaultCountry(config.defaultCountry, detectedCountry));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SuccessInfo | null>(null);
  const [gated, setGated] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const started = useRef(false);
  const rendered = useRef(0);
  const key = useRef(randomId());
  const root = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ vid: string; utm: Record<string, string>; click: Record<string, string>; params: URLSearchParams }>({
    vid: '',
    utm: {},
    click: {},
    params: new URLSearchParams(),
  });

  const endpoint = `/api/public/forms/${config.publicId}`;

  // Capture visitor id, UTM, click ids and prefill from the URL once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = params.get(`utm_${k}`);
      if (v) utm[k] = v.slice(0, 300);
    }
    const click: Record<string, string> = {};
    for (const k of CLICK_KEYS) {
      const v = params.get(k);
      if (v) click[k] = v.slice(0, 300);
    }
    rendered.current = Date.now();
    if (preview) return;
    ctx.current = { vid: loadVisitorId(params.get('ogvid')), utm, click, params };
    // Prefill: ?<field param>=value for hidden fields, ?phone / ?name / ?email for core ones.
    const pre: Record<string, unknown> = {};
    for (const f of config.fields) {
      if (f.kind === 'hidden' && f.param) {
        const v = params.get(f.param);
        if (v) pre[f.id] = v.slice(0, 300);
      }
      if (f.kind === 'phone' || f.kind === 'name' || f.kind === 'email' || f.kind === 'company') {
        const v = params.get(f.kind);
        if (v) pre[f.id] = v.slice(0, 200);
      }
    }
    if (Object.keys(pre).length > 0) setValues((prev) => ({ ...pre, ...prev }));
    // The view beacon: page seen, or (support button) panel opened.
    void fetch(`${endpoint}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view', visitorId: ctx.current.vid }),
      keepalive: true,
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the embedding page our height so the iframe fits.
  useEffect(() => {
    if (preview || !embedded || !root.current) return;
    const el = root.current;
    const send = () => post(true, { type: 'resize', height: Math.ceil(el.getBoundingClientRect().height) + 2 });
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded]);

  // Cloudflare Turnstile, only when the owner turned it on and the app has a site key.
  useEffect(() => {
    const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!config.turnstile || !site) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => {
      const w = window as unknown as { turnstile?: { render: (el: string, o: Record<string, unknown>) => void } };
      w.turnstile?.render('#ogadesk-turnstile', { sitekey: site, callback: (tok: string) => setTurnstileToken(tok) });
    };
    document.head.appendChild(s);
    return () => {
      s.remove();
    };
  }, [config.turnstile]);

  const setValue = useCallback(
    (id: string, v: unknown) => {
      setValues((prev) => ({ ...prev, [id]: v }));
      setErrors((prev) => {
        if (!prev[id]) return prev;
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
      if (!started.current && !preview) {
        started.current = true;
        void fetch(`${endpoint}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'start', visitorId: ctx.current.vid }),
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [endpoint, preview],
  );

  const errText = useCallback(
    (code: string): string => {
      const known = (t as unknown as Record<string, string>)[code];
      return known ?? code;
    },
    [t],
  );

  const composePhone = (raw: unknown) => composeFormPhone(raw, country);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || preview) return;
    setBusy(true);
    setFormError(null);
    const answers: Record<string, unknown> = {};
    for (const f of config.fields) {
      if (f.kind === 'heading') continue;
      if (f.kind === 'hidden') {
        const v = f.fixedValue ?? values[f.id];
        if (v) answers[f.id] = v;
        continue;
      }
      answers[f.id] = f.kind === 'phone' ? composePhone(values[f.id]) : values[f.id];
    }
    try {
      const res = await fetch(`${endpoint}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          website: (root.current?.querySelector('input[name="website"]') as HTMLInputElement | null)?.value ?? '',
          elapsedMs: Date.now() - rendered.current,
          visitorId: ctx.current.vid,
          key: key.current,
          utm: ctx.current.utm,
          clickIds: ctx.current.click,
          referrer: ctx.current.params.get('ogref') || document.referrer || undefined,
          pageUrl: (ctx.current.params.get('ogpage') || window.location.href).slice(0, 900),
          turnstileToken,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: Record<string, string>;
        message?: string;
        success?: SuccessInfo;
      };
      if (json.ok && json.success) {
        setDone(json.success);
        post(embedded, { type: 'submitted', whatsappUrl: json.success.whatsappUrl, redirectUrl: json.success.redirectUrl });
        if (json.success.action === 'redirect' && json.success.redirectUrl && !embedded) {
          window.location.href = json.success.redirectUrl;
        }
      } else if (json.error === 'invalid' && json.errors) {
        setErrors(json.errors);
        setFormError(json.errors._form ? t.generic_error : null);
      } else if (json.error === 'gated') {
        setGated(json.message || t.closed);
      } else if (json.error === 'closed') {
        setFormError(json.message || t.closed);
      } else if (res.status === 429) {
        setFormError(t.too_many);
      } else {
        setFormError(t.generic_error);
      }
    } catch {
      setFormError(t.generic_error);
    } finally {
      setBusy(false);
    }
  }

  const editFn = preview && onEdit ? onEdit : null;
  const rootStyle = { ...themeVars(config.theme), color: 'var(--og-fg)' };
  const wrapper = embedded
    ? 'w-full bg-[var(--og-card)] p-3'
    : 'mx-auto w-full max-w-md rounded-2xl border border-[color:var(--og-border)] bg-[var(--og-card)] p-6 shadow-sm sm:p-8';
  const page = (node: React.ReactNode) => (
    <EditContext.Provider value={editFn}>
      {fullPage ? (
        <div style={{ ...themeVars(config.theme), color: 'var(--og-fg)' }} className="relative min-h-screen bg-[var(--og-page)] px-4 py-8 sm:py-14">
          {config.backgroundImage ? (
            <>
              <div aria-hidden className="absolute inset-0" style={{ backgroundImage: `url("${config.backgroundImage.replace(/"/g, '%22')}")`, ...backgroundCss(config.backgroundFit, config.backgroundPosition) }} />
              {/* A veil in the page colour keeps the form readable on any picture, light or dark. */}
              <div aria-hidden className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--og-page) ${overlayPercent(config.backgroundOverlay)}%, transparent)` }} />
            </>
          ) : null}
          <div className="relative">{node}</div>
        </div>
      ) : (
        node
      )}
    </EditContext.Provider>
  );

  if (done) {
    return page(
      <div ref={root} className={wrapper} style={rootStyle}>
        <SuccessView done={done} t={t} accent={accent} config={config} />
        {config.showBranding ? <PoweredBy lang={config.language} /> : null}
      </div>,
    );
  }

  return page(
    <div ref={root} className={wrapper} style={rootStyle}>
      <form onSubmit={submit} noValidate className="space-y-4" aria-describedby={formError ? 'og-form-error' : undefined}>
        {config.logoUrl ? (
          <div className={logoWrapperClass(config.logoAlign)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={config.logoUrl} alt="" className={logoImageClass(config.logoSize)} />
          </div>
        ) : null}
        {!embedded || config.kind === 'lead' ? (
          <div>
            <h1 className="text-xl font-semibold leading-tight"><Editable target={{ kind: 'setting', key: 'title' }} value={config.title} /></h1>
            {config.description || editFn ? <p className="mt-1 text-sm text-[color:var(--og-muted)]"><Editable target={{ kind: 'setting', key: 'description' }} value={config.description ?? ''} multiline /></p> : null}
          </div>
        ) : config.description || editFn ? (
          <p className="text-sm text-[color:var(--og-muted)]"><Editable target={{ kind: 'setting', key: 'description' }} value={config.description ?? ''} multiline /></p>
        ) : null}

        {/* Honeypot: invisible to people, tempting to bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {gated ? (
          <p role="alert" className="rounded-lg bg-[var(--og-warn-bg)] p-3 text-sm text-[color:var(--og-warn-fg)]">
            {gated}
          </p>
        ) : null}

        {config.fields.map((f) => (
          <FieldInput
            key={f.id}
            f={f}
            value={values[f.id]}
            error={errors[f.id] ? errText(errors[f.id]) : undefined}
            onChange={(v) => setValue(f.id, v)}
            t={t}
            accent={accent}
            country={country}
            onCountry={setCountry}
            defaultCountry={config.defaultCountry}
          />
        ))}

        {config.turnstile ? <div id="ogadesk-turnstile" /> : null}

        {formError ? (
          <p id="og-form-error" role="alert" className="text-sm text-red-500">
            {formError}
          </p>
        ) : null}

        {editFn ? (
          <div className="w-full rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
            <Editable target={{ kind: 'setting', key: 'buttonText' }} value={config.buttonText || t.submit} />
          </div>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {busy ? t.sending : config.buttonText || t.submit}
          </button>
        )}
        {config.showBranding ? <PoweredBy lang={config.language} /> : null}
      </form>
    </div>,
  );
}

function Label({ htmlFor, children, required }: { htmlFor?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-[color:var(--og-label)]">
      {children}
      {required ? <span className="text-red-500"> *</span> : null}
    </label>
  );
}

const inputCls =
  'rounded-lg border border-[color:var(--og-border)] bg-[var(--og-input)] px-3 py-2.5 text-sm text-[color:var(--og-fg)] placeholder:text-[color:var(--og-muted)] focus:border-[color:var(--og-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--og-ring)]';
const inputFull = `w-full ${inputCls}`;

function FieldInput({
  f,
  value,
  error,
  onChange,
  t,
  accent,
  country,
  onCountry,
  defaultCountry,
}: {
  f: PublicField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  t: ReturnType<typeof stringsFor>;
  accent: string;
  country: string;
  onCountry: (c: string) => void;
  defaultCountry: string;
}) {
  const id = `og-${f.id}`;
  const err = error ? (
    <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-500">
      {error}
    </p>
  ) : null;
  const aria = { 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-err` : undefined } as const;

  if (f.kind === 'heading') return <p className="text-sm text-[color:var(--og-label)]"><Editable target={{ kind: 'field', fieldId: f.id, key: 'text' }} value={f.text ?? ''} multiline /></p>;
  if (f.kind === 'hidden') return null;

  if (f.kind === 'consent') {
    return (
      <div>
        <label className="flex items-start gap-2 text-sm text-[color:var(--og-label)]">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 size-4 rounded border-[color:var(--og-border)]"
            style={{ accentColor: accent }}
            {...aria}
          />
          <span>
            <Editable target={{ kind: 'field', fieldId: f.id, key: 'consentText' }} value={f.consentText || f.label} multiline />
            {f.privacyUrl ? (
              <>
                {' '}
                <a href={f.privacyUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  ↗
                </a>
              </>
            ) : null}
            {f.required ? <span className="text-red-500"> *</span> : null}
          </span>
        </label>
        {err}
      </div>
    );
  }

  const label = f.label || defaultLabel(f, t);

  if (f.kind === 'phone') {
    return (
      <div>
        <Label htmlFor={id} required>
          <Editable target={{ kind: 'field', fieldId: f.id, key: 'label' }} value={label} />
        </Label>
        <div className="flex gap-2">
          <select
            aria-label="Country"
            value={country}
            onChange={(e) => onCountry(e.target.value)}
            className={`${inputCls} w-[7rem] shrink-0 px-2`}
          >
            {COUNTRIES.map((c) => (
              <option key={`${c.iso}-${c.cc}`} value={c.iso}>
                {c.iso} +{c.cc}
              </option>
            ))}
          </select>
          <input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={String(value ?? '')}
            placeholder={f.placeholder || (country === defaultCountry && defaultCountry === 'NG' ? '0803 123 4567' : '')}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputCls} min-w-0 flex-1`}
            {...aria}
          />
        </div>
        {f.help ? <p className="mt-1 text-xs text-[color:var(--og-muted)]"><Editable target={{ kind: 'field', fieldId: f.id, key: 'help' }} value={f.help} /></p> : null}
        {err}
      </div>
    );
  }

  if (f.kind === 'tag_picker') {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <Label required={f.required}><Editable target={{ kind: 'field', fieldId: f.id, key: 'label' }} value={label} /></Label>
        <div className="flex flex-wrap gap-2">
          {(f.tags ?? []).map((tg) => {
            const on = picked.includes(tg.id);
            return (
              <button
                key={tg.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((x) => x !== tg.id) : [...picked, tg.id])}
                className="rounded-full border px-3 py-1.5 text-sm"
                style={on ? { backgroundColor: accent, borderColor: accent, color: '#fff' } : { borderColor: 'var(--og-border)' }}
              >
                {tg.name}
              </button>
            );
          })}
        </div>
        {err}
      </div>
    );
  }

  // Choice fields (enum / multi_enum, custom fields or table columns)
  if ((f.type === 'enum' || f.type === 'multi_enum') && f.options && f.options.length > 0) {
    const multi = f.type === 'multi_enum';
    const picked = multi ? (Array.isArray(value) ? (value as string[]) : []) : [];
    const display = f.display ?? (f.options.length <= 4 ? 'radio' : 'select');
    return (
      <div>
        <Label htmlFor={id} required={f.required}>
          <Editable target={{ kind: 'field', fieldId: f.id, key: 'label' }} value={label} />
        </Label>
        {display === 'select' && !multi ? (
          <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputFull} {...aria}>
            <option value="">{t.select}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-2" role={multi ? 'group' : 'radiogroup'}>
            {f.options.map((o) => {
              const on = multi ? picked.includes(o) : value === o;
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(multi ? (on ? picked.filter((x) => x !== o) : [...picked, o]) : on ? '' : o)}
                  className="rounded-full border px-3 py-1.5 text-sm"
                  style={on ? { backgroundColor: accent, borderColor: accent, color: '#fff' } : { borderColor: 'var(--og-border)' }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        )}
        {f.help ? <p className="mt-1 text-xs text-[color:var(--og-muted)]"><Editable target={{ kind: 'field', fieldId: f.id, key: 'help' }} value={f.help} /></p> : null}
        {err}
      </div>
    );
  }

  if (f.type === 'bool') {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm text-[color:var(--og-label)]">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="size-4" style={{ accentColor: accent }} />
          <Editable target={{ kind: 'field', fieldId: f.id, key: 'label' }} value={label} />
          {f.required ? <span className="text-red-500"> *</span> : null}
        </label>
        {err}
      </div>
    );
  }

  const type =
    f.kind === 'email' || f.type === 'email'
      ? 'email'
      : f.type === 'number'
        ? 'number'
        : f.type === 'date'
          ? 'date'
          : f.type === 'datetime'
            ? 'datetime-local'
            : f.type === 'url'
              ? 'url'
              : f.type === 'phone'
                ? 'tel'
                : 'text';

  return (
    <div>
      <Label htmlFor={id} required={f.required}>
        <Editable target={{ kind: 'field', fieldId: f.id, key: 'label' }} value={label} />
      </Label>
      {f.kind === 'message' ? (
        <textarea
          id={id}
          rows={4}
          value={String(value ?? '')}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputFull}
          {...aria}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={String(value ?? '')}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputFull}
          autoComplete={f.kind === 'name' ? 'name' : f.kind === 'email' ? 'email' : f.kind === 'company' ? 'organization' : undefined}
          {...aria}
        />
      )}
      {f.help ? <p className="mt-1 text-xs text-[color:var(--og-muted)]"><Editable target={{ kind: 'field', fieldId: f.id, key: 'help' }} value={f.help} /></p> : null}
      {err}
    </div>
  );
}

function defaultLabel(f: PublicField, t: ReturnType<typeof stringsFor>): string {
  switch (f.kind) {
    case 'phone':
      return t.phone;
    case 'name':
      return t.name;
    case 'email':
      return t.email;
    case 'company':
      return t.company;
    case 'message':
      return t.message;
    default:
      return '';
  }
}

function SuccessView({
  done,
  t,
  accent,
  config,
}: {
  done: SuccessInfo;
  t: ReturnType<typeof stringsFor>;
  accent: string;
  config: PublicFormConfig;
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(!/mobi|android|iphone|ipad/i.test(navigator.userAgent));
  }, []);
  const qr = useMemo(() => {
    if (!done.whatsappUrl) return null;
    try {
      return `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(done.whatsappUrl, { border: 1 }))}`;
    } catch {
      return null;
    }
  }, [done.whatsappUrl]);

  return (
    <div className="space-y-4 py-2 text-center" role="status">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full text-white" style={{ backgroundColor: accent }} aria-hidden>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-base font-medium">{done.message || config.success.message || t.thanks}</p>
      {done.action === 'redirect' && done.redirectUrl ? (
        <a href={done.redirectUrl} className="text-sm underline">
          →
        </a>
      ) : null}
      {done.action === 'whatsapp' && done.whatsappUrl ? (
        <div className="space-y-3">
          <a
            href={done.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block w-full rounded-lg px-4 py-3 text-sm font-semibold text-white"
            style={{ backgroundColor: '#16a34a' }}
          >
            {t.continueWhatsapp}
          </a>
          {desktop && qr ? (
            <div>
              <p className="mb-1 text-xs text-[color:var(--og-muted)]">{t.scanQr}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="" className="mx-auto size-36" />
            </div>
          ) : null}
          {done.followUpLine !== false ? <p className="text-xs text-[color:var(--og-muted)]">{t.followUp}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
