import type { CSSProperties } from 'react'

// ============================================================
// Colours for the public form, independent of the app's own theme.
//
// Everything is a CSS variable defined with light-dark(), so `auto` follows the
// visitor's OS preference with no JavaScript and no flash, and `light` / `dark`
// force one. The form never reads the app's Tailwind dark: tokens (an iframe
// inherits the app's dark styles for body/background, which is what made the
// labels unreadable before).
// ============================================================

export type FormTheme = 'auto' | 'light' | 'dark'

const PAIRS: Record<string, [light: string, dark: string]> = {
  '--og-page': ['#f9fafb', '#0b1220'],
  '--og-card': ['#ffffff', '#111827'],
  '--og-fg': ['#111827', '#f3f4f6'],
  '--og-label': ['#1f2937', '#e5e7eb'],
  '--og-muted': ['#6b7280', '#9ca3af'],
  '--og-border': ['#d1d5db', '#374151'],
  '--og-input': ['#ffffff', '#1f2937'],
  '--og-ring': ['rgba(0,0,0,.1)', 'rgba(255,255,255,.18)'],
  '--og-warn-bg': ['#fffbeb', '#422006'],
  '--og-warn-fg': ['#78350f', '#fde68a'],
  // OgaDesk brand: "Desk" green, from the brand kit (see BrandLogo).
  '--og-brand': ['#11875D', '#2AC58B'],
}

export const THEME_NAMES = Object.keys(PAIRS)

export function colorScheme(theme: FormTheme | undefined): string {
  return theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'light dark'
}

/** Inline style object that defines every variable and the colour scheme. */
export function themeVars(theme: FormTheme | undefined): CSSProperties {
  const out: Record<string, string> = { colorScheme: colorScheme(theme) }
  for (const [name, [l, d]] of Object.entries(PAIRS)) {
    out[name] = theme === 'light' ? l : theme === 'dark' ? d : `light-dark(${l}, ${d})`
  }
  return out as CSSProperties
}

/** CSS text for the embed page's <html>/<body>, so the area around the form is themed too. */
export function pageCss(theme: FormTheme | undefined): string {
  const v = themeVars(theme) as Record<string, string>
  const decls = Object.entries(v)
    .map(([k, val]) => `${k === 'colorScheme' ? 'color-scheme' : k}:${val}`)
    .join(';')
  return `html,body{${decls};background:var(--og-card)!important;color:var(--og-fg)}`
}
