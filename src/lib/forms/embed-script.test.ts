import { describe, expect, it } from 'vitest'

import { EMBED_SCRIPT } from './embed-script'

describe('embed script', () => {
  it('is valid JavaScript', () => {
    expect(() => new Function(EMBED_SCRIPT)).not.toThrow()
  })
  it('stays small enough to be a friendly third-party script', () => {
    expect(EMBED_SCRIPT.length).toBeLessThan(18_600)
  })
  it('supports inline forms and the lazy floating widget, and fires the host event', () => {
    expect(EMBED_SCRIPT).toContain('data-ogadesk-form')
    expect(EMBED_SCRIPT).toContain("getAttribute('data-widget')")
    expect(EMBED_SCRIPT).toContain('ogadesk:submitted')
    // One shared frame factory: used on open, and warmed on load ONLY for live chat outside the preview.
    expect(EMBED_SCRIPT).toMatch(/function ensureFrame\(\) \{\s*if \(frame\) return;/)
    expect(EMBED_SCRIPT).toMatch(/function open\(\)[\s\S]*ensureFrame\(\)/)
    expect(EMBED_SCRIPT).toContain("if (!PREVIEW && w.mode === 'live_chat' && !frame) setTimeout(ensureFrame")
    expect((EMBED_SCRIPT.match(/setTimeout\(ensureFrame/g) ?? []).length).toBe(1)
  })
  it('has the attention features: animations, teaser bubble, synthesised sound, reduced motion', () => {
    for (const k of ['ogpulse', 'ogbounce', 'ogwiggle', 'ogring', 'preMessage', 'preMessageDelay', 'createOscillator', 'prefers-reduced-motion']) {
      expect(EMBED_SCRIPT).toContain(k)
    }
    // No audio files: the sound is generated.
    expect(EMBED_SCRIPT).not.toMatch(/\.mp3|\.wav|new Audio\(/)
  })
  it('preview mode takes the draft config by postMessage and never fetches', () => {
    expect(EMBED_SCRIPT).toContain("data-preview")
    expect(EMBED_SCRIPT).toContain("ogadesk-preview")
    expect(EMBED_SCRIPT).toMatch(/if \(PREVIEW\) \{[\s\S]*else \{[\s\S]*fetch\(BASE/)
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
