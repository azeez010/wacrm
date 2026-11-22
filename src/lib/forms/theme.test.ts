import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { colorScheme, pageCss, themeVars } from './theme'
import { resolveDefaultCountry } from './countries'

describe('form theme', () => {
  it('auto uses light-dark() and both schemes', () => {
    const v = themeVars('auto') as Record<string, string>
    expect(v['--og-fg']).toMatch(/^light-dark\(/)
    expect(colorScheme('auto')).toBe('light dark')
  })
  it('light and dark force one value', () => {
    expect((themeVars('light') as Record<string, string>)['--og-fg']).not.toMatch(/light-dark/)
    expect(colorScheme('dark')).toBe('dark')
    expect(pageCss('dark')).toContain('color-scheme:dark')
  })
  it('public form files use theme variables, not fixed light classes', () => {
    const dir = join(__dirname, '../../components/public-form')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/\bbg-white\b|\bgray-\d/)
    }
  })
})

describe('resolveDefaultCountry', () => {
  it('auto uses the detected country, falling back to Nigeria', () => {
    expect(resolveDefaultCountry('auto', 'KE')).toBe('KE')
    expect(resolveDefaultCountry('auto', 'ZZ')).toBe('NG')
    expect(resolveDefaultCountry(undefined, null)).toBe('NG')
  })
  it('a fixed default wins over detection', () => {
    expect(resolveDefaultCountry('GH', 'KE')).toBe('GH')
  })
})
