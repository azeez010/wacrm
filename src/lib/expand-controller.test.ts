import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExpandController } from './expand-controller'

describe('createExpandController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (hasSelection?: () => boolean) => {
    const changes: boolean[] = []
    const c = createExpandController({ onChange: (o) => changes.push(o), hasSelection })
    return { c, changes }
  }

  it('opens immediately, but only for cut-off text', () => {
    const { c, changes } = make()
    c.enter(false)
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
    c.enter(true)
    expect(changes).toEqual([true])
  })

  it('still honours an explicit rest delay when one is given', () => {
    const changes: boolean[] = []
    const c = createExpandController({ delay: 250, onChange: (o) => changes.push(o) })
    c.enter(true)
    vi.advanceTimersByTime(200)
    expect(changes).toEqual([])
    c.leave()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
    c.enter(true)
    vi.advanceTimersByTime(300)
    expect(changes).toEqual([true])
  })

  it('stays open about 5 seconds after the pointer leaves, then closes', () => {
    const { c, changes } = make()
    c.enter(true)
    vi.advanceTimersByTime(300)
    c.leave()
    vi.advanceTimersByTime(4900)
    expect(changes).toEqual([true])
    vi.advanceTimersByTime(200)
    expect(changes).toEqual([true, false])
  })

  it('stays open while the pointer is on the panel and restarts the grace after it leaves', () => {
    const { c, changes } = make()
    c.enter(true)
    vi.advanceTimersByTime(300)
    c.leave()
    vi.advanceTimersByTime(3000)
    c.hold()
    vi.advanceTimersByTime(60_000)
    expect(changes).toEqual([true])
    c.leave()
    vi.advanceTimersByTime(5100)
    expect(changes).toEqual([true, false])
  })

  it('stays longer while text is selected, up to a cap', () => {
    let selected = true
    const { c, changes } = make(() => selected)
    c.enter(true)
    vi.advanceTimersByTime(300)
    c.leave()
    vi.advanceTimersByTime(20_000)
    expect(changes).toEqual([true])
    selected = false
    vi.advanceTimersByTime(5100)
    expect(changes).toEqual([true, false])
  })

  it('closes right away on demand and never reopens by itself', () => {
    const { c, changes } = make()
    c.enter(true)
    vi.advanceTimersByTime(300)
    c.close()
    vi.advanceTimersByTime(10_000)
    expect(changes).toEqual([true, false])
    expect(c.isOpen).toBe(false)
  })

  it('shows one value at a time: entering another closes the open one right away', () => {
    const a = make()
    const b = make()
    a.c.enter(true)
    a.c.leave() // A is now only waiting out its grace period
    b.c.enter(true)
    expect(a.changes).toEqual([true, false])
    expect(b.changes).toEqual([true])
    vi.advanceTimersByTime(6000)
    // A's old grace timer must not touch anything, B stays until its own grace.
    expect(a.changes).toEqual([true, false])
    b.c.leave()
    vi.advanceTimersByTime(6000)
    expect(b.changes).toEqual([true, false])
  })

  it('moving onto a value that is not cut off still dismisses the open one', () => {
    const a = make()
    const b = make()
    a.c.enter(true)
    b.c.enter(false)
    expect(a.changes).toEqual([true, false])
    expect(b.changes).toEqual([])
  })
})
