import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENCY_FLAG, SUPPORTED_CURRENCIES } from './supported'

describe('CURRENCY_FLAG', () => {
  it('has an entry for every supported currency and no extras', () => {
    expect(Object.keys(CURRENCY_FLAG).sort()).toEqual([...SUPPORTED_CURRENCIES].sort())
  })

  it('points at a flag file that exists', () => {
    for (const iso of Object.values(CURRENCY_FLAG)) {
      if (iso) expect(existsSync(join(process.cwd(), 'public/flags', `${iso}.svg`)), iso).toBe(true)
    }
  })
})
