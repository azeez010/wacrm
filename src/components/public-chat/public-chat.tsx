'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PoweredBy } from '@/components/public-form/powered-by';
import {
  addLocal,
  chatSocketUrl,
  confirmLocal,
  failLocal,
  localId,
  mergeMessages,
  newestConfirmedAt,
  reconnectDelay,
  retryLocal,
  type LocalMessage,
} from '@/lib/chat/client-state';
import type { ChatMessageView, ServerFrame } from '@/lib/chat/protocol';
import { CHAT_IMAGE_MAX_BYTES } from '@/lib/chat/upload';
import { COUNTRIES, composeFormPhone, resolveDefaultCountry } from '@/lib/forms/countries';
import type { PublicFormConfig } from '@/lib/forms/public-config';
import { stringsFor } from '@/lib/forms/public-strings';
import { themeVars } from '@/lib/forms/theme';

// ============================================================
// The visitor's live chat, inside the support-button iframe.
//   pre-chat  -> greeting + the details the owner asked for + the first message
//   chat      -> real-time thread (WebSocket) with polling as the fallback,
//                typing indicator, image upload, retry on failure
// Everything the owner or a teammate wrote is rendered as TEXT, never HTML.
// ============================================================

interface ChatStatus {
  online: boolean;
  showOnlineBadge: boolean;
  greeting: string | null;
  offlineText: string | null;
  ask: Record<'name' | 'phone' | 'email', { required: boolean; label: string } | null>;
}

interface Session {
  token: string;
  conversationId: string;
}

const inputCls =
  'w-full rounded-lg border border-[color:var(--og-border)] bg-[var(--og-input)] px-3 py-2.5 text-sm text-[color:var(--og-fg)] placeholder:text-[color:var(--og-muted)] focus:border-[color:var(--og-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--og-ring)]';
const FRAME_HEIGHT = 540;
const POLL_MS = 4000;
const STATUS_MS = 30_000;
const PING_MS = 25_000;

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadVisitorId(fromQuery: string | null): string {
  if (fromQuery && fromQuery.length >= 8) return fromQuery.slice(0, 64);
  try {
    const existing = localStorage.getItem('ogadesk:vid');
    if (existing && existing.length >= 8) return existing;
    const id = randomId();
    localStorage.setItem('ogadesk:vid', id);
    return id;
  } catch {
    return randomId();
  }
}

const sessionKey = (publicId: string) => `ogadesk:chat:${publicId}`;

