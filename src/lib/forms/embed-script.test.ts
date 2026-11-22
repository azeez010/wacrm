import { describe, expect, it } from 'vitest'

import { EMBED_SCRIPT } from './embed-script'

describe('embed script', () => {
  it('is valid JavaScript', () => {
    expect(() => new Function(EMBED_SCRIPT)).not.toThrow()
  })
  it('stays small enough to be a friendly third-party script', () => {
    expect(EMBED_SCRIPT.length).toBeLessThan(12_000)
  })
  it('supports inline forms and the lazy floating widget, and fires the host event', () => {
    expect(EMBED_SCRIPT).toContain('data-ogadesk-form')
    expect(EMBED_SCRIPT).toContain("getAttribute('data-widget')")
    expect(EMBED_SCRIPT).toContain('ogadesk:submitted')
    // The iframe is created on first open, not on page load.
    expect(EMBED_SCRIPT).toMatch(/function open\(\)[\s\S]*if \(!frame\)/)
  })
  it('forwards the host page context into the iframe', () => {
    for (const k of ['ogvid', 'ogref', 'ogpage', 'location.search']) expect(EMBED_SCRIPT).toContain(k)
  })
  it('never uses innerHTML with page-controlled data except the escaped label', () => {
    const uses = EMBED_SCRIPT.match(/innerHTML/g) ?? []
    expect(uses.length).toBe(1)
    expect(EMBED_SCRIPT).toContain("replace(/</g, '&lt;')")
  })
})
