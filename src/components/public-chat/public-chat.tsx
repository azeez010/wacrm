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
import { composeFormPhone, resolveDefaultCountry } from '@/lib/forms/countries';
import { validateEmail, validateMessage, validateName, validatePhone, type ValidationCode } from '@/lib/forms/client-validate';
import { PhoneInput } from '@/components/public-form/phone-input';
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

export interface ChatStatus {
  online: boolean;
  showOnlineBadge: boolean;
  showTyping?: boolean;
  allowSkip?: boolean;
  agentName?: string | null;
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

const draftKey = (publicId: string) => `ogadesk:chatdraft:${publicId}`;
function readDraft(publicId: string): string | null {
  try {
    return localStorage.getItem(draftKey(publicId));
  } catch {
    return null;
  }
}
function writeDraft(publicId: string, text: string | null) {
  try {
    if (text) localStorage.setItem(draftKey(publicId), text);
    else localStorage.removeItem(draftKey(publicId));
  } catch {
    /* storage blocked: the intro just restarts on reload */
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
    showTyping: config.chat?.showTyping !== false,
    allowSkip: config.chat?.allowSkip === true,
    greeting: config.chat?.greeting ?? null,
    offlineText: config.chat?.offlineText ?? null,
    ask: { name: ask('name'), phone: ask('phone'), email: ask('email') },
  };
}

export function PublicChat({
  config,
  preview = false,
  detectedCountry,
  initialStatus,
}: {
  config: PublicFormConfig;
  preview?: boolean;
  detectedCountry?: string | null;
  /** Server-rendered status: the greeting and fields paint immediately, no first round trip. */
  initialStatus?: ChatStatus | null;
}) {
  const t = stringsFor(config.language);
  const accent = config.widget?.color ?? config.accent;
  const api = `/api/public/chat/${config.publicId}`;

  // Preview derives its status from the live config (no frozen copy); real visitors fetch it.
  const previewSt = useMemo(() => previewStatus(config), [config]);
  const [liveStatus, setStatus] = useState<ChatStatus | null>(initialStatus ?? null);
  const status = preview ? previewSt : liveStatus;
  const [intro, setIntro] = useState<{ text: string; phase: 'typing' | 'details' } | null>(null);
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
    setIntro(null);
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
    if (!initialStatus) void fetchStatus();
    const saved = readSession(config.publicId);
    if (!saved) {
      const draft = readDraft(config.publicId);
      if (draft) setIntro({ text: draft, phase: 'details' });
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
  }, [api, config.publicId, fetchStatus, initialStatus, preview]);

