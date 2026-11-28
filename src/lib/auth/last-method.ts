'use client'

import { useEffect, useState } from 'react'

export type AuthMethod = 'google' | 'email'

const KEY = 'ogd-last-auth-method'

/** Remembers on this browser how the person last signed in, so the login page can mark it. */
export function rememberAuthMethod(method: AuthMethod): void {
  try {
    localStorage.setItem(KEY, method)
  } catch {
    // Private mode or blocked storage: the badge is a convenience only.
  }
}

export function parseAuthMethod(value: unknown): AuthMethod | null {
  return value === 'google' || value === 'email' ? value : null
}

/** The method used last on this browser, read after mount so server and client markup match. */
export function useLastAuthMethod(): AuthMethod | null {
  const [method, setMethod] = useState<AuthMethod | null>(null)
  useEffect(() => {
    try {
      setMethod(parseAuthMethod(localStorage.getItem(KEY)))
    } catch {
      setMethod(null)
    }
  }, [])
  return method
}
