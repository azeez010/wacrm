import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { organizationJsonLd } from './seo'

const pub = (f: string) => readFileSync(join(process.cwd(), 'public', f))
const pngSize = (f: string) => {
  const b = pub(f)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('favicons (Google wants a multiple of 48px, or an SVG)', () => {
  it('the declared PNG icons exist at their stated sizes', () => {
    for (const [file, size] of [['favicon-48x48.png', 48], ['favicon-96x96.png', 96], ['android-chrome-192x192.png', 192], ['android-chrome-512x512.png', 512]] as const) {
      expect(pngSize(file), file).toEqual({ w: size, h: size })
    }
  })

  it('favicon.ico holds 16, 32 and 48', () => {
    const ico = pub('favicon.ico')
    expect(ico.readUInt16LE(2)).toBe(1) // an icon file
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16)).sort((a, b) => a - b)
    expect(sizes).toEqual([16, 32, 48])
  })

  it('the root layout declares at least one 48px-multiple icon plus the SVG', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/sizes: "48x48"/)
    expect(layout).toMatch(/favicon\.svg/)
  })
})

describe('organizationJsonLd', () => {
  it('is valid JSON naming the brand and a square logo', () => {
    const doc = JSON.parse(organizationJsonLd('OgaDesk', 'https://ogadesk.com'))
    const org = doc['@graph'].find((x: { '@type': string }) => x['@type'] === 'Organization')
    expect(org).toMatchObject({ name: 'OgaDesk', url: 'https://ogadesk.com', logo: { url: 'https://ogadesk.com/android-chrome-512x512.png', width: 512, height: 512 } })
    expect(doc['@graph'].some((x: { '@type': string }) => x['@type'] === 'WebSite')).toBe(true)
  })

  it('cannot break out of a <script> tag', () => {
    expect(organizationJsonLd('</script><script>alert(1)</script>', 'https://x.test')).not.toContain('<')
  })
})
