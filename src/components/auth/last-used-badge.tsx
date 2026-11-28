/** Small "Last used" pill pinned to the top-right corner of a relatively positioned button wrapper. */
export function LastUsedBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute -top-2.5 right-3 z-10 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold leading-4 text-amber-950 shadow-sm ring-2 ring-card">
      {label}
    </span>
  )
}
