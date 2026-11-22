// ============================================================
// Timing for "hover to expand a cut-off value": open as soon as the pointer
// is on the value, stay open while the pointer is on it, and for a grace period
// (about 5 s) after the pointer leaves, longer while text in it is selected,
// so the value can be copied. Framework free so it is easy to test.
// ============================================================

export interface ExpandControllerOptions {
  /** Rest time on the value before it opens (0 = immediately). */
  delay?: number
  /** How long it stays open after the pointer leaves. */
  grace?: number
  /** Upper bound for the extra time granted while text is selected. */
  maxExtend?: number
  /** True while some text of the expanded value is selected. */
  hasSelection?: () => boolean
  onChange: (open: boolean) => void
}

export function createExpandController(opts: ExpandControllerOptions) {
  const delay = opts.delay ?? 0
  const grace = opts.grace ?? 5000
  const maxExtend = opts.maxExtend ?? 30_000

  let open = false
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let extended = 0

  const clear = (t: ReturnType<typeof setTimeout> | null) => {
    if (t) clearTimeout(t)
    return null
  }

  function close() {
    openTimer = clear(openTimer)
    closeTimer = clear(closeTimer)
    extended = 0
    if (open) {
      open = false
      opts.onChange(false)
    }
  }

  function scheduleClose() {
    closeTimer = clear(closeTimer)
    closeTimer = setTimeout(() => {
      if (opts.hasSelection?.() && extended < maxExtend) {
        extended += grace
        scheduleClose()
        return
      }
      close()
    }, grace)
  }

  return {
    /** Pointer entered the value. `truncated` = the text is actually cut off. */
    enter(truncated: boolean) {
      closeTimer = clear(closeTimer)
      extended = 0
      if (open || !truncated) return
      openTimer = clear(openTimer)
      if (delay <= 0) {
        open = true
        opts.onChange(true)
        return
      }
      openTimer = setTimeout(() => {
        open = true
        opts.onChange(true)
      }, delay)
    },
    /** Pointer left the value or the expanded panel. */
    leave() {
      openTimer = clear(openTimer)
      if (open) scheduleClose()
    },
    /** Pointer is on the expanded panel: stay open. */
    hold() {
      closeTimer = clear(closeTimer)
      extended = 0
    },
    close,
    get isOpen() {
      return open
    },
  }
}
