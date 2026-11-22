'use client';

import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { renderSVG } from 'uqr';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FormKind } from '@/lib/forms/types';

function CopyBox({ value, multiline }: { value: string; multiline?: boolean }) {
  const t = useTranslations('Forms.share');
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <pre className="max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs text-foreground">{value}</pre>
      ) : (
        <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
        {done ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium" aria-expanded={open}>
        {title}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-3 border-t border-border p-3">{children}</div>}
    </div>
  );
}

export function plainHtmlSnippet(origin: string, publicId: string): string {
  return `<form id="lead-form">
  <input name="phone" type="tel" placeholder="WhatsApp number" required>
  <input name="name" placeholder="Name">
  <button>Send</button>
</form>
<script>
document.getElementById('lead-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var f = new FormData(e.target);
  var res = await fetch('${origin}/api/public/forms/${publicId}/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Use the field ids from your form (the keys below are the defaults).
    body: JSON.stringify({ answers: { phone: f.get('phone'), name: f.get('name') } })
  });
  alert((await res.json()).ok ? 'Thanks!' : 'Please check your details');
});
</script>`;
}

/** Share: copy link + QR for a lead form, the one script line for a support button. */
export function ShareDialog({ open, onOpenChange, kind, publicId }: { open: boolean; onOpenChange: (o: boolean) => void; kind: FormKind; publicId: string }) {
  const t = useTranslations('Forms.share');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const [utm, setUtm] = useState({ source: '', medium: '', campaign: '' });

  const base = `${origin}/f/${publicId}`;
  const link = useMemo(() => {
    const p = new URLSearchParams();
    if (utm.source) p.set('utm_source', utm.source);
    if (utm.medium) p.set('utm_medium', utm.medium);
    if (utm.campaign) p.set('utm_campaign', utm.campaign);
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  }, [base, utm]);
  const svg = useMemo(() => renderSVG(link, { border: 2 }), [link]);
  const qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  function download(kindOf: 'svg' | 'png') {
    const a = document.createElement('a');
    if (kindOf === 'svg') {
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      a.download = `form-${publicId}.svg`;
      a.click();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 720;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 720, 720);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 720, 720);
      a.href = c.toDataURL('image/png');
      a.download = `form-${publicId}.png`;
      a.click();
    };
    img.src = qrSrc;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{kind === 'support' ? t('supportHint') : t('leadHint')}</DialogDescription>
        </DialogHeader>

        {kind === 'support' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('pasteBeforeBody')}</p>
            <CopyBox multiline value={`<script src="${origin}/embed.js" data-widget="${publicId}" async></script>`} />
          </div>
        ) : (
          <div className="space-y-4">
            <CopyBox value={link} />
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc} alt={t('qrAlt')} className="size-32 rounded-lg border border-border bg-white p-1" />
              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={() => download('png')}>
                  <Download className="size-4" />
                  PNG
                </Button>
                <Button variant="outline" size="sm" onClick={() => download('svg')}>
                  <Download className="size-4" />
                  SVG
                </Button>
              </div>
            </div>

            <Disclosure title={t('tracking')}>
              <p className="text-xs text-muted-foreground">{t('trackingHint')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder="utm_source" value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} />
                <Input placeholder="utm_medium" value={utm.medium} onChange={(e) => setUtm({ ...utm, medium: e.target.value })} />
                <Input placeholder="utm_campaign" value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} />
              </div>
            </Disclosure>

            <Disclosure title={t('embed')}>
              <p className="text-xs text-muted-foreground">{t('embedScript')}</p>
              <CopyBox multiline value={`<div data-ogadesk-form="${publicId}"></div>\n<script src="${origin}/embed.js" async></script>`} />
              <p className="text-xs text-muted-foreground">{t('embedIframe')}</p>
              <CopyBox multiline value={`<iframe src="${origin}/embed/f/${publicId}" width="100%" height="520" style="border:0"></iframe>`} />
              <p className="text-xs text-muted-foreground">{t('embedHtml')}</p>
              <CopyBox multiline value={plainHtmlSnippet(origin, publicId)} />
            </Disclosure>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
