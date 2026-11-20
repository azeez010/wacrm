import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

// Locale-aware Link / router / pathname for the path-based public pages.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
