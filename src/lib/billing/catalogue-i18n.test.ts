import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_DEFS, LIMIT_DEFS } from './plans'

const en = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en.json'), 'utf8')) as { Settings: { billing: { features: Record<string, string>; limits: Record<string, string> } } }

describe('billing catalogue translations', () => {
  it('every feature and limit has a label (no raw keys on the billing page)', () => {
    for (const k of Object.keys(FEATURE_DEFS)) expect(en.Settings.billing.features[k], `features.${k}`).toBeTruthy()
    for (const k of Object.keys(LIMIT_DEFS)) expect(en.Settings.billing.limits[k], `limits.${k}`).toBeTruthy()
  })
})
