'use client'

import { useEffect } from 'react'
import { useAuth } from '@/hooks/use-auth'

/**
 * Headless. If this browser arrived through a partner's ?ref= link (cookie
 * `ogadesk_ref`), tell the server once so the signed-in user is linked to that
 * partner. The server clears the cookie, so this never repeats.
 */
export function ReferralAttribution() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    if (!document.cookie.split('; ').some((c) => c.startsWith('ogadesk_ref='))) return
    fetch('/api/partner/attribute', { method: 'POST' }).catch(() => undefined)
  }, [user])
  return null
}
