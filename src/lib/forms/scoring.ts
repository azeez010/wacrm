import { computeVisibility } from './conditions'
import type { FormField, FormSettings } from './types'

export interface ScoreResult {
  score: number
  /** True when any chosen option is marked as disqualifying. */
  disqualified: boolean
  /** Meets the threshold and nothing disqualified. Always true when qualification is off. */
  qualified: boolean
}

function chosen(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

function pointsFor(map: Record<string, number> | undefined, option: string): number {
  if (!map) return 0
  const key = Object.keys(map).find((k) => k.toLowerCase() === option.toLowerCase())
  return key ? map[key] : 0
}

/** Sum points for the chosen options and apply disqualifiers + threshold. Pure. */
export function scoreAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  settings: Pick<FormSettings, 'qualification'>,
): ScoreResult {
  const q = settings.qualification
  let score = 0
  let disqualified = false
  const visible = computeVisibility(fields, answers)
  for (const f of fields) {
    if (f.kind !== 'custom_field' && f.kind !== 'table_column') continue
    if (visible[f.id] === false) continue
    const picks = chosen(answers[f.id])
    for (const p of picks) {
      score += pointsFor(f.points, p)
      if (f.disqualify?.some((d) => d.toLowerCase() === p.toLowerCase())) disqualified = true
    }
  }
  if (!q.enabled) return { score, disqualified: false, qualified: true }
  return { score, disqualified, qualified: !disqualified && score >= q.threshold }
}
