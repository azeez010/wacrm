'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Goes to the previous page, or to `fallback` when the visitor landed here directly. */
export function GoBackButton({ label, fallback = '/', className }: { label: string; fallback?: string; className?: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), className)}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </button>
  )
}
