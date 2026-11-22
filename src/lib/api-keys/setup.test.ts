import { describe, expect, it } from 'vitest'
import { CLIENTS, buildSetup, KEY_PLACEHOLDER } from './setup'
import { presetFor, READ_SCOPES, FULL_SCOPES } from './presets'

describe('buildSetup', () => {
  it('puts the key (or a placeholder) in every client', () => {
    for (const c of CLIENTS) {
      const withKey = buildSetup('https://x.test', 'wacrm_live_abc', c).map((b) => b.value).join('\n')
      expect(withKey).toContain('wacrm_live_abc')
      const without = buildSetup('https://x.test', null, c).map((b) => b.value).join('\n')
      expect(without).toContain(KEY_PLACEHOLDER)
    }
  })
  it('the default is one URL that carries the key', () => {
    const blocks = buildSetup('https://x.test', 'wacrm_live_abc', 'url')
    expect(blocks).toEqual([{ label: 'connectUrl', value: 'https://x.test/api/mcp?key=wacrm_live_abc' }])
    expect(buildSetup('https://x.test', null, 'url')[0].value).toBe(`https://x.test/api/mcp?key=${KEY_PLACEHOLDER}`)
  })
  it('the config clients use valid JSON', () => {
    const json = buildSetup('https://x.test', 'k', 'claudedesktop').find((b) => b.label === 'configFile')!.value
    expect(() => JSON.parse(json)).not.toThrow()
  })
})

describe('presetFor', () => {
  it('recognises presets regardless of order, else custom', () => {
    expect(presetFor([...READ_SCOPES].reverse())).toBe('read')
    expect(presetFor(FULL_SCOPES)).toBe('full')
    expect(presetFor(['contacts:read'])).toBe('custom')
    expect(presetFor([])).toBe('custom')
  })
})
