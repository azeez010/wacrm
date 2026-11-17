import { isKnownTrigger } from '@/lib/automations/trigger-meta'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
  type ValidationIssue,
} from '@/lib/automations/validate'
import type { BuilderStepInput } from '@/lib/automations/steps-tree'

export const AUTOMATION_SELECT =
  'id, name, description, trigger_type, trigger_config, is_active, execution_count, last_executed_at, created_at, updated_at'

const MAX_STEPS = 100
const MAX_DEPTH = 6

function countSteps(steps: BuilderStepInput[], depth = 0): { n: number; depth: number } {
  let n = 0
  let maxDepth = depth
  for (const s of steps) {
    n++
    for (const branch of [s.branches?.yes, s.branches?.no]) {
      if (Array.isArray(branch)) {
        const r = countSteps(branch, depth + 1)
        n += r.n
        maxDepth = Math.max(maxDepth, r.depth)
      }
    }
  }
  return { n, depth: maxDepth }
}

/**
 * Structural problems that make a definition unsaveable even as a
 * draft (wrong types / absurd size). Returns an error string or null.
 */
export function structuralError(
  triggerType: unknown,
  triggerConfig: unknown,
  steps: unknown,
): string | null {
  if (typeof triggerType !== 'string' || !isKnownTrigger(triggerType)) {
    return `'trigger_type' must be one of: new_message_received, first_inbound_message, keyword_match, new_contact_created, conversation_assigned, tag_added, time_based, interactive_reply`
  }
  if (triggerConfig !== undefined && (typeof triggerConfig !== 'object' || triggerConfig === null || Array.isArray(triggerConfig))) {
    return "'trigger_config' must be an object"
  }
  if (steps !== undefined) {
    if (!Array.isArray(steps)) return "'steps' must be an array"
    const { n, depth } = countSteps(steps as BuilderStepInput[])
    if (n > MAX_STEPS) return `'steps' allows at most ${MAX_STEPS} steps in total`
    if (depth > MAX_DEPTH) return `condition branches may nest at most ${MAX_DEPTH} levels deep`
    for (const s of steps as BuilderStepInput[]) {
      if (!s || typeof s !== 'object' || typeof s.step_type !== 'string') {
        return "every step needs a 'step_type' string"
      }
    }
  }
  return null
}

/** What would block activation right now (works for drafts too). */
export function activationIssues(
  triggerType: string,
  triggerConfig: unknown,
  steps: unknown,
): ValidationIssue[] {
  return [
    ...validateTriggerForActivation(triggerType, triggerConfig ?? {}),
    ...validateStepsForActivation(
      (Array.isArray(steps) ? steps : []) as { step_type: string; step_config: Record<string, unknown> }[],
    ),
  ]
}
