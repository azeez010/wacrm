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
  it('claude.ai gets url + header name + header value, and the config clients use valid JSON', () => {
    const blocks = buildSetup('https://x.test', 'k', 'claudeai')
    expect(blocks.map((b) => b.label)).toEqual(['serverUrl', 'headerName', 'headerValue'])
    expect(blocks[0].value).toBe('https://x.test/api/mcp')
    expect(blocks[1].value).toBe('X-API-Key')
    for (const c of ['claudedesktop', 'cursor'] as const) {
      const json = buildSetup('https://x.test', 'k', c).find((b) => b.label === 'configFile')!.value
      expect(() => JSON.parse(json)).not.toThrow()
    }
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
