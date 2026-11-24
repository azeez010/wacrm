"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
  /** Show only the icon (the label stays as the accessible name). */
  iconOnly?: boolean
}

/**
 * A row of mutually exclusive buttons (alignment, size, fit...). One value is
 * always selected; use it where a dropdown would hide a short list of choices.
 */
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  disabled,
  "aria-label": ariaLabel,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  disabled?: boolean
  "aria-label"?: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex w-full rounded-lg border border-border bg-muted p-0.5", className)}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            <span className={cn("truncate", o.iconOnly && o.icon ? "sr-only" : undefined)}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
