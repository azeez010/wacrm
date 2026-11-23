'use client'

import { useEffect } from 'react'

/** Headless. Counts one click when a page is opened with `?ref=CODE` (once per code per tab session). */
export function ReferralClickBeacon() {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('ref')
      if (!code || !/^[A-Za-z0-9_-]{3,32}$/.test(code)) return
      const key = `ogadesk_ref_clicked:${code.toUpperCase()}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      void fetch('/api/partner/click', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    } catch {
      // Storage blocked: skip counting rather than break the page.
    }
  }, [])
  return null
}