  // The host page tells us when the panel opens/closes: the iframe is preloaded hidden, so only
  // poll (and refresh once on open) while someone can actually see it.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const onHost = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string } | null;
      if (!d || d.source !== 'ogadesk-host' || e.source !== window.parent) return;
      setPanelOpen(d.type === 'open');
    };
    window.addEventListener('message', onHost);
    return () => window.removeEventListener('message', onHost);
  }, []);
  useEffect(() => {
    if (!panelOpen || preview) return;
    void fetchStatus();
  }, [fetchStatus, panelOpen, preview]);

  // Keep the Online badge fresh while the panel is open.
  useEffect(() => {
    if (preview || !panelOpen || stage === 'loading' || stage === 'unavailable') return;
    const id = setInterval(() => void fetchStatus(), STATUS_MS);
    return () => clearInterval(id);
  }, [fetchStatus, panelOpen, preview, stage]);

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
      if (code === 'invalid_name') return t.invalid_name;
      if (code === 'invalid_email') return t.invalid_email;
      if (code === 'invalid_message') return t.invalid_message;
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
    async (details: { name: string; phone: string; email: string; message: string; honeypot: string; skip?: boolean }) => {
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
          skipDetails: details.skip ? true : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ignored?: boolean; token?: string; conversationId?: string; messages?: ChatMessageView[]; error?: string };
      if (!res.ok || !j.ok) throw new Error(errorText(j.error));
      if (j.ignored || !j.token || !j.conversationId) return;
      const s = { token: j.token, conversationId: j.conversationId };
      writeSession(config.publicId, s);
      writeDraft(config.publicId, null);
      setIntro(null);
      setSession(s);
      setMessages(j.messages ?? []);
      setStage('chat');
    },
    [api, config.publicId, errorText],
  );

  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (introTimer.current) clearTimeout(introTimer.current);
    },
    [],
  );
  const asked = status ? Object.values(status.ask).filter(Boolean).length : 0;

  // First message typed before anything exists server-side: keep it local, then either ask for the details
  // (after the typing dots) or, when none are asked, open the chat straight away.
  const firstMessage = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!status) return;
      setNotice(null);
      if (asked === 0) {
        if (preview) return;
        try {
          await start({ name: '', phone: '', email: '', message: body, honeypot: '' });
        } catch (e) {
          setNotice(e instanceof Error ? e.message : t.generic_error);
        }
        return;
      }
      if (!preview) writeDraft(config.publicId, body);
      const typing = status.showTyping !== false;
      setIntro({ text: body, phase: typing ? 'typing' : 'details' });
      if (typing) {
        if (introTimer.current) clearTimeout(introTimer.current);
        introTimer.current = setTimeout(() => setIntro((cur) => (cur ? { ...cur, phase: 'details' } : cur)), 1200);
      }
    },
    [asked, config.publicId, preview, start, status, t.generic_error],
  );

  const submitDetails = useCallback(
    async (d: { name: string; phone: string; email: string; honeypot: string; skip?: boolean }) => {
      if (preview || !intro) return;
      await start({ ...d, message: intro.text });
    },
    [intro, preview, start],
  );

  const greeting = status?.greeting || config.chat?.greeting || t.chatHello;
  // Once a teammate has replied in this chat they are plainly there: show them by name, not the offline notice.
  const replier = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.content_type === 'event' && m.content_text) return m.content_text;
      if (m.sender_type === 'agent' && !m.ai_generated && m.sender_name) return m.sender_name;
    }
    return null;
  }, [messages]);
  const online = (status?.online ?? false) || !!replier;
  const agentName = replier ?? (status?.online ? status.agentName ?? null : null);
  const title = config.widget?.greeting || config.title;

  return (
    <div style={{ ...themeVars(config.theme), color: 'var(--og-fg)' }} className="flex h-screen min-h-[320px] flex-col bg-[var(--og-card)]">
      <header className="flex items-center gap-3 py-3 pl-4 pr-12" style={{ backgroundColor: accent, color: '#fff' }}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {status?.showOnlineBadge !== false && status ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs opacity-95" aria-live="polite">
              <span aria-hidden className={`inline-block size-2 rounded-full ${online ? 'bg-emerald-300' : 'bg-white/50'}`} />
              {online ? (agentName ? `${agentName} · ${t.chatOnline}` : t.chatOnline) : t.chatOffline}
            </div>
          ) : null}
        </div>
      </header>

      {stage === 'loading' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[color:var(--og-muted)]">...</div>
      ) : stage === 'unavailable' ? (
        <p className="p-6 text-center text-sm text-[color:var(--og-muted)]">{t.chatUnavailable}</p>
      ) : stage === 'prechat' && status ? (
        <IntroView
          t={t}
          status={status}
          greeting={greeting}
          accent={accent}
          online={online}
          intro={intro}
          notice={notice}
          onNotice={setNotice}
          defaultCountry={resolveDefaultCountry(config.defaultCountry, detectedCountry)}
          onSend={firstMessage}
          onSubmit={submitDetails}
          errorText={errorText}
        />
      ) : stage === 'chat' ? (
        <>
          {!online && status?.offlineText ? (
            <p className="bg-[var(--og-warn-bg)] px-4 py-2 text-xs text-[color:var(--og-warn-fg)]">{status.offlineText}</p>
          ) : null}
          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
            {messages.map((m) =>
              m.content_type === 'event' ? (
                <div key={m.id} className="flex justify-center py-1">
                  <span className="rounded-full bg-[var(--og-input)] px-3 py-1 text-[11px] text-[color:var(--og-muted)]">{t.chatAgentJoined.replace('{name}', m.content_text ?? '')}</span>
                </div>
              ) : (
              <Bubble key={m.id} m={m} accent={accent} aiLabel={t.chatAi} failedLabel={t.chatFailed} onRetry={m.clientId ? () => retry(m.clientId as string) : undefined} />
            )
            )}
            {agentTyping ? <p className="px-1 text-xs text-[color:var(--og-muted)]">{t.chatTyping}</p> : null}
          </div>
          {notice ? (
            <p role="alert" className="px-4 pb-1 text-xs text-red-500" onClick={() => setNotice(null)}>
              {notice}
            </p>
          ) : null}
          {!connected ? <p className="px-4 pb-1 text-[11px] text-[color:var(--og-muted)]">{t.chatReconnecting}</p> : null}
          <Composer
            t={t}
            accent={accent}
            onSend={send}
            onTyping={sendTyping}
            onError={setNotice}
            validate={(text, hasFile) => {
              if (!text && hasFile) return null;
              const c = validateMessage(text, true);
              return c ? (c === 'required' ? t.required : t.invalid_message) : null;
            }}
          />
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

function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex" role="status" aria-label={label}>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-[var(--og-input)] px-3 py-3">
        {[0, 150, 300].map((d) => (
          <span key={d} aria-hidden className="size-1.5 animate-bounce rounded-full bg-[color:var(--og-muted)]" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

const botBubble = 'max-w-[85%] rounded-2xl rounded-bl-sm bg-[var(--og-input)] px-3 py-2 text-sm';

/**
 * Before a chat exists: the greeting, the visitor's first message, then (after typing dots)
 * the details the owner asked for. Nothing is created on the server until those are sent.
 */
export function IntroView({
  t,
  status,
  greeting,
  accent,
  online,
  intro,
  notice,
  onNotice,
  defaultCountry,
  onSend,
  onSubmit,
  errorText,
}: {
  t: ReturnType<typeof stringsFor>;
  status: ChatStatus;
  greeting: string;
  accent: string;
  online: boolean;
  intro: { text: string; phase: 'typing' | 'details' } | null;
  notice: string | null;
  onNotice: (m: string | null) => void;
  defaultCountry: string;
  onSend: (text: string) => void | Promise<void>;
  onSubmit: (d: { name: string; phone: string; email: string; honeypot: string; skip?: boolean }) => Promise<void>;
  errorText: (code: string | undefined) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [intro?.phase, intro?.text]);

  const codeText = (c: ValidationCode) => (c === 'required' ? t.required : errorText(c));

  return (
    <>
      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
        <div className={botBubble}>{greeting}</div>
        {!online && status.offlineText ? (
          <p className="rounded-lg bg-[var(--og-warn-bg)] p-3 text-xs text-[color:var(--og-warn-fg)]">{status.offlineText}</p>
        ) : null}
        {intro ? (
          <div className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-3 py-2 text-sm text-white" style={{ backgroundColor: accent }}>
              {intro.text}
            </div>
          </div>
        ) : null}
        {intro?.phase === 'typing' ? <TypingDots label={t.chatTyping} /> : null}
        {intro?.phase === 'details' ? (
          <>
            <div className={botBubble}>{t.chatDetailsPrompt}</div>
            <DetailsCard t={t} status={status} accent={accent} defaultCountry={defaultCountry} onSubmit={onSubmit} codeText={codeText} />
          </>
        ) : null}
      </div>
      {notice ? (
        <p role="alert" className="px-4 pb-1 text-xs text-red-500" onClick={() => onNotice(null)}>
          {notice}
        </p>
      ) : null}
      {!intro ? (
        <Composer
          t={t}
          accent={accent}
          allowImage={false}
          onSend={(text) => void onSend(text)}
          onTyping={() => undefined}
          onError={onNotice}
          validate={(text) => {
            const c = validateMessage(text, true);
            return c ? codeText(c) : null;
          }}
        />
      ) : null}
    </>
  );
}

function DetailsCard({
  t,
  status,
  accent,
  defaultCountry,
  onSubmit,
  codeText,
}: {
  t: ReturnType<typeof stringsFor>;
  status: ChatStatus;
  accent: string;
  defaultCountry: string;
  onSubmit: (d: { name: string; phone: string; email: string; honeypot: string; skip?: boolean }) => Promise<void>;
  codeText: (c: ValidationCode) => string;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState(defaultCountry);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const honeypot = useRef<HTMLInputElement>(null);

  const label = (k: 'name' | 'phone' | 'email', fallback: string) => status.ask[k]?.label || fallback;

  // One place for the rules: returns the per-field error codes for what is currently typed.
  function check(): Record<string, ValidationCode> {
    const errs: Record<string, ValidationCode> = {};
    if (status.ask.name) {
      const c = validateName(name, status.ask.name.required);
      if (c) errs.name = c;
    }
    if (status.ask.email) {
      const c = validateEmail(email, status.ask.email.required);
      if (c) errs.email = c;
    }
    if (status.ask.phone) {
      const c = validatePhone(phone.trim() ? composeFormPhone(phone, country) : '', status.ask.phone.required);
      if (c) errs.phone = c;
    }
    return errs;
  }
  const showErrors = (errs: Record<string, ValidationCode>) =>
    setFieldErr(Object.fromEntries(Object.entries(errs).map(([k, c]) => [k, codeText(c)])));
  const blur = (k: 'name' | 'email' | 'phone') => {
    const c = check()[k];
    setFieldErr((cur) => {
      const { [k]: _drop, ...rest } = cur;
      return c ? { ...rest, [k]: codeText(c) } : rest;
    });
  };

  async function send(skip = false) {
    if (busy) return;
    if (!skip) {
      const errs = check();
      showErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: skip ? '' : name.trim(),
        phone: skip || !phone.trim() ? '' : composeFormPhone(phone, country),
        email: skip ? '' : email.trim(),
        honeypot: honeypot.current?.value ?? '',
        skip,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.generic_error);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => (fieldErr[k] ? <p role="alert" className="mt-1 text-xs text-red-500">{fieldErr[k]}</p> : null);
  const mark = (k: 'name' | 'phone' | 'email') =>
    status.ask[k]?.required ? <span className="text-red-500"> *</span> : <span className="text-[color:var(--og-muted)]"> ({t.optional})</span>;
  const lbl = 'mb-1 block text-xs font-medium text-[color:var(--og-label)]';

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="space-y-3 rounded-2xl border border-[color:var(--og-border)] p-3"
    >
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input ref={honeypot} type="text" name="ogx_hp" tabIndex={-1} autoComplete="off" readOnly />
      </div>
      {status.ask.name ? (
        <div>
          <label className={lbl} htmlFor="ogc-name">
            {label('name', t.name)}
            {mark('name')}
          </label>
          <input id="ogc-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => blur('name')} autoComplete="name" maxLength={120} aria-invalid={!!fieldErr.name || undefined} />
          {err('name')}
        </div>
      ) : null}
      {status.ask.phone ? (
        <div>
          <label className={lbl} htmlFor="ogc-phone">
            {label('phone', t.chatPhone)}
            {mark('phone')}
          </label>
          <PhoneInput id="ogc-phone" value={phone} onChange={setPhone} country={country} onCountry={setCountry} onBlur={() => blur('phone')} invalid={!!fieldErr.phone} />
          {err('phone')}
        </div>
      ) : null}
      {status.ask.email ? (
        <div>
          <label className={lbl} htmlFor="ogc-email">
            {label('email', t.email)}
            {mark('email')}
          </label>
          <input id="ogc-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => blur('email')} autoComplete="email" maxLength={254} aria-invalid={!!fieldErr.email || undefined} />
          {err('email')}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60" style={{ backgroundColor: accent }}>
          {busy ? t.chatConnecting : t.chatStart}
        </button>
        {status.allowSkip ? (
          <button type="button" disabled={busy} onClick={() => void send(true)} className="rounded-lg border border-[color:var(--og-border)] px-4 py-2.5 text-sm text-[color:var(--og-muted)] disabled:opacity-60">
            {t.chatSkip}
          </button>
        ) : null}
      </div>
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
  validate,
  allowImage = true,
}: {
  t: ReturnType<typeof stringsFor>;
  accent: string;
  /** Returns an error text to block the send (the draft stays in the box). */
  validate?: (text: string, hasFile: boolean) => string | null;
  allowImage?: boolean;
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
    const problem = validate?.(body, !!file);
    if (problem) return onError(problem);
    onError(null);
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
        {allowImage ? (
          <>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInput.current?.click()} aria-label={t.chatAttach} title={t.chatAttach} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--og-muted)] hover:bg-[var(--og-input)]">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
          </>
        ) : null}
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
