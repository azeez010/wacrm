import { supabaseAdmin } from './admin-client'
import { insertSteps } from './steps-tree'
import { buildUnsubscribeAutomation, UNSUBSCRIBE_SYSTEM_KEY } from './default-unsubscribe'

/**
 * Create the account's default automations once. Recorded in
 * `accounts.seeded_defaults`, so a default the user deletes is never
 * recreated. Idempotent and race-safe: the unique (account_id, system_key)
 * index means two simultaneous callers cannot both insert.
 */
export async function ensureDefaultAutomations(
  accountId: string,
  userId: string,
): Promise<{ created: string[] }> {
  const admin = supabaseAdmin()
  const { data: account } = await admin
    .from('accounts')
    .select('seeded_defaults')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) return { created: [] }
  const seeded: string[] = account.seeded_defaults ?? []
  const created: string[] = []

  if (!seeded.includes(UNSUBSCRIBE_SYSTEM_KEY)) {
    const def = buildUnsubscribeAutomation()
    const { data: automation, error } = await admin
      .from('automations')
      .insert({
        user_id: userId,
        account_id: accountId,
        name: def.name,
        description: def.description,
        trigger_type: def.trigger_type,
        trigger_config: def.trigger_config,
        is_active: true,
        system_key: def.system_key,
      })
      .select('id')
      .single()
    // 23505 = another request won the race; it will insert the steps.
    if (error && error.code !== '23505') throw new Error(error.message)
    if (automation) {
      const stepsErr = await insertSteps(automation.id, def.steps)
      if (stepsErr) {
        await admin.from('automations').delete().eq('id', automation.id)
        throw new Error(stepsErr)
      }
      created.push(def.system_key)
    }
    await admin
      .from('accounts')
      .update({ seeded_defaults: [...seeded, UNSUBSCRIBE_SYSTEM_KEY] })
      .eq('id', accountId)
  }
  return { created }
}