function readSession(publicId: string): Session | null {
  try {
    const raw = localStorage.getItem(sessionKey(publicId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session>;
    return typeof v.token === 'string' && typeof v.conversationId === 'string' ? { token: v.token, conversationId: v.conversationId } : null;
  } catch {
    return null;
  }
}
function writeSession(publicId: string, s: Session | null) {
  try {
    if (s) localStorage.setItem(sessionKey(publicId), JSON.stringify(s));
    else localStorage.removeItem(sessionKey(publicId));
  } catch {
    /* storage blocked: the chat still works for this visit */
  }
}

function previewStatus(config: PublicFormConfig): ChatStatus {
  const ask = (kind: string) => {
    const f = config.fields.find((x) => x.kind === kind);
    return f ? { required: f.required === true, label: f.label ?? '' } : null;
  };
  return {
    online: true,
    showOnlineBadge: config.chat?.showOnlineBadge !== false,
    greeting: config.chat?.greeting ?? null,
    offlineText: config.chat?.offlineText ?? null,
    ask: { name: ask('name'), phone: ask('phone'), email: ask('email') },
  };
}

export function PublicChat({
  config,
  preview = false,
  detectedCountry,
}: {
  config: PublicFormConfig;
  preview?: boolean;
  detectedCountry?: string | null;
}) {
  const t = stringsFor(config.language);
  const accent = config.widget?.color ?? config.accent;
  const api = `/api/public/chat/${config.publicId}`;

  const [status, setStatus] = useState<ChatStatus | null>(preview ? previewStatus(config) : null);
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<'loading' | 'prechat' | 'chat' | 'unavailable'>(preview ? 'prechat' : 'loading');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [agentTyping, setAgentTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visitorId = useRef('');
  const sessionRef = useRef<Session | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  const inFlight = useRef(0);
  const pendingSends = useRef(new Map<string, { text: string; file: File | null }>());
  const socket = useRef<WebSocket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const authHeaders = useCallback((): Record<string, string> => (sessionRef.current ? { 'X-Chat-Token': sessionRef.current.token } : {}), []);

  const endSession = useCallback(() => {
    writeSession(config.publicId, null);
    setSession(null);
    setMessages([]);
    setConnected(false);
    setStage('prechat');
  }, [config.publicId]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: 'no-store' });
      const j = (await res.json()) as ChatStatus & { ok?: boolean };
      if (res.ok && j.ok) setStatus(j);
      else if (res.status === 403 || res.status === 404) setStage('unavailable');
    } catch {
      /* keep the last known status */
    }
  }, [api]);

  const fetchSince = useCallback(async () => {
    if (!sessionRef.current || inFlight.current > 0) return;
    const since = newestConfirmedAt(messagesRef.current);
    try {
      const res = await fetch(`${api}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers: authHeaders(), cache: 'no-store' });
      if (res.status === 401) return endSession();
      const j = (await res.json()) as { ok?: boolean; messages?: ChatMessageView[] };
      if (res.ok && j.ok && j.messages) setMessages((cur) => mergeMessages(cur, j.messages as ChatMessageView[]));
    } catch {
      /* the next poll retries */
    }
  }, [api, authHeaders, endSession]);

  // Boot: visitor id, saved chat, first status.
  useEffect(() => {
    window.parent.postMessage({ source: 'ogadesk', type: 'resize', height: FRAME_HEIGHT }, '*');
    if (preview) return;
    visitorId.current = loadVisitorId(new URLSearchParams(window.location.search).get('ogvid'));
    void fetchStatus();
    const saved = readSession(config.publicId);
    if (!saved) {
      setStage((s) => (s === 'loading' ? 'prechat' : s));
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${api}/messages`, { headers: { 'X-Chat-Token': saved.token }, cache: 'no-store' });
        const j = (await res.json()) as { ok?: boolean; messages?: ChatMessageView[] };
        if (res.ok && j.ok) {
          setSession(saved);
          setMessages(j.messages ?? []);
          setStage('chat');
        } else {
          writeSession(config.publicId, null);
          setStage('prechat');
        }
      } catch {
        setStage('prechat');
      }
    })();
  }, [api, config.publicId, fetchStatus, preview]);

  // Keep the Online badge fresh.
  useEffect(() => {
    if (preview || stage === 'loading' || stage === 'unavailable') return;
    const id = setInterval(() => void fetchStatus(), STATUS_MS);
    return () => clearInterval(id);
  }, [fetchStatus, preview, stage]);

  // Real-time: one WebSocket per chat, with backoff, keepalive and catch-up on reconnect.
  useEffect(() => {
    if (preview || stage !== 'chat' || !session) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(chatSocketUrl(window.location.origin, session.conversationId, session.token));
      } catch {
        retry = setTimeout(connect, reconnectDelay(attempt++));
        return;
      }
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        void fetchSince(); // anything that arrived while we were away
        ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), PING_MS);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string' || e.data === 'pong') return;
        let frame: ServerFrame;
        try {
          frame = JSON.parse(e.data) as ServerFrame;
        } catch {
          return;
        }
        if (frame.type === 'message') {
          // Our own messages come back from the POST; only the team's arrive here.
          if (frame.message.sender_type !== 'customer') {
            setMessages((cur) => mergeMessages(cur, [frame.message]));
            setAgentTyping(false);
          }
        } else if (frame.type === 'typing' && frame.from === 'agent') {
          setAgentTyping(frame.on);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          if (frame.on) typingTimer.current = setTimeout(() => setAgentTyping(false), 5000);
        }
      };
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        setConnected(false);
        if (!closed) retry = setTimeout(connect, reconnectDelay(attempt++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      socket.current?.close();
      socket.current = null;
    };
  }, [fetchSince, preview, session, stage]);

  // Polling fallback while the socket is down.
  useEffect(() => {
    if (preview || stage !== 'chat' || connected) return;
    const id = setInterval(() => void fetchSince(), POLL_MS);
    return () => clearInterval(id);
  }, [connected, fetchSince, preview, stage]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, agentTyping, stage]);

  const sendTyping = useCallback((on: boolean) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== 1) return;
    const now = Date.now();
    if (on && now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    ws.send(JSON.stringify({ type: 'typing', on }));
  }, []);

  const errorText = useCallback(
    (code: string | undefined): string => {
      if (code === 'too_large') return t.chatImageTooBig;
      if (code === 'unsupported_type' || code === 'empty') return t.chatImageType;
      if (code === 'upload_limit') return t.chatUploadLimit;
      if (code === 'unavailable') return t.chatUnavailable;
      if (code === 'rate_limited') return t.too_many;
      if (code === 'invalid_phone') return t.invalid_phone;
      if (code === 'missing_field') return t.required;
      return t.generic_error;
    },
    [t],
  );

  const postMessage = useCallback(
    async (clientId: string, text: string, file: File | null) => {
      inFlight.current += 1;
      try {
        let res: Response;
        if (file) {
          const body = new FormData();
          body.set('file', file);
          if (text) body.set('text', text);
          body.set('clientId', clientId);
          res = await fetch(`${api}/message`, { method: 'POST', headers: authHeaders(), body });
        } else {
          res = await fetch(`${api}/message`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text, clientId }) });
        }
        if (res.status === 401) return endSession();
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: ChatMessageView; error?: string };
        if (res.ok && j.ok && j.message) {
          pendingSends.current.delete(clientId);
          setMessages((cur) => confirmLocal(cur, clientId, j.message as ChatMessageView));
        } else {
          setMessages((cur) => failLocal(cur, clientId));
          setNotice(errorText(j.error));
        }
      } catch {
        setMessages((cur) => failLocal(cur, clientId));
      } finally {
        inFlight.current -= 1;
      }
    },
    [api, authHeaders, endSession, errorText],
  );

  const send = useCallback(
    (text: string, file: File | null) => {
      const clientId = randomId();
      pendingSends.current.set(clientId, { text, file });
      const local: LocalMessage = {
        id: localId(clientId),
        clientId,
        local: 'sending',
        sender_type: 'customer',
        content_type: file ? 'image' : 'text',
        content_text: text || null,
        media_url: file ? URL.createObjectURL(file) : null,
        created_at: new Date().toISOString(),
      };
      setMessages((cur) => addLocal(cur, local));
      void postMessage(clientId, text, file);
    },
    [postMessage],
  );

  const retry = useCallback(
    (clientId: string) => {
      const p = pendingSends.current.get(clientId);
      if (!p) return;
      setMessages((cur) => retryLocal(cur, clientId));
      void postMessage(clientId, p.text, p.file);
    },
    [postMessage],
  );

  const start = useCallback(
    async (details: { name: string; phone: string; email: string; message: string; honeypot: string }) => {
      const clientId = randomId();
      const res = await fetch(`${api}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: visitorId.current,
          name: details.name || undefined,
          phone: details.phone || undefined,
          email: details.email || undefined,
          message: details.message,
          clientId,
          website: details.honeypot || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ignored?: boolean; token?: string; conversationId?: string; messages?: ChatMessageView[]; error?: string };
      if (!res.ok || !j.ok) throw new Error(errorText(j.error));
      if (j.ignored || !j.token || !j.conversationId) return;
      const s = { token: j.token, conversationId: j.conversationId };
      writeSession(config.publicId, s);
      setSession(s);
      setMessages(j.messages ?? []);
      setStage('chat');
    },
    [api, config.publicId, errorText],
  );

  const greeting = status?.greeting || config.chat?.greeting || t.chatHello;
  const online = status?.online ?? false;
  const title = config.widget?.greeting || config.title;

  return (
    <div style={{ ...themeVars(config.theme), color: 'var(--og-fg)' }} className="flex h-screen min-h-[320px] flex-col bg-[var(--og-card)]">
      <header className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: accent, color: '#fff' }}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {status?.showOnlineBadge !== false && status ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs opacity-95" aria-live="polite">
              <span aria-hidden className={`inline-block size-2 rounded-full ${online ? 'bg-emerald-300' : 'bg-white/50'}`} />
              {online ? t.chatOnline : t.chatOffline}
            </div>
          ) : null}
        </div>
      </header>

      {stage === 'loading' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[color:var(--og-muted)]">...</div>
      ) : stage === 'unavailable' ? (
        <p className="p-6 text-center text-sm text-[color:var(--og-muted)]">{t.chatUnavailable}</p>
      ) : stage === 'prechat' && status ? (
        <PreChat t={t} status={status} greeting={greeting} accent={accent} preview={preview} defaultCountry={resolveDefaultCountry(config.defaultCountry, detectedCountry)} onStart={start} />
      ) : stage === 'chat' ? (
        <>
          {!online && status?.offlineText ? (
            <p className="bg-[var(--og-warn-bg)] px-4 py-2 text-xs text-[color:var(--og-warn-fg)]">{status.offlineText}</p>
          ) : null}
          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} accent={accent} aiLabel={t.chatAi} failedLabel={t.chatFailed} onRetry={m.clientId ? () => retry(m.clientId as string) : undefined} />
            ))}
            {agentTyping ? <p className="px-1 text-xs text-[color:var(--og-muted)]">{t.chatTyping}</p> : null}
          </div>
          {notice ? (
            <p role="alert" className="px-4 pb-1 text-xs text-red-500" onClick={() => setNotice(null)}>
              {notice}
            </p>
          ) : null}
          {!connected ? <p className="px-4 pb-1 text-[11px] text-[color:var(--og-muted)]">{t.chatReconnecting}</p> : null}
          <Composer t={t} accent={accent} onSend={send} onTyping={sendTyping} onError={setNotice} />
        </>
      ) : null}

      {config.showBranding ? (
        <div className="shrink-0 border-t border-[color:var(--og-border)] py-1.5">
          <PoweredBy lang={config.language} origin={typeof window !== 'undefined' ? window.location.origin : undefined} />
        </div>
      ) : null}
    </div>
  );
}

function PreChat({
  t,
  status,
  greeting,
  accent,
  preview,
  defaultCountry,
  onStart,
}: {
  t: ReturnType<typeof stringsFor>;
  status: ChatStatus;
  greeting: string;
  accent: string;
  preview: boolean;
  defaultCountry: string;
  onStart: (d: { name: string; phone: string; email: string; message: string; honeypot: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState(defaultCountry);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const honeypot = useRef<HTMLInputElement>(null);

  const label = (k: 'name' | 'phone' | 'email', fallback: string) => status.ask[k]?.label || fallback;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || preview) return;
    const errs: Record<string, string> = {};
    if (status.ask.name?.required && !name.trim()) errs.name = t.required;
    if (status.ask.email) {
      if (status.ask.email.required && !email.trim()) errs.email = t.required;
      else if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = t.invalid_email;
    }
    let composed = '';
    if (status.ask.phone) {
      composed = phone.trim() ? composeFormPhone(phone, country) : '';
      if (status.ask.phone.required && !composed) errs.phone = t.required;
      else if (composed && !composed.startsWith('+')) errs.phone = t.invalid_phone;
    }
    if (!message.trim()) errs.message = t.required;
    setFieldErr(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await onStart({ name: name.trim(), phone: composed, email: email.trim(), message: message.trim(), honeypot: honeypot.current?.value ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.generic_error);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => (fieldErr[k] ? <p role="alert" className="mt-1 text-xs text-red-500">{fieldErr[k]}</p> : null);

  return (
    <form onSubmit={submit} noValidate className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-[var(--og-input)] px-3 py-2 text-sm">{greeting}</div>
      {!status.online && status.offlineText ? (
        <p className="rounded-lg bg-[var(--og-warn-bg)] p-3 text-xs text-[color:var(--og-warn-fg)]">{status.offlineText}</p>
      ) : null}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {status.ask.name ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--og-label)]" htmlFor="ogc-name">
            {label('name', t.name)}
            {status.ask.name.required ? <span className="text-red-500"> *</span> : <span className="text-[color:var(--og-muted)]"> ({t.optional})</span>}
          </label>
          <input id="ogc-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          {err('name')}
        </div>
      ) : null}
      {status.ask.phone ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--og-label)]" htmlFor="ogc-phone">
            {label('phone', t.phone)}
            {status.ask.phone.required ? <span className="text-red-500"> *</span> : <span className="text-[color:var(--og-muted)]"> ({t.optional})</span>}
          </label>
          <div className="flex gap-2">
            <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} className={`${inputCls} w-[7rem] shrink-0 px-2`}>
              {COUNTRIES.map((c) => (
                <option key={`${c.iso}-${c.cc}`} value={c.iso}>
                  {c.iso} +{c.cc}
                </option>
              ))}
            </select>
            <input id="ogc-phone" type="tel" inputMode="tel" autoComplete="tel" className={`${inputCls} min-w-0 flex-1`} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
          </div>
          {err('phone')}
        </div>
      ) : null}
      {status.ask.email ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--og-label)]" htmlFor="ogc-email">
            {label('email', t.email)}
            {status.ask.email.required ? <span className="text-red-500"> *</span> : <span className="text-[color:var(--og-muted)]"> ({t.optional})</span>}
          </label>
          <input id="ogc-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} />
          {err('email')}
        </div>
      ) : null}
      <div>
        <label className="mb-1 block text-xs font-medium text-[color:var(--og-label)]" htmlFor="ogc-message">
          {t.message}
          <span className="text-red-500"> *</span>
        </label>
        <textarea id="ogc-message" rows={3} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
        {err('message')}
      </div>
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      <button type="submit" disabled={busy} className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60" style={{ backgroundColor: accent }}>
        {busy ? t.sending : t.chatStart}
      </button>
    </form>
  );
}

function Bubble({ m, accent, aiLabel, failedLabel, onRetry }: { m: LocalMessage; accent: string; aiLabel: string; failedLabel: string; onRetry?: () => void }) {
  const mine = m.sender_type === 'customer';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!mine && (m.sender_name || m.ai_generated) ? (
          <span className="mb-0.5 px-1 text-[11px] text-[color:var(--og-muted)]">
            {m.ai_generated ? aiLabel : m.sender_name}
          </span>
        ) : null}
        <div
          className={`rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-sm text-white' : 'rounded-bl-sm bg-[var(--og-input)] text-[color:var(--og-fg)]'} ${m.local === 'sending' ? 'opacity-70' : ''}`}
          style={mine ? { backgroundColor: accent } : undefined}
        >
          {m.content_type === 'image' && m.media_url ? (
            <a href={m.media_url} target="_blank" rel="noopener noreferrer nofollow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.media_url} alt="" className="mb-1 max-h-56 rounded-lg object-cover" />
            </a>
          ) : null}
          {m.content_text ? <p className="whitespace-pre-wrap break-words">{m.content_text}</p> : null}
        </div>
        {m.local === 'failed' ? (
          <button type="button" onClick={onRetry} className="mt-0.5 px-1 text-[11px] text-red-500 underline">
            {failedLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Composer({
  t,
  accent,
  onSend,
  onTyping,
  onError,
}: {
  t: ReturnType<typeof stringsFor>;
  accent: string;
  onSend: (text: string, file: File | null) => void;
  onTyping: (on: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function submit() {
    const body = text.trim();
    if (!body && !file) return;
    onSend(body, file);
    setText('');
    setFile(null);
    onTyping(false);
    if (idle.current) clearTimeout(idle.current);
  }

  function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > CHAT_IMAGE_MAX_BYTES) return onError(t.chatImageTooBig);
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(f.type)) return onError(t.chatImageType);
    onError(null);
    setFile(f);
  }

  return (
    <div className="border-t border-[color:var(--og-border)] p-2">
      {previewUrl ? (
        <div className="mb-2 flex items-center gap-2 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="size-12 rounded-md object-cover" />
          <button type="button" onClick={() => setFile(null)} aria-label="Remove" className="text-lg leading-none text-[color:var(--og-muted)]">
            ×
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInput.current?.click()} aria-label={t.chatAttach} title={t.chatAttach} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--og-muted)] hover:bg-[var(--og-input)]">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder={t.chatPlaceholder}
          maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            onTyping(true);
            if (idle.current) clearTimeout(idle.current);
            idle.current = setTimeout(() => onTyping(false), 3000);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={`${inputCls} max-h-28 min-h-9 flex-1 resize-none py-2`}
        />
        <button type="button" onClick={submit} disabled={!text.trim() && !file} className="h-9 shrink-0 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: accent }}>
          {t.chatSend}
        </button>
      </div>
    </div>
  );
}
