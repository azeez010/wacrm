'use client'

import { useState } from 'react'
import { buildWaLink } from '@/lib/marketing/wa-link'
import { CopyButton } from '@/components/marketing/copy-button'

export function WaLinkTool() {
  const [number, setNumber] = useState('')
  const [message, setMessage] = useState('Hello, I would like to know more.')
  const link = buildWaLink(number, message)
  const input = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm'
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <label className="block text-sm font-medium">
        WhatsApp number with country code
        <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="+234 801 234 5678" className={input} />
      </label>
      <label className="block text-sm font-medium">
        Message customers start with (optional)
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={input} />
      </label>
      <div className="rounded-lg bg-muted/50 p-3 text-sm break-all" aria-live="polite">
        {link ?? <span className="text-muted-foreground">Enter the number with its country code, for example +234 for Nigeria.</span>}
      </div>
      {link && (
        <div className="flex gap-2">
          <CopyButton text={link} />
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Test the link</a>
        </div>
      )}
    </div>
  )
}
