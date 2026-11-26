'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Header buttons for the public content pages. They are server-rendered for signed-out visitors
 * (and crawlers), then swap to "Dashboard" once the browser session is found. `getSession()` only
 * reads the cookie, so the page itself stays cacheable.
 */
export function AuthButtons({ labels }: { labels: { login: string; dashboard: string; getStarted: string } }) {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    let live = true
    try {
      void createClient()
        .auth.getSession()
        .then(({ data }) => live && setSignedIn(Boolean(data.session)))
        .catch(() => {})
    } catch {
      // no session available: stay on the signed-out buttons
    }
    return () => {
      live = false
    }
  }, [])

  if (signedIn) {
    return (
      <Link href="/dashboard" className={cn(buttonVariants({ size: 'sm' }))}>
        {labels.dashboard}
      </Link>
    )
  }
  return (
    <>
      <Link href="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        {labels.login}
      </Link>
      <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>
        {labels.getStarted}
      </Link>
    </>
  )
}
